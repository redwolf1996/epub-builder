/**
 * Browser polyfill for Node.js `fs` module.
 * Required because `ejs` (dependency of `epub-gen-memory`) imports `fs`.
 * All methods are no-ops since file system access is not available in browser/Tauri webview.
 */
const fs = {
  readFileSync: () => '',
  readFile: (_: unknown, cb: (err: Error | null, data?: Buffer) => void) => cb(new Error('fs.readFile not available in browser')),
  existsSync: () => false,
  statSync: () => ({ isFile: () => false, isDirectory: () => false }),
  readdirSync: () => [] as string[],
  writeFileSync: () => {},
  mkdirSync: () => {},
  promises: {},
}

export default fs
