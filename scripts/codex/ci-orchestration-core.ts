import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { CodexDevelopmentVerificationGateEvidenceV2 } from '../../platform/shared/ci-evidence-contract.ts';
import {
  gitChangedFileDiffArgs,
  parseGitChangedRecordsOutput,
  type CodexDevelopmentGitChangedRecordV1
} from '../../platform/shared/ci-git-changed-files.ts';
import { uniqueSorted } from '../../platform/shared/collections.ts';

export const CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1 = 24_000;

export type CodexDevelopmentGateProcessResultV1 = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type CodexDevelopmentGateProcessStepV1 = {
  id: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
};

export type CodexDevelopmentChangedPathSnapshotV1 = {
  records: CodexDevelopmentGitChangedRecordV1[];
  files: string[];
};

export function CodexDevelopmentDefaultGitRevisionV1(
  repositoryRoot: string,
  ref: string
): string | null {
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function CodexDevelopmentDefaultTrackedTreeIsCleanV1(repositoryRoot: string): boolean {
  const result = spawnSync('git', [
    '-c',
    'core.quotepath=false',
    'status',
    '--porcelain=v1',
    '--untracked-files=normal',
    '--ignored=no'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  return result.status === 0 && result.stdout.length === 0;
}

export function CodexDevelopmentChangedFilesFromRecordsV1(
  records: readonly CodexDevelopmentGitChangedRecordV1[]
): string[] {
  return uniqueSorted(records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function CodexDevelopmentDefaultChangedPathsV1(
  repositoryRoot: string,
  baseRef: string
): CodexDevelopmentChangedPathSnapshotV1 | null {
  const result = spawnSync('git', gitChangedFileDiffArgs(baseRef), {
    cwd: repositoryRoot,
    encoding: 'buffer'
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  try {
    const records = parseGitChangedRecordsOutput(result.stdout);
    return {
      records,
      files: CodexDevelopmentChangedFilesFromRecordsV1(records)
    };
  } catch {
    return null;
  }
}

export function CodexDevelopmentDefaultChangedFilesV1(
  repositoryRoot: string,
  baseRef: string
): string[] | null {
  return CodexDevelopmentDefaultChangedPathsV1(repositoryRoot, baseRef)?.files ?? null;
}

export function CodexDevelopmentRunGateProcessV1(
  repositoryRoot: string,
  step: CodexDevelopmentGateProcessStepV1
): Promise<CodexDevelopmentGateProcessResultV1> {
  return new Promise((resolve) => {
    const child = spawn(step.argv[0]!, step.argv.slice(1), {
      cwd: repositoryRoot,
      env: step.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const hash = createHash('sha256');
    let boundedTail = '';
    let settled = false;
    const observe = (chunk: Buffer): void => {
      hash.update(chunk);
      boundedTail = `${boundedTail}${chunk.toString('utf8')}`;
      if (boundedTail.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1) {
        boundedTail = boundedTail.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1);
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      observe(chunk);
      process.stderr.write(chunk);
    });
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        rawOutputDigest: `sha256:${hash.digest('hex')}`,
        failureTail: boundedTail.trim()
      });
    };
    child.on('error', (error) => {
      const message = `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`;
      observe(Buffer.from(message));
      process.stderr.write(message);
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

export function CodexDevelopmentFailureTailV1(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1
    ? combined.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT_V1)
    : combined;
}

export function CodexDevelopmentCreateNotRunGateV2(
  step: Readonly<{ id: string; argv: readonly string[] }>
): CodexDevelopmentVerificationGateEvidenceV2 {
  return {
    id: step.id,
    argv: [...step.argv],
    status: 'not-run',
    exitCode: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    failureTail: null,
    rawOutputDigest: null,
    notRunReason: 'Gate was not reached because preflight or an earlier fail-fast gate did not complete.'
  };
}
