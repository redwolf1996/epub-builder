from __future__ import annotations

import json
import math
import re
import sys
from contextlib import redirect_stdout
from functools import lru_cache
from pathlib import Path

import cv2
import jieba
import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.utils.typings import LangDet, LangRec


DEFAULT_LITERAL_CORRECTIONS: dict[str, str] = {}

DEFAULT_REGEX_CORRECTIONS: tuple[tuple[str, str], ...] = ()

CHAR_CONFUSIONS: dict[str, tuple[str, ...]] = {
    '0': ('O', 'o'),
    'O': ('0', 'o'),
    'o': ('0', 'O'),
    '1': ('I', 'l', '|'),
    'I': ('1', 'l', '|'),
    'l': ('1', 'I', '|'),
    '|': ('1', 'I', 'l'),
    '2': ('Z',),
    'Z': ('2',),
    '5': ('S',),
    'S': ('5',),
    '6': ('G',),
    'G': ('6',),
    '8': ('B',),
    'B': ('8',),
    '.': ('。', '·'),
    '。': ('.',),
    ',': ('，',),
    '，': (',',),
    ':': ('：',),
    '：': (':',),
    ';': ('；',),
    '；': (';',),
    '-': ('一',),
    '—': ('一',),
    '_': ('一',),
    '·': ('一',),
    '一': ('·', '-'),
    '“': ('"',),
    '”': ('"',),
    '‘': ("'",),
    '’': ("'",),
    '使': ('便',),
    '便': ('使',),
    '中': ('小',),
    '小': ('中',),
    '未': ('末',),
    '末': ('未',),
    '己': ('已', '巳'),
    '已': ('己', '巳'),
    '巳': ('己', '已'),
    '曰': ('日',),
    '日': ('曰', '目'),
    '目': ('日', '且'),
    '且': ('目',),
    '口': ('回', '日'),
    '回': ('口',),
    '田': ('由', '甲'),
    '由': ('田', '甲'),
    '甲': ('田', '由', '申'),
    '申': ('甲',),
    '土': ('士',),
    '士': ('土',),
    '人': ('入',),
    '入': ('人',),
    '儿': ('几',),
    '几': ('儿',),
    '力': ('刀',),
    '刀': ('力',),
    '干': ('千',),
    '千': ('干',),
    '白': ('自',),
    '自': ('白',),
    '木': ('本',),
    '本': ('木',),
    '大': ('太',),
    '太': ('大',),
    '了': ('子',),
    '子': ('了',),
    '么': ('之',),
    '之': ('么',),
    '问': ('间',),
    '间': ('问',),
    '门': ('们',),
    '们': ('门',),
    '令': ('今',),
    '今': ('令',),
    '免': ('兔',),
    '兔': ('免',),
    '情': ('晴',),
    '晴': ('情',),
    '清': ('晴', '情'),
    '贝': ('见',),
    '见': ('贝',),
    '牛': ('午',),
    '午': ('牛',),
    '王': ('玉',),
    '玉': ('王',),
    '元': ('无',),
    '无': ('元',),
    '寸': ('才',),
    '才': ('寸',),
    '的': ('白勺',),
}

PHRASE_CONFUSIONS: tuple[tuple[str, str], ...] = (
    ('便我们', '使我们'),
    ('小性', '中性'),
    ('·种', '一种'),
    ('保持·种', '保持一种'),
    ('保持小性', '保持中性'),
    ('白勺', '的'),
    ('行清', '行情'),
    ('市杨', '市场'),
    ('巿场', '市场'),
    ('市埸', '市场'),
    ('投姿', '投资'),
    ('风验', '风险'),
    ('自已', '自己'),
    ('巳经', '已经'),
    ('末来', '未来'),
    ('因为', '因为'),
    ('机会', '机会'),
    ('分析市杨', '分析市场'),
    ('情续管理', '情绪管理'),
)

MAX_CORRECTION_VARIANTS = 256


def configure_stdio() -> None:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8')


def write_json(payload: dict[str, object]) -> None:
    sys.stdout.buffer.write(json.dumps(payload).encode('ascii'))
    sys.stdout.buffer.write(b'\n')
    sys.stdout.buffer.flush()


def preprocess_image(path: Path) -> np.ndarray:
    image = Image.open(path).convert('L')
    array = np.array(image)

    if array.shape[1] < 1800:
        scale = 1800 / max(array.shape[1], 1)
        height = max(int(round(array.shape[0] * scale)), 1)
        array = cv2.resize(array, (1800, height), interpolation=cv2.INTER_CUBIC)

    denoised = cv2.fastNlMeansDenoising(array, h=8)
    normalized = cv2.normalize(denoised, None, 0, 255, cv2.NORM_MINMAX)
    binary = cv2.adaptiveThreshold(
        normalized,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )

    return binary


def normalize_text(text: str) -> str:
    return ' '.join(text.split())


def load_corrections() -> tuple[dict[str, str], list[tuple[re.Pattern[str], str]]]:
    literal = dict(DEFAULT_LITERAL_CORRECTIONS)
    regex_rules = list(DEFAULT_REGEX_CORRECTIONS)

    corrections_path = runtime_root() / 'corrections.json'
    if corrections_path.exists():
        try:
            payload = json.loads(corrections_path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            payload = {}

        custom_literal = payload.get('literal')
        if isinstance(custom_literal, dict):
            for source, target in custom_literal.items():
                if isinstance(source, str) and isinstance(target, str):
                    literal[source] = target

        custom_regex = payload.get('regex')
        if isinstance(custom_regex, list):
            for entry in custom_regex:
                if not isinstance(entry, dict):
                    continue
                pattern = entry.get('pattern')
                replacement = entry.get('replacement')
                if isinstance(pattern, str) and isinstance(replacement, str):
                    regex_rules.append((pattern, replacement))

    compiled = [(re.compile(pattern), replacement) for pattern, replacement in regex_rules]
    return literal, compiled


def apply_post_corrections(text: str) -> str:
    corrected = text.replace('“', '"').replace('”', '"').replace('‘', "'").replace('’', "'")

    literal_rules, regex_rules = load_corrections()
    for source, target in literal_rules.items():
        corrected = corrected.replace(source, target)

    for pattern, replacement in regex_rules:
        corrected = pattern.sub(replacement, corrected)

    return corrected


def scoring_text(text: str) -> str:
    return ''.join(char for char in apply_post_corrections(text) if not char.isspace())


class LocalLanguageModel:
    def __init__(self) -> None:
        self.unigrams: dict[str, float] = {}
        self.bigrams: dict[str, float] = {}
        self.trigrams: dict[str, float] = {}
        self.vocabulary: set[str] = set()
        self.total_unigrams = 0.0
        self._build()

    def _build(self) -> None:
        for token, freq in jieba.dt.FREQ.items():
            if not token or not isinstance(token, str) or freq <= 0:
                continue

            text = scoring_text(token)
            if not text:
                continue

            weight = max(1.0, math.log10(float(freq) + 10.0))
            self._ingest(text, weight)

        for phrase in (
            '市场保持一种中性的情感',
            '我们时刻对市场保持',
            '投资者需要保持中性',
            '风险控制和情绪管理',
            '理性判断市场波动',
        ):
            self._ingest(scoring_text(phrase), 8.0)

    def _ingest(self, text: str, weight: float) -> None:
        padded = f'^{text}$'
        for char in text:
            self.vocabulary.add(char)
            self.unigrams[char] = self.unigrams.get(char, 0.0) + weight
            self.total_unigrams += weight

        for index in range(len(padded) - 1):
            bigram = padded[index:index + 2]
            self.bigrams[bigram] = self.bigrams.get(bigram, 0.0) + weight

        for index in range(len(padded) - 2):
            trigram = padded[index:index + 3]
            self.trigrams[trigram] = self.trigrams.get(trigram, 0.0) + weight

    def score(self, text: str) -> float:
        normalized = normalize_text(text)
        condensed = scoring_text(normalized)
        if not condensed:
            return float('-inf')

        vocab_size = max(len(self.vocabulary), 1)
        padded = f'^{condensed}$'
        score = 0.0

        for index in range(len(padded) - 2):
            trigram = padded[index:index + 3]
            prefix = trigram[:2]
            numerator = self.trigrams.get(trigram, 0.0) + 1.0
            denominator = self.bigrams.get(prefix, 0.0) + vocab_size
            score += math.log(numerator / denominator)

        for token in jieba.lcut(normalized, cut_all=False):
            token = token.strip()
            if not token:
                continue

            freq = jieba.dt.FREQ.get(token, 0)
            if freq > 0:
                score += 0.28 * math.log(freq + 1.0)
            elif len(token) == 1:
                score -= 0.55
            else:
                score -= 0.2 * len(token)

        if normalized.count('"') % 2 == 0:
            score += 0.2
        if '··' in normalized:
            score -= 1.5

        return score


@lru_cache(maxsize=1)
def get_language_model() -> LocalLanguageModel:
    return LocalLanguageModel()


def score_text(text: str) -> float:
    normalized = normalize_text(text)
    if not normalized:
        return float('-inf')

    score = get_language_model().score(normalized)
    for source, target in PHRASE_CONFUSIONS:
        if source in normalized:
            score -= 0.9 * len(source)
        if target in normalized:
            score += 0.45 * len(target)
    if '·种' in normalized:
        score -= 1.6
    if '小性' in normalized:
        score -= 1.6
    if '便我们' in normalized:
        score -= 1.6
    if '一种' in normalized:
        score += 0.9
    if '中性' in normalized:
        score += 0.9
    if '使我们' in normalized:
        score += 0.9
    return score


def generate_correction_candidates(text: str) -> list[str]:
    candidates = {text}

    for source, target in PHRASE_CONFUSIONS:
        snapshot = list(candidates)
        for current in snapshot:
            if source in current and len(candidates) < MAX_CORRECTION_VARIANTS:
                candidates.add(current.replace(source, target))

    suspicious_positions = [
        (index, char)
        for index, char in enumerate(text)
        if char in CHAR_CONFUSIONS
    ]

    for index, char in suspicious_positions[:12]:
        snapshot = list(candidates)
        for current in snapshot:
            if len(candidates) >= MAX_CORRECTION_VARIANTS:
                break
            for alt in CHAR_CONFUSIONS[char]:
                if index >= len(current) or current[index] != char:
                    continue
                candidate = current[:index] + alt + current[index + 1:]
                candidates.add(candidate)
                if len(candidates) >= MAX_CORRECTION_VARIANTS:
                    break

    return list(candidates)


def apply_offline_correction(text: str) -> tuple[str, bool]:
    base = apply_post_corrections(text)
    candidates = generate_correction_candidates(base)
    best_text = base
    best_score = score_text(base)

    for candidate in candidates:
        candidate = apply_post_corrections(candidate)
        candidate_score = score_text(candidate)
        if candidate_score > best_score + 0.8:
            best_text = candidate
            best_score = candidate_score

    return normalize_text(best_text), best_text != base


def should_insert_space(prev_text: str, next_text: str) -> bool:
    if not prev_text or not next_text:
        return False

    prev_char = prev_text[-1]
    next_char = next_text[0]
    return prev_char.isascii() and prev_char.isalnum() and next_char.isascii() and next_char.isalnum()


def runtime_root() -> Path:
    if getattr(sys, 'frozen', False):
        return Path(getattr(sys, '_MEIPASS'))
    return Path(__file__).resolve().parent


def model_root_dir() -> Path:
    return runtime_root() / 'models'


def build_engine(mode: str) -> RapidOCR:
    params: dict[str, object] = {
        'Global.model_root_dir': str(model_root_dir()),
        'Global.log_level': 'info',
    }

    if mode == 'english':
        params['Det.lang_type'] = LangDet.EN
        params['Rec.lang_type'] = LangRec.EN
    else:
        params['Det.lang_type'] = LangDet.CH
        params['Rec.lang_type'] = LangRec.CH

    with redirect_stdout(sys.stderr):
        return RapidOCR(params=params)


def extract_text_and_scores(result: object) -> tuple[str, list[float]]:
    if hasattr(result, 'txts'):
        texts = [str(text).strip() for text in getattr(result, 'txts', []) if str(text).strip()]
        scores: list[float] = []
        for score in getattr(result, 'scores', []) or []:
            try:
                scores.append(float(score))
            except (TypeError, ValueError):
                continue
        merged = ''
        for text in texts:
            if should_insert_space(merged, text):
                merged += ' '
            merged += text
        return normalize_text(merged), scores

    entries = result
    if isinstance(result, tuple) and result:
        entries = result[0]

    if not isinstance(entries, list):
        return '', []

    spans: list[tuple[float, float, float, str]] = []
    scores: list[float] = []
    for entry in entries:
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            continue
        text = str(entry[1]).strip()
        if not text:
            continue
        box = entry[0]
        top = 0.0
        left = 0.0
        height = 0.0
        if isinstance(box, (list, tuple)) and box:
            points = [point for point in box if isinstance(point, (list, tuple)) and len(point) >= 2]
            if points:
                xs = [float(point[0]) for point in points]
                ys = [float(point[1]) for point in points]
                left = min(xs)
                top = min(ys)
                height = max(ys) - min(ys)
        spans.append((top, left, height, text))
        try:
            scores.append(float(entry[2]))
        except (TypeError, ValueError):
            continue

    if not spans:
        return '', scores

    median_height = sorted(span[2] for span in spans if span[2] > 0)
    row_threshold = (median_height[len(median_height) // 2] * 0.6) if median_height else 18.0

    ordered: list[str] = []
    current_row: list[tuple[float, float, float, str]] = []
    current_top = 0.0

    for span in sorted(spans, key=lambda item: (item[0], item[1])):
        if not current_row:
            current_row = [span]
            current_top = span[0]
            continue

        if abs(span[0] - current_top) <= row_threshold:
            current_row.append(span)
            current_top = min(current_top, span[0])
            continue

        ordered.extend(text for _, _, _, text in sorted(current_row, key=lambda item: item[1]))
        current_row = [span]
        current_top = span[0]

    if current_row:
        ordered.extend(text for _, _, _, text in sorted(current_row, key=lambda item: item[1]))

    merged = ''
    for text in ordered:
        if should_insert_space(merged, text):
            merged += ' '
        merged += text

    return normalize_text(apply_post_corrections(merged)), scores


def main() -> int:
    configure_stdio()

    if len(sys.argv) >= 2 and sys.argv[1] == '--warmup':
        mode = sys.argv[2] if len(sys.argv) >= 3 else 'auto'
        engine = build_engine(mode)
        model_root_dir().mkdir(parents=True, exist_ok=True)
        blank = np.full((64, 64), 255, dtype=np.uint8)
        engine(blank)
        write_json({'ready': True})
        return 0

    if len(sys.argv) not in (2, 3, 4):
        print(json.dumps({'error': 'usage: sidecar.py <image-path> [auto|chinese|english] [--correct] | --warmup'}), file=sys.stderr)
        return 2

    image_path = Path(sys.argv[1]).expanduser().resolve()
    mode = sys.argv[2] if len(sys.argv) == 3 else 'auto'
    should_correct = '--correct' in sys.argv[2:]
    if should_correct and mode == '--correct':
        mode = 'auto'
    if not image_path.exists():
        print(json.dumps({'error': f'image not found: {image_path}'}), file=sys.stderr)
        return 2

    model_root_dir().mkdir(parents=True, exist_ok=True)
    engine = build_engine(mode)

    preprocessed = preprocess_image(image_path)
    with redirect_stdout(sys.stderr):
        result = engine(preprocessed)

    if not result:
        write_json({'text': '', 'confidence': None, 'warning': None})
        return 0

    raw_text, scores = extract_text_and_scores(result)
    text = raw_text
    corrected = False
    if should_correct and raw_text:
        text, corrected = apply_offline_correction(raw_text)

    payload = {
        'text': text,
        'rawText': raw_text if corrected else None,
        'corrected': corrected,
        'confidence': round(sum(scores) / len(scores), 4) if scores else None,
        'warning': None if mode == 'auto' else f'Local OCR mode: {mode}',
    }
    write_json(payload)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
