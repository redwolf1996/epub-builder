import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJsonPath = resolve(rootDir, 'package.json')
const tauriConfigPath = resolve(rootDir, 'src-tauri', 'tauri.conf.json')
const cargoTomlPath = resolve(rootDir, 'src-tauri', 'Cargo.toml')

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const version = packageJson.version

if (typeof version !== 'string' || !version.trim()) {
  throw new Error('package.json version is missing or invalid')
}

const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'))
if (tauriConfig.version !== version) {
  tauriConfig.version = version
  await writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8')
}

const cargoToml = await readFile(cargoTomlPath, 'utf8')
const cargoPackageVersionPattern = /(\[package\][\s\S]*?^version = )"[^"]+"$/m
if (!cargoPackageVersionPattern.test(cargoToml)) {
  throw new Error('Failed to locate Cargo.toml package version')
}

const nextCargoToml = cargoToml.replace(
  cargoPackageVersionPattern,
  `$1"${version}"`,
)

if (nextCargoToml !== cargoToml) {
  await writeFile(cargoTomlPath, nextCargoToml, 'utf8')
}

console.log(`Synchronized app version to ${version}`)
