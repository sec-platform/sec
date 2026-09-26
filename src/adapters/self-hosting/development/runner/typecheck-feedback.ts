import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { enableDevExecutionProgress, reportDevExecutionProgress } from './execution-progress.ts';

// Temporary editing feedback only. typecheck:verified keeps the authority-bound typecheck owner.
async function runNativeTypecheck(): Promise<number> {
  const repositoryRoot = path.resolve(import.meta.dirname, '../../../../..');
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
  reportDevExecutionProgress({
    command: 'typecheck', phase: 'native-compiler', state: 'start',
    detail: { compiler, nativeVersion, buildInfoFile }
  });
  try {
    const child = spawn(process.execPath, [
      compiler,
      '--noEmit',
      '--incremental',
      '--tsBuildInfoFile', buildInfoFile,
      '--extendedDiagnostics',
      '--pretty', 'false'
    ], { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(signal === null ? code ?? 1 : 1));
    });
    reportDevExecutionProgress({
      command: 'typecheck', phase: 'native-compiler',
      state: exitCode === 0 ? 'complete' : 'failed', detail: { exitCode }
    });
    return exitCode;
  } catch (error) {
    reportDevExecutionProgress({ command: 'typecheck', phase: 'native-compiler', state: 'failed' });
    throw error;
  }
}

enableDevExecutionProgress();
reportDevExecutionProgress({ command: 'typecheck', phase: 'command', state: 'start', detail: { mode: 'native-edit-feedback' } });
try {
  const exitCode = await runNativeTypecheck();
  reportDevExecutionProgress({
    command: 'typecheck', phase: 'command',
    state: exitCode === 0 ? 'complete' : 'failed', detail: { exitCode }
  });
  process.exitCode = exitCode;
} catch (error) {
  reportDevExecutionProgress({ command: 'typecheck', phase: 'command', state: 'failed' });
  throw error;
}
