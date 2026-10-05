// 冒烟测试启动器：用 esbuild 把 scripts/smoke.ts 打成临时 ESM 后用 node 执行。
// 容器里 node_modules 可能是别的平台安装的，显式指向本机已装的 linux arm64 原生包。
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const linuxBin = join(process.cwd(), 'node_modules', '@esbuild', 'linux-arm64', 'bin', 'esbuild')
const esbuild = existsSync(linuxBin)
  ? linuxBin
  : join(process.cwd(), 'node_modules', '.bin', 'esbuild')
const outfile = join(tmpdir(), 'gate-domain-smoke.mjs')

execFileSync(
  esbuild,
  [
    'scripts/smoke.ts',
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--alias:@=${join(process.cwd(), 'src')}`,
    `--outfile=${outfile}`,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
)

execFileSync(process.execPath, [outfile], { stdio: 'inherit', env: process.env })
