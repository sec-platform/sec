import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256 } from '../../../contracts/canonical.ts';
import {
  createTcbClosureCandidateSnapshot,
  finalizeTcbClosureCandidateSnapshot,
  readTcbClosureCandidateFile
} from '../../verification/platform/trust/compiler.ts';
import {
  SEC_TCB_CLOSURE_RUNTIME_PATH,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
} from '../../verification/platform/trust/contract/root.ts';
import type { SourceProgramFileInput } from '../source-program-model/contract.ts';
import { captureRepositoryAnalysisPolicy } from '../source-program-model/repository-analysis-policy.ts';
import {
  compileReviewedProcessDispatcherProjection,
  resolveImmutableRevisionProcessDispatchers,
  reviewedProcessDispatchersFromExactProjection
} from './cli.ts';

const runtimePath = 'src/adapters/providers/git-read/exact-blob.ts';
const leafPath = 'src/adapters/providers/git-read/fixture-leaf.ts';
const unrelatedPath = 'src/fixture/cli.ts';
const compilerInputDigest = rawSha256('adopted compiler A and its admitted dependencies');
const dispatcher = `${runtimePath}::function-declaration:runGit::spawnSync#1`;
const runtimeSource = `import { spawnSync } from 'node:child_process';
import './fixture-leaf.ts';
export function runGit() { return spawnSync('git', []); }
`;

function file(path: string, source: string): SourceProgramFileInput {
  return { path, source, contentDigest: rawSha256(source) };
}

function fixture() {
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-dispatcher-projection-'));
  try {
    const root = realpathSync.native(createdRoot);
    // A's entrypoint policy is applied to B's data. B cannot supply executable
    // recognition code or replace A's registry by writing these same paths.
    const files = SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints.map(repositoryPath =>
      file(repositoryPath, repositoryPath === runtimePath ? runtimeSource : 'export {};\n'));
    files.push(
      file(leafPath, 'export const leaf = 1;\r\n'),
      file(SEC_TCB_CLOSURE_RUNTIME_PATH, 'throw new Error("candidate compiler must never execute");\n'),
      file(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, '{"runtimeEntrypoints":["foreign.ts"]}\n'),
      file(unrelatedPath, 'export const unrelated = 1;\n')
    );
    const write = (input: SourceProgramFileInput) => {
      const absolute = path.join(root, input.path);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, input.source);
    };
    for (const input of files) write(input);
    return { root, files, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) {
    try {
      rmSync(createdRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Dispatcher fixture setup and cleanup failed');
    }
    throw error;
  }
}

test('the production projection interprets candidate B bytes with adopted compiler A and exact raw read identities', async () => {
  const subject = fixture();
  try {
    const projection = await compileReviewedProcessDispatcherProjection(subject.root, subject.files, compilerInputDigest);
    // An accidental no-argument trustedRuntimeClosure reads the real interpreter
    // tree and returns many dispatchers, so it cannot satisfy this independent oracle.
    expect(projection.reviewedProcessDispatchers).toEqual([dispatcher]);
    expect(Object.keys(projection.sourceInputDigests)).toEqual([
      ...SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints, leafPath
    ].sort());
    expect(projection.sourceInputDigests[leafPath]).toBe(rawSha256('export const leaf = 1;\r\n'));
    expect(projection.compilerInputDigest).toBe(compilerInputDigest);
    expect(projection.sourceInputDigests[SEC_TCB_CLOSURE_RUNTIME_PATH]).toBeUndefined();
    expect(projection.sourceInputDigests[SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH]).toBeUndefined();
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, compilerInputDigest,
      JSON.parse(JSON.stringify(projection)))).toEqual([dispatcher]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.sourceInputDigests)).toBe(true);
  } finally {
    subject.cleanup();
  }
});

test('unread candidate compiler, registry and unrelated edits cannot replace adopted policy or change dispatcher facts', async () => {
  const subject = fixture();
  try {
    const projection = await compileReviewedProcessDispatcherProjection(subject.root, subject.files, compilerInputDigest);
    const changed = subject.files.map(input => [unrelatedPath, SEC_TCB_CLOSURE_RUNTIME_PATH,
      SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH].includes(input.path)
      ? file(input.path, 'throw new Error("candidate data is not the adopted compiler");\n') : input);
    for (const input of changed) subject.write(input);
    expect(reviewedProcessDispatchersFromExactProjection(changed, compilerInputDigest, projection)).toEqual([dispatcher]);
    const recomputed = await compileReviewedProcessDispatcherProjection(subject.root, changed, compilerInputDigest);
    expect(recomputed.reviewedProcessDispatchers).toEqual([dispatcher]);
    expect(captureRepositoryAnalysisPolicy(recomputed.reviewedProcessDispatchers))
      .toEqual(captureRepositoryAnalysisPolicy([dispatcher]));
  } finally {
    subject.cleanup();
  }
});

test('compiler identity changes and legacy single-domain payloads cannot reuse candidate dispatcher facts', async () => {
  const subject = fixture();
  try {
    const projection = await compileReviewedProcessDispatcherProjection(subject.root, subject.files, compilerInputDigest);
    const changedCompiler = rawSha256('changed adopted compiler or dependency generation');
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, changedCompiler, projection)).toBeNull();
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, compilerInputDigest, {
      inputDigests: projection.sourceInputDigests, reviewedProcessDispatchers: [dispatcher]
    })).toBeNull();
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, compilerInputDigest, null)).toBeNull();
    // Same-root ordinary editing conservatively changes the compiler key. Cold
    // recomputation still preserves policy, rather than treating a miss as empty.
    const recomputed = await compileReviewedProcessDispatcherProjection(subject.root, subject.files, changedCompiler);
    expect(recomputed.reviewedProcessDispatchers).toEqual([dispatcher]);
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, changedCompiler, recomputed)).toEqual([dispatcher]);
  } finally {
    subject.cleanup();
  }
});

test('producer rejects cross-root relabeling and absent census inputs instead of stamping caller digests', async () => {
  const subject = fixture();
  try {
    const relabeled = subject.files.map(input => input.path === runtimePath
      ? file(runtimePath, 'export {};\n') : input);
    await expect(compileReviewedProcessDispatcherProjection(subject.root, relabeled, compilerInputDigest))
      .rejects.toThrow('read set does not match the exact candidate census');
    await expect(compileReviewedProcessDispatcherProjection(subject.root,
      subject.files.filter(input => input.path !== leafPath), compilerInputDigest))
      .rejects.toThrow('read set does not match the exact candidate census');
  } finally {
    subject.cleanup();
  }
});

test('changed candidate runtime bytes invalidate baseline reuse and cold compilation observes the changed dispatchers', async () => {
  const subject = fixture();
  try {
    const projection = await compileReviewedProcessDispatcherProjection(subject.root, subject.files, compilerInputDigest);
    const changed = subject.files.map(input => input.path === runtimePath
      ? file(runtimePath, "import './fixture-leaf.ts';\nexport {};\n") : input);
    for (const input of changed) subject.write(input);
    expect(reviewedProcessDispatchersFromExactProjection(changed, compilerInputDigest, projection)).toBeNull();
    const recomputed = await compileReviewedProcessDispatcherProjection(subject.root, changed, compilerInputDigest);
    expect(recomputed.reviewedProcessDispatchers).toEqual([]);
    expect(reviewedProcessDispatchersFromExactProjection(subject.files, compilerInputDigest, recomputed)).toBeNull();
    expect(reviewedProcessDispatchersFromExactProjection(changed, compilerInputDigest, recomputed)).toEqual([]);
  } finally {
    subject.cleanup();
  }
});

test('a cold formal transition obtains baseline A from its actual root while current B has different dispatchers', async () => {
  const baseline = fixture();
  try {
    const candidate = fixture();
    try {
      const candidateFiles = candidate.files.map(input => input.path === runtimePath
        ? file(runtimePath, "import './fixture-leaf.ts';\nexport {};\n") : input);
      for (const input of candidateFiles) candidate.write(input);
      const baselineProjection = await compileReviewedProcessDispatcherProjection(
        baseline.root, baseline.files, compilerInputDigest
      );
      const currentProjection = await compileReviewedProcessDispatcherProjection(
        candidate.root, candidateFiles, compilerInputDigest
      );
      expect(baselineProjection.reviewedProcessDispatchers).toEqual([dispatcher]);
      expect(currentProjection.reviewedProcessDispatchers).toEqual([]);
      expect(baselineProjection.sourceInputDigests[runtimePath]).toBe(rawSha256(runtimeSource));
      expect(currentProjection.sourceInputDigests[runtimePath])
        .toBe(rawSha256("import './fixture-leaf.ts';\nexport {};\n"));
      expect(reviewedProcessDispatchersFromExactProjection(candidateFiles, compilerInputDigest, baselineProjection)).toBeNull();
      expect(reviewedProcessDispatchersFromExactProjection(baseline.files, compilerInputDigest, currentProjection)).toBeNull();
      expect(await resolveImmutableRevisionProcessDispatchers(
        baseline.files, currentProjection, baseline.root
      )).toEqual([dispatcher]);
      await expect(resolveImmutableRevisionProcessDispatchers(baseline.files, currentProjection))
        .rejects.toThrow('require an exact cached trusted-runtime projection');
      // Matching current/baseline input reuses the same observation without
      // attempting to read the optional, deliberately unavailable fallback root.
      expect(await resolveImmutableRevisionProcessDispatchers(
        candidateFiles, currentProjection, path.join(candidate.root, 'unread-root')
      )).toEqual([]);
    } finally {
      candidate.cleanup();
    }
  } finally {
    baseline.cleanup();
  }
});

test('the source owner finalizes raw reads and observed absences once, and rejects later appearance', () => {
  const subject = fixture();
  try {
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: subject.root });
    readTcbClosureCandidateFile(leafPath, { candidateSnapshot: snapshot });
    expect(() => readTcbClosureCandidateFile('missing.ts', { candidateSnapshot: snapshot })).toThrow('module is missing');
    const inputs = finalizeTcbClosureCandidateSnapshot(snapshot);
    expect(inputs).toEqual({ [leafPath]: rawSha256('export const leaf = 1;\r\n'), 'missing.ts': null });
    expect(Object.isFrozen(inputs)).toBe(true);
    const observedAbsenceProjection = {
      schema: 'sec-reviewed-process-dispatchers-v2', compilerInputDigest,
      sourceInputDigests: inputs, reviewedProcessDispatchers: []
    };
    expect(reviewedProcessDispatchersFromExactProjection(subject.files,
      compilerInputDigest, observedAbsenceProjection)).toEqual([]);
    expect(reviewedProcessDispatchersFromExactProjection([
      ...subject.files, file('missing.ts', 'export {};\n')
    ], compilerInputDigest, observedAbsenceProjection)).toBeNull();
    expect(() => finalizeTcbClosureCandidateSnapshot(snapshot)).toThrow('already finalized');
    expect(() => readTcbClosureCandidateFile(leafPath, { candidateSnapshot: snapshot })).toThrow('already finalized');

    const drifting = createTcbClosureCandidateSnapshot({ candidateRoot: subject.root });
    expect(() => readTcbClosureCandidateFile('missing.ts', { candidateSnapshot: drifting })).toThrow('module is missing');
    subject.write(file('missing.ts', 'export {};\n'));
    expect(() => finalizeTcbClosureCandidateSnapshot(drifting)).toThrow('after observing a missing module');
  } finally {
    subject.cleanup();
  }
});
