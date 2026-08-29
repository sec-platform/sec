import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import type { CodexDevelopmentVerificationGateEvidenceV2 } from '../index.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, gitChangedFileDiffArgs, parseGitChangedRecordsOutput, type CodexDevelopmentGitChangedRecord, type CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../../system-architecture/repository-modules/contract.ts';
import {
  activeDocumentationPaths,
  parseDocumentationAuthorityRegistry
} from '../../../control/documentation/authority.ts';
import { isolatedGitReadEnvironment } from '../../../external-capabilities/git-read/runtime/session.ts';
import { createTestImpactSourceProvider, type CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import {
  CodexDevelopmentListExactGitTreeEntries,
  CodexDevelopmentReadExactGitBlobEntry,
  CodexDevelopmentReadExactGitTextBlobsBatch
} from '../../../external-capabilities/git-read/exact-blob.ts';

export const CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT = 24_000;

export type CodexDevelopmentGateProcessResult = {
  code: number;
  rawOutputDigest: string;
  failureTail: string;
};

export type CodexDevelopmentGateProcessStep = {
  id: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
};

export type CodexDevelopmentChangedPathSnapshot = {
  records: CodexDevelopmentGitChangedRecord[];
  files: string[];
  transitionObservation: CodexDevelopmentTestImpactTransitionObservation;
};

export function CodexDevelopmentDefaultGitRevision(
  repositoryRoot: string,
  ref: string
): string | null {
  const result = spawnSync('git', ['rev-parse', ref], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment()
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function CodexDevelopmentDefaultTrackedTreeIsClean(repositoryRoot: string): boolean {
  const result = spawnSync('git', [
    '-c',
    'core.quotepath=false',
    '-c',
    'core.autocrlf=true',
    'status',
    '--porcelain=v1',
    '--untracked-files=normal',
    '--ignored=no'
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: isolatedGitReadEnvironment()
  });
  return result.status === 0 && result.stdout.length === 0;
}

export function CodexDevelopmentChangedFilesFromRecords(
  records: readonly CodexDevelopmentGitChangedRecord[]
): string[] {
  return uniqueSorted(records.flatMap((record) => (
    record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
  )));
}

export function CodexDevelopmentDefaultChangedPaths(
  repositoryRoot: string,
  baseSha: string,
  headSha: string
): CodexDevelopmentChangedPathSnapshot | null {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(baseSha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(headSha)) return null;
  const result = spawnSync('git', gitChangedFileDiffArgs(baseSha, headSha), {
    cwd: repositoryRoot,
    encoding: 'buffer',
    env: isolatedGitReadEnvironment()
  });
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  try {
    const records = parseGitChangedRecordsOutput(result.stdout);
    return {
      records,
      files: CodexDevelopmentChangedFilesFromRecords(records),
      transitionObservation: CodexDevelopmentCreateTestImpactTransitionObservation({
        baseSha,
        headSha,
        records,
        readPathBlob: (revision, repositoryPath) => {
          try {
            const entry = CodexDevelopmentReadExactGitBlobEntry({
              repositoryRoot,
              commitSha: revision,
              repositoryPath
            });
            return { mode: entry.mode, blobSha: entry.blobSha };
          } catch (error) {
            if (error instanceof Error
                && error.message === `Exact Git blob path is missing at ${revision}: ${repositoryPath}.`) {
              return null;
            }
            throw error;
          }
        }
      })
    };
  } catch {
    return null;
  }
}

/**
 * The trusted base observes the candidate commit as immutable Git data. The
 * candidate never executes its own selector implementation or chooses files.
 */
export function CodexDevelopmentExactGitTestImpactSourceProvider(
  repositoryRoot: string,
  candidateSha: string
): CodexDevelopmentTestImpactSourceProvider {
  const treeEntries = CodexDevelopmentListExactGitTreeEntries({
    repositoryRoot,
    commitSha: candidateSha
  });
  const entriesByPath = new Map(treeEntries.map((entry) => [entry.repositoryPath, entry]));
  const ordinaryEntries = treeEntries.filter((entry) => (
    (entry.mode === '100644' || entry.mode === '100755') && entry.type === 'blob'
  ));
  const descriptorLikeEntries = treeEntries.filter(({ repositoryPath }) => (
    repositoryPath.endsWith('/sec.module.json')
  ));
  if (descriptorLikeEntries.length === 0) {
    throw new Error('Exact candidate module descriptor census is missing.');
  }
  const unsafeDescriptor = descriptorLikeEntries.find((entry) => (
    (entry.mode !== '100644' && entry.mode !== '100755') || entry.type !== 'blob'
  ));
  if (unsafeDescriptor !== undefined) {
    throw new Error(
      `Exact candidate module descriptor is not an ordinary blob: ${unsafeDescriptor.repositoryPath}.`
    );
  }
  const descriptorEntries = descriptorLikeEntries;
  const authorityEntry = ordinaryEntries.find(({ repositoryPath }) => (
    repositoryPath === 'docs/authority.json'
  ));
  if (authorityEntry === undefined) {
    throw new Error('Exact candidate is missing the documentation authority registry.');
  }
  const controlSources = new Map(CodexDevelopmentReadExactGitTextBlobsBatch({
    repositoryRoot,
    entries: [...descriptorEntries, authorityEntry]
  }).map(({ repositoryPath, source }) => [repositoryPath, source]));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: ordinaryEntries.map(({ repositoryPath }) => repositoryPath),
    descriptorSources: descriptorEntries.map(({ repositoryPath }) => ({
      descriptorPath: repositoryPath,
      source: controlSources.get(repositoryPath)!
    }))
  });
  const documentationRegistrySource = controlSources.get('docs/authority.json');
  if (documentationRegistrySource === undefined) {
    throw new Error('Exact candidate documentation authority registry was not observed.');
  }
  const candidateActiveDocumentationPaths = activeDocumentationPaths(
    parseDocumentationAuthorityRegistry(documentationRegistrySource)
  );
  let provider!: CodexDevelopmentTestImpactSourceProvider;
  let sourceByPath: ReadonlyMap<string, string> | null = null;
  provider = createTestImpactSourceProvider({
    repositoryFiles: treeEntries.map(({ repositoryPath }) => repositoryPath),
    moduleMembership,
    activeDocumentationPaths: candidateActiveDocumentationPaths,
    readModuleSource: (moduleFile) => {
      if (sourceByPath === null) {
        const ordinaryModuleEntries = provider.moduleFiles.flatMap((repositoryPath) => {
          const entry = entriesByPath.get(repositoryPath);
          return entry !== undefined
              && (entry.mode === '100644' || entry.mode === '100755')
              && entry.type === 'blob'
            ? [entry]
            : [];
        });
        sourceByPath = new Map(CodexDevelopmentReadExactGitTextBlobsBatch({
          repositoryRoot,
          entries: ordinaryModuleEntries
        }).map(({ repositoryPath, source }) => [repositoryPath, source]));
      }
      return sourceByPath.get(moduleFile) ?? null;
    }
  });
  return provider;
}

export function CodexDevelopmentRunGateProcess(
  repositoryRoot: string,
  step: CodexDevelopmentGateProcessStep
): Promise<CodexDevelopmentGateProcessResult> {
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
      if (boundedTail.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT) {
        boundedTail = boundedTail.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT);
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

export function CodexDevelopmentFailureTail(output: string, fallback: string): string {
  const combined = output.trim() || fallback;
  return combined.length > CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT
    ? combined.slice(-CODEX_DEVELOPMENT_FAILURE_TAIL_CHARACTER_LIMIT)
    : combined;
}

export function CodexDevelopmentCreateNotRunGate(
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
