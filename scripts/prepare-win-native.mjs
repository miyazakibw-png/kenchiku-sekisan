/**
 * Windows インストーラを作る前に、better-sqlite3 の Windows 用（Electron ABI）バイナリを取り込む。
 * Linux 上でビルドすると Linux 用のバイナリが同梱され、Windows で起動できないため。
 * 作成後は `npm run rebuild:electron` で開発用（このパソコン用）に戻すこと。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const moduleDir = join(root, 'node_modules', 'better-sqlite3')
const require = createRequire(import.meta.url)
const electronVersion = require(join(root, 'node_modules', 'electron', 'package.json')).version

execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'prebuild-install', 'bin.js'),
    '--runtime=electron',
    `--target=${electronVersion}`,
    '--arch=x64',
    '--platform=win32',
    '--tag-prefix=v',
    '--force'
  ],
  { cwd: moduleDir, stdio: 'inherit' }
)

const binary = join(moduleDir, 'build', 'Release', 'better_sqlite3.node')
const header = readFileSync(binary).subarray(0, 2).toString('latin1')
if (header !== 'MZ') {
  throw new Error(`Windows用のbetter-sqlite3を取得できませんでした: ${binary}`)
}
console.log(`Windows用 better-sqlite3 を用意しました（Electron ${electronVersion}）`)
