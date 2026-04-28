# Doubao OCR automation status

## Current state
- Abandoned CDP/debug-endpoint approach because Doubao desktop app startup/debug attachment is unreliable.
- Switched to Windows desktop automation.
- Current flow can:
  - focus Doubao window
  - paste image/file into input
  - paste prompt
  - send with Enter
- Current failure point:
  - copying the final reply back into the editor is unreliable

## Key observations
- After image paste, do not click bottom toolbar items like `图像生成`.
- Correct flow is: paste file/image -> paste prompt -> Enter.
- Fixed-coordinate clicking is not reliable for the copy button.
- Copy button is located under the latest assistant reply action bar, and its position changes with reply height/layout.
- Need to wait for reply completion before copying.

## Next step
- Replace fixed-coordinate copy logic.
- Prefer Windows UI Automation / accessibility to locate the copy button.
- If UIA is insufficient, use image-based detection as fallback.
- Completion check should be based on stable copied text, not only timeout.
