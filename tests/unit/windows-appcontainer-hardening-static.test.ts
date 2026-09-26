import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import { readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

import { runObservedCommand } from '../../src/adapters/runtime-state/physical/runtime/observed-process.ts';
import {
  arbitrateNativeExecutionDeadlinesForTests,
  createNativeExecutionBudgetForTests
} from '../../src/adapters/runtime-state/physical/test/windows-appcontainer.ts';

const RECOVERY_OWNER_OBSERVATION_SCHEMA = 'sec-recovery-owner-behavior-observation-v1' as const;
const RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES = 512;

type RecoveryOwnerScenario =
  | 'canonical-key-order'
  | 'owner-absent'
  | 'persisted-mismatch'
  | 'persisted-workspace-mismatch'
  | 'persisted-staging-identity-mismatch'
  | 'persisted-staging-directory-mismatch'
  | 'persisted-app-container-name-mismatch'
  | 'workspace-mismatch'
  | 'staging-identity-mismatch'
  | 'staging-directory-mismatch'
  | 'app-container-name-mismatch'
  | 'result-path-mismatch'
  | 'malformed-expected-owner'
  | 'malformed-persisted-owner';

type RecoveryOwnerObservationResult = 'accepted' | 'cleanup' | 'unexpected';

interface RecoveryOwnerObservation {
  readonly schema: typeof RECOVERY_OWNER_OBSERVATION_SCHEMA;
  readonly result: RecoveryOwnerObservationResult;
}

interface RecoveryOwnerProjectionCleanupState {
  authorized: boolean;
}

function recoveryOwnerProjectionHarness(): string {
  return String.raw`
const __recoveryOwnerObservationSchema = 'sec-recovery-owner-behavior-observation-v1';

async function __recoveryOwnerBehaviorProjection(payload: {
  readonly scenario: string;
  readonly transactionRoot: string;
  readonly stagingRoot: string;
}): Promise<Readonly<{ schema: string; result: 'accepted' | 'cleanup' | 'unexpected' }>> {
  const authorityBindingDigest = 'sha256:' + 'a'.repeat(64);
  const stagingIdentityDigest = 'sha256:' + 'b'.repeat(64);
  const alternateStagingIdentityDigest = 'sha256:' + 'c'.repeat(64);
  const baseOwner: WindowsAppContainerRecoveryOwner = Object.freeze({
    formatVersion: RECOVERY_OWNER_FORMAT_VERSION,
    workspaceIdentityDigest: authorityBindingDigest,
    stagingIdentityDigest,
    stagingDirectoryName: path.basename(payload.stagingRoot),
    runtimeRelativePath: RUNTIME_DIRECTORY_NAME,
    resultFileName: NATIVE_RESULT_FILE_NAME,
    appContainerName: buildAppContainerName(payload.stagingRoot, stagingIdentityDigest),
    appContainerSid: 'S-1-15-2-1-2-3-4-5-6-7'
  });
  let expectedOwner: WindowsAppContainerRecoveryOwner | null = baseOwner;
  let persistedOwner: Record<string, unknown> | undefined = baseOwner;
  let requestedNativeResultPath = nativeResultPath(payload.transactionRoot);
  const firstAlternateName = 'sec.sm3.000000000000.111111111111111111111111';
  const secondAlternateName = 'sec.sm3.222222222222.333333333333333333333333';
  const alternateAppContainerName = baseOwner.appContainerName === firstAlternateName
    ? secondAlternateName
    : firstAlternateName;
  switch (payload.scenario) {
    case 'owner-absent':
      persistedOwner = undefined;
      break;
    case 'persisted-mismatch':
      persistedOwner = { ...baseOwner, appContainerSid: 'S-1-15-2-1-2-3-4-5-6-8' };
      break;
    case 'persisted-workspace-mismatch':
      persistedOwner = { ...baseOwner, workspaceIdentityDigest: alternateStagingIdentityDigest };
      break;
    case 'persisted-staging-identity-mismatch':
      persistedOwner = { ...baseOwner, stagingIdentityDigest: alternateStagingIdentityDigest };
      break;
    case 'persisted-staging-directory-mismatch':
      persistedOwner = { ...baseOwner, stagingDirectoryName: 'forged' };
      break;
    case 'persisted-app-container-name-mismatch':
      persistedOwner = { ...baseOwner, appContainerName: alternateAppContainerName };
      break;
    case 'workspace-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, workspaceIdentityDigest: alternateStagingIdentityDigest });
      persistedOwner = expectedOwner;
      break;
    case 'staging-identity-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, stagingIdentityDigest: alternateStagingIdentityDigest });
      persistedOwner = expectedOwner;
      break;
    case 'staging-directory-mismatch':
      expectedOwner = Object.freeze({ ...baseOwner, stagingDirectoryName: 'forged' });
      persistedOwner = expectedOwner;
      break;
    case 'app-container-name-mismatch':
      expectedOwner = Object.freeze({
        ...baseOwner,
        appContainerName: alternateAppContainerName
      });
      persistedOwner = expectedOwner;
      break;
    case 'result-path-mismatch':
      requestedNativeResultPath += '.forged';
      break;
    case 'malformed-expected-owner':
      expectedOwner = null;
      persistedOwner = undefined;
      break;
    case 'malformed-persisted-owner':
      persistedOwner = { ...baseOwner, extraKey: true };
      break;
  }
  if (persistedOwner !== undefined) {
    const entries = Object.entries(persistedOwner);
    const orderedEntries = payload.scenario === 'canonical-key-order' ? entries.reverse() : entries;
    await writeFile(
      path.join(
        payload.transactionRoot,
        WINDOWS_APPCONTAINER_RECOVERY_CONTRACT.ownerFileName
      ),
      JSON.stringify(Object.fromEntries(orderedEntries)) + '\n',
      { flag: 'wx' }
    );
  }
  try {
    await assertRecoveryOwner(
      expectedOwner as WindowsAppContainerRecoveryOwner,
      {
        stagingRoot: payload.stagingRoot,
        transactionRoot: payload.transactionRoot,
        stagingIdentityDigest
      },
      {
        formatVersion: 'windows-appcontainer-execution-binding-v1',
        stagingRoot: payload.stagingRoot,
        authorityBindingDigest,
        deadlineAtUnixMs: Date.now() + 60_000
      } as WindowsAppContainerExecutionBindingReceipt,
      requestedNativeResultPath
    );
    return Object.freeze({ schema: __recoveryOwnerObservationSchema, result: 'accepted' });
  } catch (error) {
    const result = error instanceof WindowsAppContainerExecutionError && error.phase === 'cleanup'
      ? 'cleanup'
      : 'unexpected';
    return Object.freeze({ schema: __recoveryOwnerObservationSchema, result });
  }
}

if (import.meta.main) {
  const payload = JSON.parse(process.argv[2] ?? 'null') as {
    readonly scenario: string;
    readonly transactionRoot: string;
    readonly stagingRoot: string;
  };
  const observation = await __recoveryOwnerBehaviorProjection(payload);
  process.stdout.write(JSON.stringify(observation) + '\n');
}
`;
}

function foldedLocalPath(value: string): string {
  return path.resolve(value).toLocaleLowerCase('en-US');
}

async function buildRecoveryOwnerProjection(
  entryPath: string,
  source: string,
  outputPath: string
): Promise<void> {
  const canonicalEntryPath = foldedLocalPath(entryPath);
  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'bun',
    format: 'esm',
    splitting: false,
    minify: false,
    sourcemap: 'none',
    plugins: [{
      name: 'recovery-owner-exact-module-projection',
      setup(build) {
        build.onLoad({ filter: /executor\.ts$/u }, async (args) => {
          if (foldedLocalPath(args.path) !== canonicalEntryPath) return undefined;
          return {
            contents: `${source}\n${recoveryOwnerProjectionHarness()}`,
            loader: 'ts'
          };
        });
      }
    }]
  });
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(`Recovery-owner projection build failed: ${result.logs.map(String).join('; ')}`);
  }
  await writeFile(outputPath, Buffer.from(await result.outputs[0]!.arrayBuffer()), { flag: 'wx' });
}

function parseRecoveryOwnerObservation(source: string): RecoveryOwnerObservation {
  if (Buffer.byteLength(source, 'utf8') > RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES) {
    throw new Error('Recovery-owner projection observation exceeded its closed transport bound');
  }
  if (!source.endsWith('\n') || source.includes('\r')) {
    throw new Error('Recovery-owner projection returned a noncanonical line ending');
  }
  const value = JSON.parse(source.slice(0, -1)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'result,schema') {
    throw new Error('Recovery-owner projection returned an invalid observation shape');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== RECOVERY_OWNER_OBSERVATION_SCHEMA ||
    (record.result !== 'accepted' && record.result !== 'cleanup' && record.result !== 'unexpected')) {
    throw new Error('Recovery-owner projection returned an invalid observation value');
  }
  const observation: RecoveryOwnerObservation = Object.freeze({
    schema: RECOVERY_OWNER_OBSERVATION_SCHEMA,
    result: record.result
  });
  if (source !== `${JSON.stringify(observation)}\n`) {
    throw new Error('Recovery-owner projection returned noncanonical JSON bytes');
  }
  return observation;
}

async function observeRecoveryOwnerScenario(
  bundlePath: string,
  scenarioRoot: string,
  scenario: RecoveryOwnerScenario,
  cleanupState: RecoveryOwnerProjectionCleanupState
): Promise<RecoveryOwnerObservation> {
  const transactionRoot = path.join(scenarioRoot, 'transaction');
  const stagingRoot = path.join(transactionRoot, 's');
  await mkdir(stagingRoot, { recursive: true });
  const observedBytes: Record<'stdout' | 'stderr', number> = { stdout: 0, stderr: 0 };
  const observedChunks: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
  let outcome: Awaited<ReturnType<typeof runObservedCommand>>;
  try {
    outcome = await runObservedCommand(process.execPath, [
      bundlePath,
      JSON.stringify({ scenario, transactionRoot, stagingRoot })
    ], {
      cwd: scenarioRoot,
      maxObservedOutputBytes: RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES,
      timeoutMs: 10_000,
      terminationGraceMs: 250,
      terminationDeadlineMs: 2_000,
      onChunk(stream, byteLength) {
        observedBytes[stream] += byteLength;
        if (observedBytes[stream] > RECOVERY_OWNER_OBSERVATION_LIMIT_BYTES) {
          throw new Error('Recovery-owner projection stream exceeded its acquisition bound');
        }
      },
      onOutput(stream, chunk) {
        observedChunks[stream].push(Buffer.from(chunk));
      }
    });
  } catch {
    cleanupState.authorized = false;
    throw new Error('Recovery-owner projection process observation did not settle');
  }
  const cleanupAuthorized = outcome.started
    ? outcome.termination.childCloseObserved &&
      outcome.termination.streamsDrained &&
      outcome.termination.treeClosed
    : outcome.termination.streamsDrained && outcome.termination.treeClosed;
  cleanupState.authorized &&= cleanupAuthorized;
  if (outcome.status !== 'exited' || outcome.exitCode !== 0 ||
    outcome.stdout.observerTruncated || outcome.stderr.observerTruncated ||
    outcome.stderr.bytes !== 0 ||
    !outcome.termination.childCloseObserved ||
    !outcome.termination.streamsDrained ||
    !outcome.termination.treeClosed) {
    throw new Error('Recovery-owner projection process did not settle successfully');
  }
  const stdoutBytes = Buffer.concat(observedChunks.stdout);
  const stderrBytes = Buffer.concat(observedChunks.stderr);
  if (stdoutBytes.byteLength !== outcome.stdout.bytes ||
    stderrBytes.byteLength !== outcome.stderr.bytes ||
    observedBytes.stdout !== outcome.stdout.bytes ||
    observedBytes.stderr !== outcome.stderr.bytes) {
    throw new Error('Recovery-owner projection stream evidence did not match captured bytes');
  }
  const stdout = stdoutBytes.toString('utf8');
  if (!Buffer.from(stdout, 'utf8').equals(stdoutBytes)) {
    throw new Error('Recovery-owner projection stdout was not canonical UTF-8');
  }
  return parseRecoveryOwnerObservation(stdout);
}

async function assertRecoveryOwnerBehavioralProjection(
  entryPath: string,
  source: string
): Promise<void> {
  const projectionRoot = await mkdtemp(path.join(tmpdir(), 'sec-recovery-owner-proof-'));
  const cleanupState: RecoveryOwnerProjectionCleanupState = { authorized: true };
  try {
    const canonicalBundle = path.join(projectionRoot, 'canonical.mjs');
    await buildRecoveryOwnerProjection(entryPath, source, canonicalBundle);
    const scenarios: ReadonlyArray<Readonly<{
      scenario: RecoveryOwnerScenario;
      expected: RecoveryOwnerObservationResult;
    }>> = [
      { scenario: 'canonical-key-order', expected: 'accepted' },
      { scenario: 'owner-absent', expected: 'cleanup' },
      { scenario: 'persisted-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-workspace-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-staging-identity-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-staging-directory-mismatch', expected: 'cleanup' },
      { scenario: 'persisted-app-container-name-mismatch', expected: 'cleanup' },
      { scenario: 'workspace-mismatch', expected: 'cleanup' },
      { scenario: 'staging-identity-mismatch', expected: 'cleanup' },
      { scenario: 'staging-directory-mismatch', expected: 'cleanup' },
      { scenario: 'app-container-name-mismatch', expected: 'cleanup' },
      { scenario: 'result-path-mismatch', expected: 'cleanup' },
      { scenario: 'malformed-expected-owner', expected: 'cleanup' },
      { scenario: 'malformed-persisted-owner', expected: 'cleanup' }
    ];
    for (const [index, scenario] of scenarios.entries()) {
      const observation = await observeRecoveryOwnerScenario(
        canonicalBundle,
        path.join(projectionRoot, `canonical-${index}`),
        scenario.scenario,
        cleanupState
      );
      expect(observation).toEqual({
        schema: RECOVERY_OWNER_OBSERVATION_SCHEMA,
        result: scenario.expected
      });
    }

  } finally {
    if (cleanupState.authorized) {
      await rm(projectionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  }
}

test('Windows AppContainer recovery ownership and deadlines are behaviorally closed', async () => {
  const root = path.resolve(import.meta.dir, '../..');
  const executorPath = 'src/adapters/runtime-state/physical/runtime/windows-appcontainer/executor.ts';
  const executorSource = await readCompilerTypeScriptMutationFixture(executorPath, 'transpile-input');

  await assertRecoveryOwnerBehavioralProjection(
    path.join(root, executorPath),
    executorSource
  );

  expect(arbitrateNativeExecutionDeadlinesForTests(60_000)).toEqual({
    childTimeoutMs: 60_000,
    hostWatchdogMs: 70_000
  });
  expect(arbitrateNativeExecutionDeadlinesForTests(undefined)).toEqual({
    childTimeoutMs: 120_000,
    hostWatchdogMs: 130_000
  });
  expect(createNativeExecutionBudgetForTests(60_000, 1_000)).toEqual({
    startedAtMs: 1_000,
    timeoutMs: 60_000
  });
});
