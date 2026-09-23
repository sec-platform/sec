import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Temporary editing feedback only. check:full keeps the authority-bound typecheck owner.
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const nativePackage = path.join(repositoryRoot, 'node_modules', '@typescript', 'native');
const nativeVersion = (JSON.parse(readFileSync(path.join(nativePackage, 'package.json'), 'utf8')) as {
  version?: unknown;
}).version;
if (typeof nativeVersion !== 'string' || !/^7\./u.test(nativeVersion)) {
  throw new Error('Native editing feedback requires the pinned TypeScript 7 package.');
}
const compiler = path.join(nativePackage, 'bin', 'tsc');
if (!existsSync(compiler)) {
  throw new Error('Pinned TypeScript 7 native compiler is absent; materialize the repository dependency owner first.');
}
const checkoutId = createHash('sha256').update(`${repositoryRoot}\0${nativeVersion}`).digest('hex').slice(0, 20);
const cacheDirectory = path.join(tmpdir(), 'sec-native-typecheck', checkoutId);
mkdirSync(cacheDirectory, { recursive: true });
const buildInfoFile = path.join(cacheDirectory, 'tsconfig.tsbuildinfo');
const startedAt = performance.now();
const progress = (phase: string, detail: Record<string, unknown> = {}): void => {
  process.stderr.write(`[sec-progress] ${JSON.stringify({
    command: 'typecheck',
    mode: 'native-edit-feedback',
    phase,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...detail
  })}\n`);
};

progress('start', { compiler, nativeVersion, buildInfoFile });
const child = spawn(process.execPath, [
  compiler,
  '--noEmit',
  '--incremental',
  '--tsBuildInfoFile', buildInfoFile,
  '--extendedDiagnostics',
  '--pretty', 'false'
], { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true });
const heartbeat = setInterval(() => progress('running'), 10_000);
let exitCode = 1;
try {
  exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(signal === null ? code ?? 1 : 1));
  });
} finally {
  clearInterval(heartbeat);
}
progress('complete', { exitCode });
process.exitCode = exitCode;
