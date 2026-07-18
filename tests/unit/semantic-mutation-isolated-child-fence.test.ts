import { createHash } from 'node:crypto';
import {
  chmod,
  cp,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  buildAcceptanceCoverage,
  planSemanticMutationVerificationCapabilities
} from '../../platform/compiler/index.ts';
import {
  buildSemanticMutationIsolatedChildOutcome,
  parseSemanticMutationIsolatedChildOutcomeBytes,
  publishSemanticMutationIsolatedChildOutcome,
  semanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomePath,
  semanticMutationIsolatedChildOutcomePendingPath,
  type SemanticMutationIsolatedChildFailureStage
} from '../../platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts';
import {
  classifySemanticMutationIsolatedTermination,
  publishSemanticMutationIsolatedProgressCheckpoint,
  readSemanticMutationIsolatedProgressTrace,
  SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES,
  SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH,
  semanticMutationIsolatedBootstrapBytes,
  semanticMutationIsolatedProgressCheckpointBytes,
  semanticMutationIsolatedProgressCheckpointPath,
  semanticMutationIsolatedProgressCheckpointPendingPath,
  semanticMutationIsolatedStagedLoaderBytes,
  type SemanticMutationIsolatedProgressCheckpoint
} from '../../platform/compiler/semantic-mutation/isolated-verification-child-progress.ts';
import {
  readSemanticMutationIsolatedPhaseTelemetry
} from '../../platform/compiler/semantic-mutation/isolated-verification-phase-telemetry.ts';
import {
  assertIsolatedStagingTree,
  runIsolatedStagingScanBatchesForTests
} from '../../platform/compiler/verify/assert-isolated-staging-tree.ts';
import { runPolicyGate } from '../../platform/compiler/verify/run-policy-gate.ts';
import {
  buildSemanticMutationIsolatedVerificationEnvironment,
  classifySemanticMutationIsolatedRunnerBuildForTests,
  createSemanticMutationIsolatedVerificationSupervisor,
  probeSemanticMutationIsolatedRuntimeCapability,
  projectSemanticMutationIsolatedRuntimeCapabilitySubstageForTests,
  projectSemanticMutationIsolatedVerificationFailureForTests,
  relocateSemanticMutationIsolatedRunnerBundleForTests,
  runSemanticMutationIsolatedVerificationChild,
  semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests,
  SemanticMutationIsolatedVerificationUnavailableError,
  type SemanticMutationIsolatedRuntimeInputSources
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  RUNTIME_VERIFICATION_INVOCATION_CONTRACT
} from '../../platform/compiler/verify/runtime-verification-invocation-contract.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  materializeSemanticMutationIsolatedRuntime,
  SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT,
  semanticMutationRuntimeSourceSnapshotCacheStatsForTests
} from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import {
  semanticMutationIsolatedVerificationEvidenceDigest
} from '../../platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts';
import {
  assertStagedVerificationProofBinding,
  consumeStagedVerificationProof,
  issueStagedVerificationProof,
  issueStagedVerificationProofSource,
  revalidateStagedVerificationProof,
  type StagedVerificationProofBinding
} from '../../platform/compiler/verify/staged-verification-proof.ts';
import {
  assertStagedVerificationLiveContext
} from '../../platform/compiler/verify/verify-project.ts';
import { initWorkspace } from '../../platform/orchestrator.ts';
import { compileWorkspace } from '../../platform/orchestrator/pipeline-orchestrator.ts';
import type { AcceptanceCoverageReport } from '../../platform/shared/acceptance-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { readLockFile } from '../../platform/shared/lock-utils.ts';
import type {
  ObservedCommandOptions,
  ObservedCommandOutcome
} from '../../platform/shared/observed-process.ts';
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  ensureIsolatedProcessDirectories,
  runCommand
} from '../../platform/shared/process.ts';
import { RUNTIME_DEPS_PREBOUND_BINDING_FILE } from '../../platform/shared/runtime-dependency-spec.ts';
import type { SemanticMutationVerificationExecutionRefV2 } from '../../platform/shared/semantic-mutation-types.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  createWorkspaceWriteCommitFence,
  isCanonicalWorkspaceWriteCommitFence,
  WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
  type WorkspaceWriteLeaseToken
} from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function stagingWorkspaceRoot(root: string, transactionId = 'a'.repeat(64)): string {
  return path.join(
    root,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    transactionId,
    'workspace'
  );
}

function workspaceWriteLeaseToken(): WorkspaceWriteLeaseToken {
  return Object.freeze({
    formatVersion: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
    workspaceIdentityDigest: 'sha256:workspace',
    leaseDirectoryIdentityDigest: 'sha256:lease-directory',
    hostname: 'semantic-mutation-test-host',
    pid: 1234,
    processNonce: 'semantic-mutation-test-process',
    leaseId: 'semantic-mutation-test-lease'
  });
}

function legacyWindowsAppContainerExecutionError(
  phase: string,
  nativeCode?: number,
  hostToolFailure?: object,
  preparationSubstage?: string,
  nativeHelperObservation?: object
): Error {
  return Object.assign(new Error('Legacy Windows AppContainer execution failure'), {
    name: 'WindowsAppContainerExecutionError',
    phase,
    nativeCode,
    hostToolFailure,
    preparationSubstage,
    nativeHelperObservation
  });
}

const BUNDLED_EJS_RELOCATION_GUARD = [
  'if (typeof exports_utils != "undefined") {',
  '  module_utils.exports = utils;',
  '}'
].join('\n');
const BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD =
  'if(typeof exports_utils<"u")module_utils.exports=utils;';

function relocationAssignment(
  directory: string,
  file = path.join(directory, 'typescript.js'),
  format: 'readable' | 'conservative-minified' = 'readable'
): string {
  return format === 'readable'
    ? `var __dirname = ${JSON.stringify(directory)}, __filename = ${JSON.stringify(file)};`
    : `var __dirname=${JSON.stringify(directory)},__filename=${JSON.stringify(file)};`;
}

function relocationBundle(
  assignments: readonly string[],
  guards: readonly string[] = [BUNDLED_EJS_RELOCATION_GUARD]
): Uint8Array {
  return new TextEncoder().encode([...guards, ...assignments].join('\n'));
}

test('isolated runner relocation rejects missing Bun EJS compatibility guard', () => {
  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(new Uint8Array()))
    .toThrow('Semantic Mutation isolated runner bundle has an invalid EJS ESM compatibility guard');
});

test('isolated runner bundle has one host-process Bun build and no helper process', async () => {
  const source = await readFile(path.join(
    compilerRoot,
    'platform',
    'compiler',
    'verify',
    'run-semantic-mutation-isolated-child.ts'
  ), 'utf8');
  const start = source.indexOf('async function buildIsolatedRunnerBundle(');
  const end = source.indexOf('\nfunction createProcessLocalRunnerBundleLoader(', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  const runtimeVersionGuard = body.indexOf(
    "if (Bun.version !== CANONICAL_BUN_RUNTIME_VERSION)"
  );
  const rootCapture = body.indexOf('captureIsolatedRuntimeBuildNodeModulesProof');
  const runnerBuild = body.indexOf('() => Bun.build({');
  expect(body).not.toContain('prepareWindowsAppContainerNativeHelperBundle');
  expect(body).not.toContain("process.platform === 'win32'");
  expect(body).not.toContain('runObservedCommand');
  expect(body.match(/Bun\.build\(\{/gu)).toHaveLength(1);
  expect(runtimeVersionGuard).toBeGreaterThanOrEqual(0);
  expect(rootCapture).toBeGreaterThan(runtimeVersionGuard);
  expect(runnerBuild).toBeGreaterThan(rootCapture);
});

test('runtime capability and child options reject accessor authority without evaluating getters', async () => {
  let probeGetterReads = 0;
  const probeOptions = Object.defineProperty({}, 'runtimeInputSources', {
    enumerable: true,
    get() {
      probeGetterReads += 1;
      return undefined;
    }
  });
  expect(await probeSemanticMutationIsolatedRuntimeCapability(
    String.raw`C:\accessor-probe-must-not-run`,
    probeOptions
  )).toEqual({ status: 'unavailable' });
  expect(probeGetterReads).toBe(0);

  let supervisorGetterReads = 0;
  const childOptions = Object.defineProperty({
    commitFence: async () => undefined,
    runtimeCapabilityForTest: Object.freeze({}),
    workspaceRoot: String.raw`C:\accessor-child-must-not-run`,
    workspaceWriteLease: workspaceWriteLeaseToken()
  }, 'supervisor', {
    enumerable: true,
    get() {
      supervisorGetterReads += 1;
      return undefined;
    }
  });
  await expect(runSemanticMutationIsolatedVerificationChild(
    String.raw`C:\accessor-child-must-not-run`,
    childOptions as never
  )).rejects.toThrow('Semantic Mutation isolated verification is unavailable');
  expect(supervisorGetterReads).toBe(0);
});

test('workspace write commit-fence production identity is module-owned and token-bound', async () => {
  await withTempWorkspace(async (root) => {
    await initWorkspace(root, { reset: true });
    const lease = await acquireWorkspaceWriteLease(root);
    try {
      const canonicalFence = createWorkspaceWriteCommitFence(root, lease.token);
      expect(isCanonicalWorkspaceWriteCommitFence(canonicalFence, root, lease.token)).toBe(true);
      expect(isCanonicalWorkspaceWriteCommitFence(
        async () => assertWorkspaceWriteLease(root, lease.token),
        root,
        lease.token
      )).toBe(false);
      expect(isCanonicalWorkspaceWriteCommitFence(
        canonicalFence,
        root,
        structuredClone(lease.token)
      )).toBe(false);
      await canonicalFence();
    } finally {
      await lease.release();
    }
  }, 'engineering-compiler-sm3-canonical-commit-fence-');
});

test('runner build maps invocation, result, output count, and output read to finite outcomes', async () => {
  const readableOutput = Object.freeze({
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new ArrayBuffer(1);
    }
  });
  const raw = String.raw`Z:\must-not-survive\runner-build`;
  const cases = [
    {
      substage: 'runner-build-invocation',
      build: async () => { throw new Error(raw); }
    },
    {
      substage: 'runner-build-unsuccessful',
      build: async () => ({ success: false, outputs: [], logs: raw })
    },
    {
      substage: 'runner-build-output-count',
      build: async () => ({ success: true, outputs: [] })
    },
    {
      substage: 'runner-build-output-count',
      build: async () => ({ success: true, outputs: [readableOutput, readableOutput] })
    },
    {
      substage: 'runner-build-output-read',
      build: async () => ({
        success: true,
        outputs: [{ async arrayBuffer(): Promise<ArrayBuffer> { throw new Error(raw); } }]
      })
    }
  ] as const;

  for (const fixture of cases) {
    const result = await classifySemanticMutationIsolatedRunnerBuildForTests(fixture.build);
    expect(result).toEqual({
      status: 'unavailable',
      diagnostic: {
        stage: 'runtime-capability',
        runtimeCapability: { substage: fixture.substage }
      }
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'unavailable') throw new Error('runner build fixture unexpectedly passed');
    expect(Object.isFrozen(result.diagnostic)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(raw);
  }

  expect(await classifySemanticMutationIsolatedRunnerBuildForTests(async () => ({
    success: true,
    outputs: [readableOutput]
  }))).toEqual({ status: 'available' });
});

function observedDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function observedRunnerBuildOutcome(
  stdoutBytes: Uint8Array,
  overrides: Partial<ObservedCommandOutcome> = {}
): ObservedCommandOutcome {
  const empty = new Uint8Array();
  return {
    status: 'exited',
    started: true,
    exitCode: 0,
    signal: null,
    durationMs: 1,
    stdout: {
      bytes: stdoutBytes.byteLength,
      digest: observedDigest(stdoutBytes),
      observerTruncated: false
    },
    stderr: { bytes: 0, digest: observedDigest(empty), observerTruncated: false },
    termination: {
      requested: false,
      gracefulAttempted: false,
      forcedAttempted: false,
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    },
    ...overrides
  };
}

function observedRunnerBuildExecutor(
  stdoutBytes: Uint8Array,
  overrides: Partial<ObservedCommandOutcome> = {}
): (
  command: string,
  args: readonly string[],
  options: ObservedCommandOptions
) => Promise<ObservedCommandOutcome> {
  return async (_command, _args, options) => {
    if (stdoutBytes.byteLength > 0) {
      options.onChunk?.('stdout', stdoutBytes.byteLength);
      options.onOutput?.('stdout', stdoutBytes);
    }
    return observedRunnerBuildOutcome(stdoutBytes, overrides);
  };
}

test('runtime capability diagnostic enum rejects forged detail without retaining raw fields', () => {
  for (const substage of [
    'runner-build-root-proof',
    'runner-build-invocation',
    'runner-build-unsuccessful',
    'runner-build-output-count',
    'runner-build-output-read',
    'runner-relocation',
    'capability-issue',
    'unknown'
  ] as const) {
    const projected = projectSemanticMutationIsolatedRuntimeCapabilitySubstageForTests(substage);
    expect(projected).toEqual({
      stage: 'runtime-capability',
      runtimeCapability: { substage }
    });
    expect(Object.isFrozen(projected)).toBe(true);
    if (projected.stage === 'runtime-capability') {
      expect(Object.isFrozen(projected.runtimeCapability)).toBe(true);
    }
  }

  const forged = projectSemanticMutationIsolatedRuntimeCapabilitySubstageForTests({
    substage: 'runner-relocation',
    message: 'Z:\\must-not-survive',
    stdout: 'secret-output',
    stack: 'secret-stack'
  });
  expect(forged).toEqual({
    stage: 'runtime-capability',
    runtimeCapability: { substage: 'unknown' }
  });
  expect(JSON.stringify(forged)).not.toMatch(/Z:|secret|message|stdout|stack/u);
});

test('isolated runner relocation accepts exact logical and proven physical build roots', () => {
  const logicalRoot = path.join(compilerRoot, 'node_modules');
  const physicalRoot = path.join(path.resolve('relocation-physical-host'), 'node_modules');
  const commonDirectory = path.join(logicalRoot, '@ts-morph', 'common', 'dist');
  const typescriptDirectory = path.join(physicalRoot, 'typescript', 'lib');
  const relocated = new TextDecoder().decode(relocateSemanticMutationIsolatedRunnerBundleForTests(
    relocationBundle([
      relocationAssignment(commonDirectory),
      relocationAssignment(typescriptDirectory)
    ]),
    physicalRoot
  ));

  expect(relocated).toContain('../../node_modules/@ts-morph/common/dist');
  expect(relocated).toContain('../../node_modules/typescript/lib');
  expect(relocated).not.toContain(logicalRoot);
  expect(relocated).not.toContain(physicalRoot);
});

test('isolated runner relocation accepts the fixed conservative-minified bundle form', () => {
  const logicalRoot = path.join(compilerRoot, 'node_modules');
  const physicalRoot = path.join(path.resolve('relocation-minified-host'), 'node_modules');
  const commonDirectory = path.join(logicalRoot, '@ts-morph', 'common', 'dist');
  const typescriptDirectory = path.join(physicalRoot, 'typescript', 'lib');
  const relocated = new TextDecoder().decode(relocateSemanticMutationIsolatedRunnerBundleForTests(
    relocationBundle([
      relocationAssignment(commonDirectory, undefined, 'conservative-minified'),
      relocationAssignment(typescriptDirectory, undefined, 'conservative-minified')
    ], [BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD]),
    physicalRoot
  ));

  expect(relocated).toContain('../../node_modules/@ts-morph/common/dist');
  expect(relocated).toContain('../../node_modules/typescript/lib');
  expect(relocated).not.toContain(BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD);
  expect(relocated).not.toContain(logicalRoot);
  expect(relocated).not.toContain(physicalRoot);
});

test('isolated runner relocation rejects multiple and ambiguous EJS compatibility guards', () => {
  const physicalRoot = path.join(path.resolve('relocation-guard-host'), 'node_modules');
  const assignments = [
    relocationAssignment(
      path.join(physicalRoot, '@ts-morph', 'common', 'dist'),
      undefined,
      'conservative-minified'
    ),
    relocationAssignment(
      path.join(physicalRoot, 'typescript', 'lib'),
      undefined,
      'conservative-minified'
    )
  ];

  for (const guards of [
    [
      BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD,
      BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD
    ],
    [BUNDLED_EJS_RELOCATION_GUARD, BUNDLED_EJS_CONSERVATIVE_MINIFIED_RELOCATION_GUARD],
    ['module_utils.exports=utils;']
  ]) {
    expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(
      relocationBundle(assignments, guards),
      physicalRoot
    )).toThrow('invalid EJS ESM compatibility guard');
  }
});

test('isolated runner relocation uses Windows-native case, separator, and trailing-directory equality', () => {
  if (process.platform !== 'win32') return;
  const physicalRoot = path.join(path.resolve('relocation-native-host'), 'node_modules');
  const commonDirectory = `${path.join(physicalRoot, '@ts-morph', 'common', 'dist')}${path.sep}`
    .toUpperCase()
    .replaceAll('\\', '/');
  const typescriptDirectory = `${path.join(physicalRoot, 'typescript', 'lib')}${path.sep}`
    .toUpperCase()
    .replaceAll('\\', '/');

  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(relocationBundle([
    relocationAssignment(commonDirectory),
    relocationAssignment(typescriptDirectory)
  ]), physicalRoot)).not.toThrow();
});

test('isolated runner relocation rejects unproven, prefix-collision, and nested build roots', () => {
  const physicalRoot = path.join(path.resolve('relocation-trusted-host'), 'node_modules');
  const rejectedRoots = [
    path.join(path.resolve('relocation-unproven-host'), 'node_modules'),
    `${physicalRoot}-prefix-collision`,
    path.join(physicalRoot, '.cache', 'typescript-version', 'node_modules')
  ];

  for (const rejectedRoot of rejectedRoots) {
    expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(relocationBundle([
      relocationAssignment(path.join(rejectedRoot, '@ts-morph', 'common', 'dist')),
      relocationAssignment(path.join(rejectedRoot, 'typescript', 'lib'))
    ]), physicalRoot)).toThrow('unexpected relocation source');
  }
});

test('isolated runner relocation rejects directory-file mismatch', () => {
  const physicalRoot = path.join(path.resolve('relocation-mismatch-host'), 'node_modules');
  const commonDirectory = path.join(physicalRoot, '@ts-morph', 'common', 'dist');
  const typescriptDirectory = path.join(physicalRoot, 'typescript', 'lib');

  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(relocationBundle([
    relocationAssignment(commonDirectory, path.join(typescriptDirectory, 'typescript.js')),
    relocationAssignment(typescriptDirectory)
  ]), physicalRoot)).toThrow('invalid relocation source');
});

test('isolated runner relocation rejects duplicate and missing two-of-two coverage', () => {
  const physicalRoot = path.join(path.resolve('relocation-coverage-host'), 'node_modules');
  const commonAssignment = relocationAssignment(
    path.join(physicalRoot, '@ts-morph', 'common', 'dist')
  );

  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(relocationBundle([
    commonAssignment,
    commonAssignment
  ]), physicalRoot)).toThrow('unexpected relocation source');
  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(relocationBundle([
    commonAssignment
  ]), physicalRoot)).toThrow('relocation coverage is incomplete');
});

test('isolated verification failure projection allowlists typed fields at runtime', () => {
  const secret = String.raw`C:\secret\workspace\raw-output`;
  const hostToolFailure = {
    stage: 'profile-query',
    reason: 'nonzero-exit',
    termination: 'not-requested',
    path: secret,
    message: secret,
    stdout: secret,
    stderr: secret,
    rawOutput: secret
  } as const;
  const source = legacyWindowsAppContainerExecutionError(
    'cleanup',
    -2_147_023_728,
    hostToolFailure
  );
  source.message = secret;
  Object.assign(source, { path: secret, stdout: secret, stderr: secret, rawOutput: secret });

  const projected = projectSemanticMutationIsolatedVerificationFailureForTests(
    'artifact-read',
    source
  );
  expect(projected).toEqual({
    stage: 'appcontainer-execution',
    appContainer: {
      phase: 'cleanup',
      nativeCode: -2_147_023_728,
      hostToolFailure: {
        stage: 'profile-query',
        reason: 'nonzero-exit',
        termination: 'not-requested'
      }
    }
  });
  expect(JSON.stringify(projected)).not.toContain(secret);

  const preparationSource = legacyWindowsAppContainerExecutionError(
    'preparation',
    undefined,
    undefined,
    'native-helper-protocol',
    {
      mode: 'execute',
      exitClass: 'nonzero',
      diagnosticStream: 'present',
      protocol: 'invalid',
      nativeReceipt: 'invalid',
      stdout: secret,
      stderr: secret,
      rawOutput: secret
    } as never
  );
  const preparationProjected = projectSemanticMutationIsolatedVerificationFailureForTests(
    'artifact-read',
    preparationSource
  );
  expect(preparationProjected).toEqual({
    stage: 'appcontainer-execution',
    appContainer: {
      phase: 'preparation',
      preparationSubstage: 'native-helper-protocol',
      nativeHelperObservation: {
        mode: 'execute',
        exitClass: 'nonzero',
        diagnosticStream: 'present',
        protocol: 'invalid',
        nativeReceipt: 'invalid'
      }
    }
  });
  expect(Object.isFrozen(preparationProjected)).toBe(true);
  expect(Object.isFrozen(preparationProjected.appContainer)).toBe(true);
  expect(Object.isFrozen(preparationProjected.appContainer?.nativeHelperObservation)).toBe(true);
  expect(JSON.stringify(preparationProjected)).not.toContain(secret);

  for (const preparationSubstage of [
    'native-helper-entry',
    'native-helper-build',
    'native-helper-bundle-contract'
  ] as const) {
    const typedProjection = projectSemanticMutationIsolatedVerificationFailureForTests(
      'artifact-read',
      legacyWindowsAppContainerExecutionError(
        'preparation',
        undefined,
        undefined,
        preparationSubstage
      )
    );
    expect(typedProjection).toEqual({
      stage: 'appcontainer-execution',
      appContainer: { phase: 'preparation', preparationSubstage }
    });
  }

  const forgedWrapped = Object.assign(
    Object.create(SemanticMutationIsolatedVerificationUnavailableError.prototype) as object,
    {
      message: secret,
      path: secret,
      failure: {
        stage: 'artifact-protocol',
        path: secret,
        appContainer: {
          phase: 'cleanup',
          nativeCode: 24,
          stderr: secret,
          hostToolFailure: { ...hostToolFailure }
        }
      }
    }
  );
  const reprojected = projectSemanticMutationIsolatedVerificationFailureForTests(
    'runtime-materialization',
    forgedWrapped
  );
  expect(reprojected).toEqual({
    stage: 'artifact-protocol',
    appContainer: {
      phase: 'cleanup',
      nativeCode: 24,
      hostToolFailure: {
        stage: 'profile-query',
        reason: 'nonzero-exit',
        termination: 'not-requested'
      }
    }
  });
  expect(JSON.stringify(reprojected)).not.toContain(secret);

  const forgedPreparation = Object.assign(
    Object.create(SemanticMutationIsolatedVerificationUnavailableError.prototype) as object,
    {
      failure: {
        stage: 'appcontainer-execution',
        appContainer: {
          phase: 'preparation',
          preparationSubstage: 'forged-substage',
          nativeHelperObservation: {
            mode: 'execute',
            exitClass: 'raw-exit',
            diagnosticStream: 'present',
            protocol: 'invalid',
            nativeReceipt: 'invalid',
            stdout: secret
          },
          stdout: secret,
          path: secret
        }
      }
    }
  );
  expect(projectSemanticMutationIsolatedVerificationFailureForTests(
    'runtime-materialization',
    forgedPreparation
  )).toEqual({
    stage: 'appcontainer-execution',
    appContainer: {
      phase: 'preparation',
      preparationSubstage: 'unknown'
    }
  });

  const childProjected = projectSemanticMutationIsolatedVerificationFailureForTests(
    'runtime-materialization',
    Object.assign(new Error(secret), {
      failure: {
        stage: 'child-failed-before-artifacts',
        child: { stage: 'verify-all', boundary: 'verify-runtime', message: secret, path: secret },
        artifact: 'verification-report',
        stdout: secret,
        stderr: secret,
        rawOutput: secret
      }
    })
  );
  expect(childProjected).toEqual({ stage: 'runtime-materialization' });

  const childWrapped = Object.assign(
    Object.create(SemanticMutationIsolatedVerificationUnavailableError.prototype) as object,
    {
      message: secret,
      failure: {
        stage: 'child-failed-before-artifacts',
        child: { stage: 'verify-all', boundary: 'verify-runtime', message: secret, path: secret },
        artifact: 'verification-report',
        stdout: secret,
        stderr: secret,
        rawOutput: secret
      }
    }
  );
  const reprojectedChild = projectSemanticMutationIsolatedVerificationFailureForTests(
    'runtime-materialization',
    childWrapped
  );
  expect(reprojectedChild).toEqual({
    stage: 'child-failed-before-artifacts',
    child: { stage: 'verify-all', boundary: 'verify-runtime' },
    artifact: 'verification-report'
  });
  expect(JSON.stringify(reprojectedChild)).not.toContain(secret);

  const lifecycle = observedRunnerBuildOutcome(new Uint8Array(), {
    status: 'timed-out',
    trigger: 'timed-out'
  });
  const forgedLifecycle = Object.assign(
    Object.create(SemanticMutationIsolatedVerificationUnavailableError.prototype) as object,
    {
      message: secret,
      failure: {
        stage: 'isolated-child-execution',
        lifecycle: {
          ...lifecycle,
          path: secret,
          rawOutput: secret,
          stdout: { ...lifecycle.stdout, path: secret, rawOutput: secret },
          stderr: { ...lifecycle.stderr, path: secret, rawOutput: secret },
          termination: { ...lifecycle.termination, path: secret, secret }
        }
      }
    }
  );
  const reprojectedLifecycle = projectSemanticMutationIsolatedVerificationFailureForTests(
    'runtime-materialization',
    forgedLifecycle
  );
  expect(reprojectedLifecycle).toEqual({
    stage: 'isolated-child-execution',
    lifecycle: {
      status: lifecycle.status,
      trigger: lifecycle.trigger,
      started: lifecycle.started,
      exitCode: lifecycle.exitCode,
      durationMs: lifecycle.durationMs,
      stdout: lifecycle.stdout,
      stderr: lifecycle.stderr,
      termination: lifecycle.termination
    }
  });
  expect(Object.isFrozen(reprojectedLifecycle)).toBe(true);
  expect(Object.isFrozen(reprojectedLifecycle.lifecycle)).toBe(true);
  expect(Object.isFrozen(reprojectedLifecycle.lifecycle?.stdout)).toBe(true);
  expect(Object.isFrozen(reprojectedLifecycle.lifecycle?.stderr)).toBe(true);
  expect(Object.isFrozen(reprojectedLifecycle.lifecycle?.termination)).toBe(true);
  expect(JSON.stringify(reprojectedLifecycle)).not.toContain(secret);
});

test('isolated child failure outcome is canonical, bounded, failure-only, and atomically published', async () => {
  await withTempWorkspace(async (root) => {
    const outcome = buildSemanticMutationIsolatedChildOutcome('verify-all');
    expect(outcome).toEqual({
      formatVersion: 'semantic-mutation-isolated-child-outcome-v1',
      status: 'failed',
      stage: 'verify-all'
    });
    expect(Object.isFrozen(outcome)).toBe(true);

    const bytes = semanticMutationIsolatedChildOutcomeBytes(outcome);
    expect(new TextDecoder().decode(bytes)).toBe(
      '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all"}\n'
    );
    expect(parseSemanticMutationIsolatedChildOutcomeBytes(bytes)).toEqual(outcome);

    const boundedOutcome = buildSemanticMutationIsolatedChildOutcome('verify-all', 'verify-runtime');
    const boundedBytes = semanticMutationIsolatedChildOutcomeBytes(boundedOutcome);
    expect(new TextDecoder().decode(boundedBytes)).toBe(
      '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all","boundary":"verify-runtime"}\n'
    );
    expect(parseSemanticMutationIsolatedChildOutcomeBytes(boundedBytes)).toEqual(boundedOutcome);
    expect(() => buildSemanticMutationIsolatedChildOutcome('preflight', 'verify-fast')).toThrow();

    for (const invalid of [
      new TextEncoder().encode(` ${new TextDecoder().decode(bytes)}`),
      new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]),
      new TextEncoder().encode('{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"passed","stage":"verify-all"}\n'),
      new TextEncoder().encode('{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all","path":"C:/secret"}\n'),
      new TextEncoder().encode('{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all","boundary":"C:/secret"}\n'),
      new TextEncoder().encode('{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"preflight","stage":"verify-all"}\n'),
      new Uint8Array([0xff]),
      new Uint8Array(513)
    ]) {
      expect(() => parseSemanticMutationIsolatedChildOutcomeBytes(invalid)).toThrow();
    }

    const finalPath = semanticMutationIsolatedChildOutcomePath(root);
    const pendingPath = semanticMutationIsolatedChildOutcomePendingPath(root);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await publishSemanticMutationIsolatedChildOutcome(root, outcome);
    expect([...await readFile(finalPath)]).toEqual([...bytes]);
    await expect(stat(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(finalPath, { force: true });
    await writeFile(pendingPath, 'foreign-pending', 'utf8');
    await expect(publishSemanticMutationIsolatedChildOutcome(root, outcome))
      .rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(pendingPath, 'utf8')).toBe('foreign-pending');

    await rm(pendingPath, { force: true });
    await mkdir(finalPath);
    await expect(publishSemanticMutationIsolatedChildOutcome(root, outcome)).rejects.toThrow();
    await expect(stat(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-sm3-child-outcome-');
});

function directRuntimeModuleFixture(relativePath: string): string {
  return `export const directRuntimeModule = ${JSON.stringify(relativePath)};\n`;
}

async function createRuntimeInputSources(
  root: string,
  browserCache: string
): Promise<SemanticMutationIsolatedRuntimeInputSources> {
  const inputRoot = path.join(root, 'runtime-inputs');
  const compilerModulesRoot = path.join(inputRoot, 'node_modules');
  const sources = {
    browserCache,
    compilerModulesRoot,
    compilerPackage: path.join(inputRoot, 'package.json'),
    composeTemplates: path.join(inputRoot, 'compose-templates'),
    dependencyModules: path.join(inputRoot, 'dependency-modules'),
    officialPolicies: path.join(inputRoot, 'official-policies'),
    officialRegistry: path.join(inputRoot, 'official-registry')
  } satisfies SemanticMutationIsolatedRuntimeInputSources;
  await Promise.all([
    mkdir(sources.composeTemplates, { recursive: true }),
    mkdir(sources.dependencyModules, { recursive: true }),
    ...Object.values(RUNTIME_VERIFICATION_INVOCATION_CONTRACT).flatMap(({ moduleRelativePath }) =>
      moduleRelativePath === null ? [] : [moduleRelativePath]).map((relativePath) =>
      mkdir(path.dirname(path.join(sources.dependencyModules, ...relativePath.split('/'))), {
        recursive: true
      })),
    mkdir(sources.officialPolicies, { recursive: true }),
    mkdir(sources.officialRegistry, { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'ts-morph'), { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'typescript'), { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'playwright-core'), { recursive: true }),
    mkdir(path.join(
      browserCache,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64'
    ), { recursive: true })
  ]);
  await Promise.all([
    writeFile(sources.compilerPackage, JSON.stringify({
      dependencies: {
        next: '1', react: '1', 'react-dom': '1', yaml: '1'
      },
      devDependencies: {
        '@playwright/test': '1', '@types/bun': '1', '@types/node': '1',
        '@types/react': '1', '@types/react-dom': '1', 'ts-morph': '1', typescript: '1'
      }
    }), 'utf8'),
    writeFile(path.join(sources.composeTemplates, 'template.txt'), 'template', 'utf8'),
    writeFile(path.join(sources.dependencyModules, 'cache.bin'), 'cache', 'utf8'),
    ...Object.values(RUNTIME_VERIFICATION_INVOCATION_CONTRACT).flatMap(({ moduleRelativePath }) =>
      moduleRelativePath === null ? [] : [moduleRelativePath]).map((relativePath) =>
      writeFile(
        path.join(sources.dependencyModules, ...relativePath.split('/')),
        directRuntimeModuleFixture(relativePath),
        'utf8'
      )),
    writeFile(path.join(sources.officialPolicies, 'policy.yaml'), 'policies: []', 'utf8'),
    writeFile(path.join(sources.officialRegistry, 'registry.yaml'), 'blocks: []', 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'ts-morph', 'package.json'), JSON.stringify({
      name: 'ts-morph', main: 'index.js', dependencies: {}
    }), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'ts-morph', 'index.js'), [
      "const typescript = require('typescript');",
      "const cacheIdentityKey = Symbol.for('sec.test.semantic-mutation.typescript-cache-identity');",
      "const observedKey = Symbol.for('sec.test.semantic-mutation.ts-morph-cache-observed');",
      'if (!Object.is(globalThis[cacheIdentityKey], typescript)) {',
      "  throw new Error('fixture TypeScript cache identity mismatch in ts-morph');",
      '}',
      "if (globalThis[observedKey] !== undefined) throw new Error('fixture ts-morph loaded twice');",
      'globalThis[observedKey] = typescript;',
      'module.exports = { typescript };',
      ''
    ].join('\n'), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'typescript', 'package.json'), JSON.stringify({
      name: 'typescript', main: './index.js', dependencies: {}
    }), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'typescript', 'index.js'), [
      'const SyntaxKind = { VariableStatement: 244 };',
      "const cacheIdentityKey = Symbol.for('sec.test.semantic-mutation.typescript-cache-identity');",
      "if (globalThis[cacheIdentityKey] !== undefined) throw new Error('fixture TypeScript loaded twice');",
      'const typescript = {',
      '  ScriptTarget: { Latest: 99 },',
      '  SyntaxKind,',
      '  createSourceFile() {',
      '    if (!Object.is(this, globalThis[cacheIdentityKey])) {',
      "      throw new Error('fixture TypeScript loader identity mismatch');",
      '    }',
      '    return { statements: [{ kind: SyntaxKind.VariableStatement }] };',
      '  }',
      '};',
      'globalThis[cacheIdentityKey] = typescript;',
      'module.exports = typescript;',
      ''
    ].join('\n'), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'playwright-core', 'browsers.json'), JSON.stringify({
      browsers: [{ name: 'chromium-headless-shell', revision: '1217' }]
    }), 'utf8'),
    writeFile(path.join(
      browserCache,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ), 'playwright-executable', 'utf8')
  ]);
  return sources;
}

async function writeProjectBaseline(stagingRoot: string): Promise<void> {
  await Promise.all([
    mkdir(path.join(stagingRoot, '.sec', 'cache'), { recursive: true }),
    mkdir(path.join(stagingRoot, 'project'), { recursive: true })
  ]);
  await writeFile(path.join(stagingRoot, '.sec', 'cache', 'project-baseline.json'), JSON.stringify({
    formatVersion: '1', artifacts: []
  }), 'utf8');
}

async function createProductionRuntimeCapabilityContext(root: string): Promise<Readonly<{
  readonly runtimeInputSources: SemanticMutationIsolatedRuntimeInputSources;
  readonly stagingRoot: string;
}>> {
  const stagingRoot = stagingWorkspaceRoot(root);
  const browserSource = path.join(root, 'browser-source');
  await writeProjectBaseline(stagingRoot);
  await mkdir(browserSource, { recursive: true });
  const fixtureRuntimeInputSources = await createRuntimeInputSources(root, browserSource);
  const productionCompilerModulesRoot = path.join(
    process.cwd(),
    '.shared-deps',
    'node_modules'
  );
  const playwrightDescriptor = JSON.parse(await readFile(path.join(
    productionCompilerModulesRoot,
    'playwright-core',
    'browsers.json'
  ), 'utf8')) as { readonly browsers: readonly { readonly name: string; readonly revision: string }[] };
  const chromiumHeadlessShell = playwrightDescriptor.browsers.find((browser) =>
    browser.name === 'chromium-headless-shell');
  if (!chromiumHeadlessShell) throw new Error('production Playwright descriptor is unavailable');
  const browserExecutable = path.join(
    browserSource,
    `chromium_headless_shell-${chromiumHeadlessShell.revision}`,
    'chrome-headless-shell-win64',
    'chrome-headless-shell.exe'
  );
  await mkdir(path.dirname(browserExecutable), { recursive: true });
  await writeFile(browserExecutable, 'production-bundle-browser-fixture', 'utf8');
  return Object.freeze({
    runtimeInputSources: {
      ...fixtureRuntimeInputSources,
      compilerModulesRoot: productionCompilerModulesRoot
    },
    stagingRoot
  });
}

function isolatedVerificationArtifacts(status: 'passed' | 'failed') {
  const policy = {
    status: 'skipped' as const,
    official: { policies: [], sources: [], violations: [] },
    project: { policies: [], sources: [], violations: [] },
    merged: { policies: [] },
    violations: []
  };
  const fastLogs = { stdout: 'fast-verification', stderr: '' };
  const runtimeLogs = status === 'passed'
    ? { stdout: 'runtime-verification', stderr: '' }
    : { stdout: '', stderr: 'runtime-verification-failed' };
  const fast = {
    status: 'passed' as const,
    build: { status: 'passed' as const },
    unit: { status: 'passed' as const, passed: [] },
    acceptance: { status: 'passed' as const, passed: [], failed: [] },
    policy: { status: 'skipped' as const, violations: [] },
    policyReport: policy,
    logs: fastLogs
  };
  const runtime = status === 'passed' ? {
    status: 'passed' as const,
    build: { status: 'passed' as const, passed: ['next build'], failed: [], command: 'bun run build' },
    unit: { status: 'passed' as const, passed: [], failed: [], command: 'bun run test:unit' },
    acceptance: { status: 'passed' as const, passed: [], failed: [], command: 'bun run test:acceptance' },
    logs: runtimeLogs
  } : {
    status: 'failed' as const,
    build: { status: 'failed' as const, passed: [], failed: ['next build'], command: 'bun run build' },
    unit: { status: 'skipped' as const, passed: [], failed: [], command: null },
    acceptance: { status: 'skipped' as const, passed: [], failed: [], command: null },
    logs: runtimeLogs
  };
  return {
    verificationReport: {
      build: fast.build,
      unit: fast.unit,
      acceptance: fast.acceptance,
      policy: fast.policy,
      fast,
      runtime,
      summary: {
        status,
        requestedLane: 'all' as const,
        failedLanes: status === 'passed' ? [] : ['runtime' as const]
      },
      logs: {
        stdout: [fastLogs.stdout, runtimeLogs.stdout].filter(Boolean).join('\n'),
        stderr: [fastLogs.stderr, runtimeLogs.stderr].filter(Boolean).join('\n')
      }
    },
    runtimeReport: runtime,
    policyReport: policy,
    acceptanceCoverage: {
      formatVersion: '1',
      status: runtime.status,
      acceptancePassed: [],
      blocks: [],
      slots: [],
      uncoveredBlocks: [],
      uncoveredSlots: []
    }
  };
}

function verificationExecutionForProof(
  artifacts: Awaited<ReturnType<typeof runSemanticMutationIsolatedVerificationChild>>
): SemanticMutationVerificationExecutionRefV2 & { readonly status: 'passed' } {
  const snapshot = artifacts.semanticBundle.snapshot.ir;
  const digest = (label: string): string => observedDigest(new TextEncoder().encode(label));
  return Object.freeze({
    adapterId: 'semantic-mutation-local-verification',
    adapterRevision: 'semantic-mutation-local-verification-v2',
    reportRevision: digest('proof-report'),
    planRevision: digest('proof-plan'),
    attempted: {
      transactionId: 'tx:semantic-mutation-stage:proof',
      inputRevision: snapshot.inputRevision,
      semanticRevision: snapshot.semanticRevision
    },
    stagedSourceDigest: digest('proof-source'),
    requiredVerificationDigest: digest('proof-requirements'),
    status: 'passed',
    verificationExecutionRevision: digest('proof-execution')
  });
}

test('staged full Verification proof is one-shot and binds exact live inputs and revisions', async () => {
  await withTempWorkspace(async (root) => {
    const fixture = await createResolvedIsolatedHostFixture(root, 'proof-authority', 'b');
    const stagingProjectRoot = getWorkspacePaths(fixture.stagingRoot).projectRoot;
    const liveProjectRoot = path.join(root, 'live-project');
    const writeProject = async (projectRoot: string, runtimeResidue: string): Promise<void> => {
      await mkdir(path.join(projectRoot, 'src'), { recursive: true });
      await mkdir(path.join(projectRoot, '.next'), { recursive: true });
      await writeFile(path.join(projectRoot, 'package.json'), '{"name":"proof-fixture"}\n', 'utf8');
      await writeFile(path.join(projectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');
      await writeFile(path.join(projectRoot, '.next', 'trace-build'), runtimeResidue, 'utf8');
    };
    await writeProject(stagingProjectRoot, 'staging-runtime-output');
    const isolatedArtifacts = await runPassedIsolatedArtifactsForProof(fixture);
    expect(Object.isFrozen(isolatedArtifacts)).toBe(true);
    expect(Object.isFrozen(isolatedArtifacts.verificationReport.summary)).toBe(true);
    const excludedInputs = new Set([
      '.next', 'coverage', 'node_modules', 'playwright-report', 'test-results'
    ]);
    await cp(stagingProjectRoot, liveProjectRoot, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(stagingProjectRoot, source);
        return !relative || !excludedInputs.has(relative.split(path.sep)[0] ?? '');
      }
    });
    await mkdir(path.join(liveProjectRoot, '.next'), { recursive: true });
    await writeFile(
      path.join(liveProjectRoot, '.next', 'trace-build'),
      'different-live-runtime-output',
      'utf8'
    );
    const verification = verificationExecutionForProof(isolatedArtifacts);
    const { inputRevision, semanticRevision } = isolatedArtifacts.semanticBundle.snapshot.ir;
    const artifacts = {
      verificationReport: isolatedArtifacts.verificationReport,
      runtimeReport: isolatedArtifacts.runtimeReport,
      policyReport: isolatedArtifacts.policyReport,
      acceptanceCoverage: isolatedArtifacts.acceptanceCoverage
    };

    const lock = {
      formatVersion: '1',
      app: { id: 'proof', name: 'proof', stack: 'next', mode: 'private' },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [],
      semanticViews: {
        formatVersion: '1',
        inputRevision,
        semanticRevision,
        views: []
      },
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'pending',
        repair: 'pending',
        lock: 'pending',
        emit: 'pending'
      }
    } satisfies LockFile;

    const binding: StagedVerificationProofBinding = {
      inputRevision,
      semanticRevision,
      planRevision: verification.planRevision,
      stagedSourceDigest: verification.stagedSourceDigest,
      requiredVerificationDigest: verification.requiredVerificationDigest,
      verificationExecutionRevision: verification.verificationExecutionRevision,
      verificationReportDigest: observedDigest(new TextEncoder().encode('proof-report'))
    };
    const evidenceDigest = semanticMutationIsolatedVerificationEvidenceDigest({
      status: 'passed',
      artifacts: isolatedArtifacts
    });
    const source = await issueStagedVerificationProofSource({
      stagingProjectRoot,
      inputRevision,
      semanticRevision,
      evidenceDigest,
      rawArtifactDigests: isolatedArtifacts.rawDigests,
      artifacts
    });
    const proof = await issueStagedVerificationProof({ source, evidenceDigest, binding });
    expect(() => assertStagedVerificationProofBinding(proof, binding)).not.toThrow();
    expect(() => assertStagedVerificationProofBinding(proof, {
      ...binding,
      planRevision: observedDigest(new TextEncoder().encode('forged-plan'))
    })).toThrow('does not match the committed execution');
    expect(() => assertStagedVerificationProofBinding(proof, {
      ...binding,
      unexpected: 'field'
    } as StagedVerificationProofBinding)).toThrow('does not match the committed execution');
    await expect(issueStagedVerificationProof({ source, evidenceDigest, binding }))
      .rejects.toThrow('source is unavailable');

    await expect(consumeStagedVerificationProof(
      liveProjectRoot,
      {
        ...lock,
        semanticViews: { ...lock.semanticViews, semanticRevision: observedDigest(new Uint8Array([9])) }
      },
      proof
    )).rejects.toThrow('revisions do not match');

    await writeFile(path.join(liveProjectRoot, 'src', 'index.ts'), 'export const value = 2;\n', 'utf8');
    await expect(consumeStagedVerificationProof(
      liveProjectRoot,
      lock,
      proof
    )).rejects.toThrow('inputs do not match');
    await writeFile(path.join(liveProjectRoot, 'src', 'index.ts'), 'export const value = 1;\n', 'utf8');

    const consumed = await consumeStagedVerificationProof(
      liveProjectRoot,
      lock,
      proof
    );
    expect(consumed).toEqual(artifacts);
    expect(Object.isFrozen(consumed)).toBe(true);
    await expect(revalidateStagedVerificationProof(
      liveProjectRoot,
      lock,
      proof
    )).resolves.toBeUndefined();
    await expect(consumeStagedVerificationProof(
      liveProjectRoot,
      lock,
      proof
    )).rejects.toThrow('unavailable or already consumed');
    await expect(consumeStagedVerificationProof(
      liveProjectRoot,
      lock,
      structuredClone(proof)
    )).rejects.toThrow('unavailable or already consumed');

    const concurrentSource = await issueStagedVerificationProofSource({
      stagingProjectRoot,
      inputRevision,
      semanticRevision,
      evidenceDigest,
      rawArtifactDigests: isolatedArtifacts.rawDigests,
      artifacts
    });
    const concurrentProof = await issueStagedVerificationProof({
      source: concurrentSource,
      evidenceDigest,
      binding
    });
    const concurrentConsumption = await Promise.allSettled([
      consumeStagedVerificationProof(liveProjectRoot, lock, concurrentProof),
      consumeStagedVerificationProof(liveProjectRoot, lock, concurrentProof)
    ]);
    expect(concurrentConsumption.map((result) => result.status).sort())
      .toEqual(['fulfilled', 'rejected']);
  }, 'sm3-staged-verification-proof-');
});

test('staged Verification proof rejects live policy input drift outside the project digest', async () => {
  await withTempWorkspace(async (root) => {
    const workspaceRoot = path.join(root, 'policy-context');
    await initWorkspace(workspaceRoot, { reset: true });
    await compileWorkspace(workspaceRoot, {
      source: 'api',
      from: 'resolve',
      through: 'adapt'
    });
    const paths = getWorkspacePaths(workspaceRoot);
    const lock = await readLockFile(workspaceRoot);
    const installTemplate = lock.installPlan[0];
    if (!installTemplate) throw new Error('Policy drift fixture is missing an install step');
    await mkdir(path.join(paths.projectRoot, 'src'), { recursive: true });
    await writeFile(
      path.join(paths.projectRoot, 'src', 'policy-drift.ts'),
      'export const query = () => [];\n',
      'utf8'
    );
    const baseArtifacts = isolatedVerificationArtifacts('passed');
    const artifacts = {
      runtimeReport: baseArtifacts.runtimeReport,
      policyReport: await runPolicyGate(workspaceRoot),
      acceptanceCoverage: await buildAcceptanceCoverage(
        workspaceRoot,
        lock,
        baseArtifacts.runtimeReport
      )
    };
    await expect(assertStagedVerificationLiveContext(
      workspaceRoot,
      lock,
      artifacts
    )).resolves.toBeUndefined();

    await writeFile(paths.lockPath, JSON.stringify({
      ...lock,
      installPlan: [{
        ...installTemplate,
        stepId: 'policy-drift',
        blockId: 'ticket/basic',
        action: 'copy',
        to: 'src/policy-drift.ts'
      }]
    }), 'utf8');
    await expect(assertStagedVerificationLiveContext(
      workspaceRoot,
      lock,
      artifacts
    )).rejects.toThrow('policy or acceptance context changed');
    expect((await runPolicyGate(workspaceRoot))).toMatchObject({
      status: 'failed',
      violations: [{ files: ['src/policy-drift.ts'] }]
    });
  }, 'sm3-live-verification-context-');
});

async function writeIsolatedVerificationArtifacts(
  stagingRoot: string,
  status: 'passed' | 'failed'
): Promise<ReturnType<typeof getWorkspacePaths>> {
  const paths = getWorkspacePaths(stagingRoot);
  const artifacts = isolatedVerificationArtifacts(status);
  await Promise.all([
    paths.verificationReportPath,
    paths.runtimeReportPath,
    paths.policyReportPath,
    paths.acceptanceCoveragePath
  ].map((artifactPath) => mkdir(path.dirname(artifactPath), { recursive: true })));
  await Promise.all([
    writeFile(paths.verificationReportPath, JSON.stringify(artifacts.verificationReport), 'utf8'),
    writeFile(paths.runtimeReportPath, JSON.stringify(artifacts.runtimeReport), 'utf8'),
    writeFile(paths.policyReportPath, JSON.stringify(artifacts.policyReport), 'utf8'),
    writeFile(paths.acceptanceCoveragePath, JSON.stringify(artifacts.acceptanceCoverage), 'utf8')
  ]);
  return paths;
}

async function publishProgressTrace(
  stagingRoot: string,
  checkpoints: readonly SemanticMutationIsolatedProgressCheckpoint[]
): Promise<void> {
  for (const checkpoint of checkpoints) {
    await publishSemanticMutationIsolatedProgressCheckpoint(stagingRoot, checkpoint);
  }
}

const RUNNER_ENTERED_PROGRESS_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[]);

const TEST_BUNDLED_LOADER_BINDING = Object.freeze({
  formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1' as const,
  executionRevision: 'semantic-mutation-bundled-core-relocation-v1' as const
});

function failureProgressTrace(
  stage: SemanticMutationIsolatedChildFailureStage
): readonly SemanticMutationIsolatedProgressCheckpoint[] {
  return [
    ...RUNNER_ENTERED_PROGRESS_TRACE,
    'catch-armed',
    ...(stage === 'preflight' ? [] : ['verify-all'] as const),
    ...(stage === 'postcondition' ? ['postcondition'] as const : []),
    'failure-caught',
    'catch-tree-validated',
    'outcome-publish-started'
  ];
}

async function publishFailedChildControl(
  stagingRoot: string,
  stage: SemanticMutationIsolatedChildFailureStage,
  boundary?: Parameters<typeof buildSemanticMutationIsolatedChildOutcome>[1]
): Promise<void> {
  await publishProgressTrace(stagingRoot, failureProgressTrace(stage));
  await publishSemanticMutationIsolatedChildOutcome(
    stagingRoot,
    buildSemanticMutationIsolatedChildOutcome(stage, boundary)
  );
}

async function publishSuccessfulChildTrace(stagingRoot: string): Promise<void> {
  await publishProgressTrace(stagingRoot, [
    ...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all', 'postcondition'
  ]);
}

async function createResolvedIsolatedHostFixture(
  root: string,
  caseId: string,
  transactionDigit: string
) {
  const workspaceRoot = path.join(root, caseId);
  const stagingRoot = stagingWorkspaceRoot(workspaceRoot, transactionDigit.repeat(64));
  await mkdir(path.dirname(stagingRoot), { recursive: true });
  await initWorkspace(stagingRoot, { reset: true });
  await writeProjectBaseline(stagingRoot);
  const browserSource = path.join(workspaceRoot, 'browser-source');
  const runtimeInputSources = await createRuntimeInputSources(workspaceRoot, browserSource);
  const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
    buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
    runtimeInputSources
  });
  expect(runtimeCapabilityForTest.status).toBe('available');
  return { runtimeCapabilityForTest, stagingRoot, workspaceRoot };
}

async function runPassedIsolatedArtifactsForProof(
  fixture: Awaited<ReturnType<typeof createResolvedIsolatedHostFixture>>,
  acceptanceCoverage?: AcceptanceCoverageReport
): Promise<Awaited<ReturnType<typeof runSemanticMutationIsolatedVerificationChild>>> {
  return runSemanticMutationIsolatedVerificationChild(fixture.stagingRoot, {
    commitFence: async () => undefined,
    runtimeCapabilityForTest: fixture.runtimeCapabilityForTest,
    supervisor: async () => {
      const paths = await writeIsolatedVerificationArtifacts(fixture.stagingRoot, 'passed');
      if (acceptanceCoverage) {
        await writeFile(
          paths.acceptanceCoveragePath,
          JSON.stringify(acceptanceCoverage),
          'utf8'
        );
      }
      await publishSuccessfulChildTrace(fixture.stagingRoot);
      return { code: 0, stdout: '', stderr: '' };
    },
    workspaceRoot: fixture.workspaceRoot,
    workspaceWriteLease: workspaceWriteLeaseToken()
  });
}

test('isolated staging scan scheduler is bounded and stops after the failed canonical batch', async () => {
  const items = Array.from({ length: 128 }, (_, index) => index);
  let active = 0;
  let maxActive = 0;
  const doubled = await runIsolatedStagingScanBatchesForTests(items, async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return item * 2;
  });
  expect(doubled).toEqual(items.map((item) => item * 2));
  expect(maxActive).toBeGreaterThan(1);
  expect(maxActive).toBeLessThanOrEqual(64);

  const started: number[] = [];
  await expect(runIsolatedStagingScanBatchesForTests(items, async (_item, index) => {
    started.push(index);
    if (index === 3) throw new Error('controlled scan failure');
    await Promise.resolve();
    return index;
  })).rejects.toThrow('controlled scan failure');
  expect(started).toEqual(Array.from({ length: 64 }, (_, index) => index));
});

test('isolated child progress is canonical, monotonic, bounded, and coarsely classifies exits', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    await ensureIsolatedProcessDirectories(path.join(stagingRoot, '.isolated-process', 'child'));
    await publishProgressTrace(stagingRoot, [
      ...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all'
    ]);
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'valid',
      trace: {
        checkpoints: [...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all'],
        lastCheckpoint: 'verify-all'
      }
    });
    expect(classifySemanticMutationIsolatedTermination(0)).toBe('zero');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure
    )).toBe('runner-controlled-failure');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure
    )).toBe('loader-import-failure');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure
    )).toBe('runner-staging-tree-failure');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure
    )).toBe('runner-environment-boundary-failure');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure
    )).toBe('runner-staging-layout-boundary-failure');
    expect(classifySemanticMutationIsolatedTermination(
      SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure
    )).toBe('bootstrap-environment-boundary-failure');
    expect(classifySemanticMutationIsolatedTermination(80)).toBe('unclassified-nonzero');
    expect(classifySemanticMutationIsolatedTermination(9)).toBe('unclassified-nonzero');
    expect(() => classifySemanticMutationIsolatedTermination(-1)).toThrow('exit code is invalid');

    const checkpointPath = semanticMutationIsolatedProgressCheckpointPath(stagingRoot, 'verify-all');
    await writeFile(checkpointPath, new Uint8Array([0xef, 0xbb, 0xbf, ...
      semanticMutationIsolatedProgressCheckpointBytes('verify-all')]));
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'parse-error'
    });
    await writeFile(checkpointPath, new Uint8Array(257));
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'parse-error'
    });
    await writeFile(
      checkpointPath,
      semanticMutationIsolatedProgressCheckpointBytes('verify-all')
    );
    await writeFile(
      semanticMutationIsolatedProgressCheckpointPendingPath(stagingRoot, 'postcondition'),
      new Uint8Array(257)
    );
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'protocol-error'
    });
  }, 'engineering-compiler-sm3-progress-contract-');
});

test('physical loader reaches the exact bundled core without package authority', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const coreObservedPath = path.join(stagingRoot, '.isolated-process', 'child', 'core-observed.txt');
    const loaderCheckpointPaths = [
      'bootstrap-entered',
      'loader-entered',
      'core-import-started'
    ].map((checkpoint) => semanticMutationIsolatedProgressCheckpointPath(
      stagingRoot,
      checkpoint as SemanticMutationIsolatedProgressCheckpoint
    ));
    const coreSource = [
      "import { readFile, writeFile } from 'node:fs/promises';",
      `const checkpointPaths = ${JSON.stringify(loaderCheckpointPaths)};`,
      "for (const checkpointPath of checkpointPaths) await readFile(checkpointPath, 'utf8');",
      `await writeFile(${JSON.stringify(coreObservedPath)}, 'bundled-core-observed-v1', 'utf8');`,
      ''
    ].join('\n');
    const runtimeCapability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode(coreSource),
      runtimeInputSources
    });
    expect(runtimeCapability.status).toBe('available');
    const materialized = await materializeSemanticMutationIsolatedRuntime({
      binding: runtimeCapability,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingRoot
    });
    await mkdir(path.join(stagingRoot, '.isolated-process', 'child'), { recursive: true });
    expect(materialized.runnerRelativePath).toBe(SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH);
    const bootstrapSource = new TextDecoder().decode(semanticMutationIsolatedBootstrapBytes());
    const loaderSource = new TextDecoder().decode(
      semanticMutationIsolatedStagedLoaderBytes(TEST_BUNDLED_LOADER_BINDING)
    );
    expect(bootstrapSource).toContain('bootstrap-entered');
    expect(bootstrapSource).toContain('await import(new URL(');
    expect(bootstrapSource).toContain('semantic-mutation-isolated-verification-loader.mjs');
    expect(bootstrapSource).not.toContain(path.resolve(root));
    expect(loaderSource).not.toContain('Bun.resolveSync');
    expect(loaderSource).not.toContain("await import('typescript')");
    expect(loaderSource).not.toContain("await import('ts-morph')");
    expect(loaderSource).toContain("await publish('core-import-started')");
    expect(loaderSource).not.toContain(path.resolve(root));
    const result = await runCommand(process.execPath, [
      '--no-env-file',
      `--config=${path.join(stagingRoot, '.isolated-compiler', 'bunfig.toml')}`,
      '--no-install',
      path.join(stagingRoot, ...materialized.runnerRelativePath.split('/'))
    ], {
      cwd: process.platform === 'win32' ? path.parse(stagingRoot).root : stagingRoot,
      env: buildSemanticMutationIsolatedVerificationEnvironment(stagingRoot),
      envMode: 'replace'
    });
    expect(result.code).toBe(0);
    expect(await readFile(coreObservedPath, 'utf8')).toBe('bundled-core-observed-v1');
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'valid',
      trace: {
        checkpoints: [
          'bootstrap-entered', 'loader-entered', 'core-import-started'
        ],
        lastCheckpoint: 'core-import-started'
      }
    });
  }, 'engineering-compiler-sm3-bootstrap-before-core-');
});

test('trusted bootstrap fails closed before progress when its manifest-bound location is relocated', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const bootstrapPath = path.join(stagingRoot, 'relocated-bootstrap.mjs');
    await mkdir(path.dirname(bootstrapPath), { recursive: true });
    await writeFile(bootstrapPath, semanticMutationIsolatedBootstrapBytes());
    await ensureIsolatedProcessDirectories(path.join(stagingRoot, '.isolated-process', 'child'));

    const result = await runCommand(process.execPath, [
      '--no-env-file',
      '--no-install',
      bootstrapPath
    ], {
      cwd: process.platform === 'win32' ? path.parse(stagingRoot).root : stagingRoot,
      env: buildSemanticMutationIsolatedVerificationEnvironment(stagingRoot),
      envMode: 'replace'
    });

    expect(result).toEqual({
      code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure,
      stdout: '',
      stderr: ''
    });
    expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
      status: 'valid',
      trace: { checkpoints: [] }
    });
  }, 'sm3-bootstrap-relocated-');
});

test('staged loader delegates only to the manifest-bound bundled core without package resolution', async () => {
  await withTempWorkspace(async (root) => {
    for (const testCase of [
      {
        id: 'bundled-core-success',
        runnerSource: 'export {};\n',
        code: 0
      },
      {
        id: 'bundled-core-import-failure',
        runnerSource: 'const =',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure
      }
    ]) {
      const caseRoot = path.join(root, testCase.id);
      const stagingRoot = stagingWorkspaceRoot(caseRoot);
      const browserSource = path.join(caseRoot, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const runtimeInputSources = await createRuntimeInputSources(caseRoot, browserSource);
      const runtimeCapability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode(testCase.runnerSource),
        runtimeInputSources
      });
      expect(runtimeCapability.status).toBe('available');
      const materialized = await materializeSemanticMutationIsolatedRuntime({
        binding: runtimeCapability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });
      await ensureIsolatedProcessDirectories(path.join(stagingRoot, '.isolated-process', 'child'));
      const result = await runCommand(process.execPath, [
        '--no-env-file',
        `--config=${path.join(stagingRoot, '.isolated-compiler', 'bunfig.toml')}`,
        '--no-install',
        path.join(stagingRoot, ...materialized.runnerRelativePath.split('/'))
      ], {
        cwd: process.platform === 'win32' ? path.parse(stagingRoot).root : stagingRoot,
        env: buildSemanticMutationIsolatedVerificationEnvironment(stagingRoot),
        envMode: 'replace'
      });
      expect(result.code).toBe(testCase.code);
      expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
        status: 'valid',
        trace: {
          checkpoints: ['bootstrap-entered', 'loader-entered', 'core-import-started'],
          lastCheckpoint: 'core-import-started'
        }
      });
      expect(result.stdout).not.toContain(caseRoot);
      expect(result.stderr).not.toContain(caseRoot);
    }
  }, 'engineering-compiler-sm3-staged-loader-boundary-');
});

test('isolated verification supervisor aborts an active runner when its workspace lease fence is lost', async () => {
  let leaseValid = true;
  let aborted = false;
  let fenceCalls = 0;
  const commitFence = async (): Promise<void> => {
    fenceCalls += 1;
    if (!leaseValid) throw new Error('injected supervisor lease loss');
  };
  const commandRunner: typeof runCommand = async (_command, _args, options) => {
    await options.beforeSpawn?.();
    leaseValid = false;
    return new Promise((_resolve, reject) => {
      const onAbort = (): void => {
        aborted = true;
        reject(new Error('runner aborted'));
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    commandRunner,
    pollIntervalMs: 1
  });
  const workspaceRoot = String.raw`C:\live-workspace`;
  const workspaceWriteLease = workspaceWriteLeaseToken();

  await expect(supervisor({
    commitFence,
    env: { PATH: '' },
    runnerRelativePath: '.isolated-process/runner/runner.mjs',
    stagingWorkspaceRoot: String.raw`C:\isolated-staging`,
    workspaceRoot,
    workspaceWriteLease
  })).rejects.toThrow('injected supervisor lease loss');
  expect(aborted).toBe(true);
  expect(fenceCalls).toBeGreaterThanOrEqual(3);
});

test('production isolated verification supervisor uses one bounded observed local child', async () => {
  const workspaceRoot = String.raw`C:\live-workspace`;
  const stagingRoot = String.raw`C:\live-workspace\.sec\semantic-mutation\v1\transactions\${'b'.repeat(64)}\workspace`;
  const workspaceWriteLease = workspaceWriteLeaseToken();
  const empty = new Uint8Array();
  let calls = 0;
  let fences = 0;
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    observedCommandRunner: async (command, args, options) => {
      calls += 1;
      expect(command).toBe(process.execPath);
      expect(args).toEqual([
        '--no-env-file',
        `--config=${path.join(stagingRoot, '.isolated-compiler', 'bunfig.toml')}`,
        '--no-install',
        path.join(stagingRoot, '.isolated-compiler', 'platform', 'orchestrator', 'runner.mjs')
      ]);
      expect(options).toMatchObject({
        cwd: process.platform === 'win32' ? path.parse(stagingRoot).root : stagingRoot,
        envMode: 'replace',
        maxObservedOutputBytes: 64 * 1024,
        timeoutMs: 1_200_000
      });
      expect(options.env).toEqual({
        PATH: '',
        SYSTEMROOT: String.raw`C:\Windows`,
        WINDIR: String.raw`C:\Windows`
      });
      await options.beforeSpawn?.();
      await options.whileRunning?.();
      return observedRunnerBuildOutcome(empty, { exitCode: 7 });
    }
  });

  expect(await supervisor({
    commitFence: async () => { fences += 1; },
    env: {
      PATH: '',
      SYSTEMROOT: String.raw`C:\Windows`,
      WINDIR: String.raw`C:\Windows`
    },
    runnerRelativePath: '.isolated-compiler/platform/orchestrator/runner.mjs',
    stagingWorkspaceRoot: stagingRoot,
    workspaceRoot,
    workspaceWriteLease
  })).toEqual({ code: 7, stdout: '', stderr: '' });
  expect(calls).toBe(1);
  expect(fences).toBe(3);
});

test('isolated Verification suppresses runtime timing before the zero-output child boundary', async () => {
  const source = await readFile(path.join(
    compilerRoot,
    'platform',
    'orchestrator',
    'verify-orchestrator.ts'
  ), 'utf8');
  expect(source).toContain('emitTiming: isolated ? false : options.emitTiming');
});

test('production isolated verification supervisor rejects unclosed or truncated child lifecycle', async () => {
  const empty = new Uint8Array();
  const request = {
    commitFence: async () => undefined,
    env: { PATH: '' },
    runnerRelativePath: '.isolated-compiler/platform/orchestrator/runner.mjs',
    stagingWorkspaceRoot: String.raw`C:\isolated-staging`,
    workspaceRoot: String.raw`C:\live-workspace`,
    workspaceWriteLease: workspaceWriteLeaseToken()
  };
  for (const outcome of [
    observedRunnerBuildOutcome(empty, { status: 'timed-out' }),
    observedRunnerBuildOutcome(empty, {
      termination: {
        ...observedRunnerBuildOutcome(empty).termination,
        treeClosed: false
      }
    }),
    observedRunnerBuildOutcome(empty, {
      stderr: { bytes: 65_537, digest: observedDigest(empty), observerTruncated: true }
    })
  ]) {
    const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
      observedCommandRunner: async () => outcome
    });
    const failure = await supervisor(request).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(projectSemanticMutationIsolatedVerificationFailureForTests(
      'isolated-child-execution',
      failure
    )).toEqual({
      stage: 'isolated-child-execution',
      lifecycle: {
        status: outcome.status,
        ...(outcome.trigger === undefined ? {} : { trigger: outcome.trigger }),
        started: outcome.started,
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        termination: outcome.termination
      }
    });
  }
});

test('production isolated verification supervisor enforces one combined output budget', async () => {
  const empty = new Uint8Array();
  let budgetRejected = false;
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    observedCommandRunner: async (_command, _args, options) => {
      options.onChunk?.('stdout', 64 * 1024);
      try {
        options.onChunk?.('stderr', 1);
      } catch (error) {
        budgetRejected = error instanceof Error &&
          error.message === 'Semantic Mutation isolated child exceeded its output budget';
      }
      return observedRunnerBuildOutcome(empty, {
        status: 'observer-failed',
        trigger: 'observer-failed'
      });
    }
  });

  await expect(supervisor({
    commitFence: async () => undefined,
    env: { PATH: '' },
    runnerRelativePath: '.isolated-compiler/platform/orchestrator/runner.mjs',
    stagingWorkspaceRoot: String.raw`C:\isolated-staging`,
    workspaceRoot: String.raw`C:\live-workspace`,
    workspaceWriteLease: workspaceWriteLeaseToken()
  })).rejects.toThrow('Semantic Mutation isolated child lifecycle did not settle');
  expect(budgetRejected).toBe(true);
});

test('isolated verification fences report cleanup before removing any prior evidence', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const reportPath = getWorkspacePaths(stagingRoot).verificationReportPath;
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, 'retained-report', 'utf8');
    await writeProjectBaseline(stagingRoot);
    const browserSource = path.join(root, 'browser-source');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    let bundleBuilds = 0;
    let supervisorCalls = 0;
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilds += 1;
        return new Uint8Array([1]);
      },
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    await expect(runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        throw new Error('injected report cleanup lease loss');
      },
      runtimeCapabilityForTest,
      supervisor: async () => {
        supervisorCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
      workspaceRoot: root,
      workspaceWriteLease
    })).rejects.toThrow('Semantic Mutation isolated verification is unavailable');

    expect(await readFile(reportPath, 'utf8')).toBe('retained-report');
    expect(bundleBuilds).toBe(1);
    expect(supervisorCalls).toBe(0);
  }, 'engineering-compiler-sm3-isolated-report-fence-');
});

test('isolated verification rechecks the fence after planned runner construction before writing it', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const browserSource = path.join(root, 'browser-source');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runnerPath = path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    );
    let bundleBuilt = false;
    let supervisorCalls = 0;
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilt = true;
        return new TextEncoder().encode('console.log("runner")');
      },
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    await expect(runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        if (bundleBuilt) throw new Error('injected post-bundle lease loss');
      },
      runtimeCapabilityForTest,
      supervisor: async () => {
        supervisorCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
      workspaceRoot: root,
      workspaceWriteLease
    })).rejects.toThrow('Semantic Mutation isolated verification is unavailable');

    await expect(stat(runnerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(supervisorCalls).toBe(0);
  }, 'engineering-compiler-sm3-isolated-runner-bundle-fence-');
});

test('isolated verification materializes fenced runner and browser inputs before invoking its supervisor hook', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    await writeFile(path.join(
      browserSource,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ), new Uint8Array([3, 1, 4, 1, 5]));
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');
    let fenceCalls = 0;
    let supervisorCalls = 0;

    const unavailable = await runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        fenceCalls += 1;
      },
      runtimeCapabilityForTest,
      supervisor: async (request) => {
        supervisorCalls += 1;
        expect(request.runnerRelativePath)
          .toBe(SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH);
        expect(request.stagingWorkspaceRoot).toBe(stagingRoot);
        expect(request.workspaceRoot).toBe(root);
        expect(request.workspaceWriteLease).toBe(workspaceWriteLease);
        await request.commitFence();
        throw legacyWindowsAppContainerExecutionError('cleanup', undefined, {
          stage: 'profile-query',
          reason: 'nonzero-exit',
          termination: 'not-requested'
        });
      },
      workspaceRoot: root,
      workspaceWriteLease
    }).then(() => undefined, (error: unknown) => error);

    expect(unavailable).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((unavailable as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'appcontainer-execution',
      appContainer: {
        phase: 'cleanup',
        hostToolFailure: {
          stage: 'profile-query',
          reason: 'nonzero-exit',
          termination: 'not-requested'
        }
      }
    });
    expect(JSON.stringify(unavailable)).not.toContain(root);

    expect(supervisorCalls).toBe(1);
    expect(fenceCalls).toBeGreaterThanOrEqual(20);
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    ), 'utf8')).toBe('console.log("runner")');
    expect(await readFile(path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH.split('/')
    ), 'utf8')).toContain('bootstrap-entered');
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'compiler',
      'compose',
      'templates',
      'template.txt'
    ), 'utf8')).toBe('template');
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'node_modules',
      'typescript',
      'package.json'
    ), 'utf8')).toContain('"name":"typescript"');
    expect(await readFile(path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/'),
      'cache.bin'
    ), 'utf8')).toBe('cache');
    expect(JSON.parse(await readFile(path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/'),
      RUNTIME_DEPS_PREBOUND_BINDING_FILE
    ), 'utf8'))).toMatchObject({
      formatVersion: 'runtime-deps-prebound-binding-v1'
    });
    await expect(stat(path.join(stagingRoot, '.isolated-compiler', '.shared-deps')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-process',
      'playwright-browsers',
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ))).toEqual(Buffer.from([3, 1, 4, 1, 5]));
  }, 'engineering-compiler-sm3-isolated-materialization-fence-');
});

test('isolated host replaces stale receipts and reports the first missing artifact with a typed child stage', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    const outcomePath = semanticMutationIsolatedChildOutcomePath(stagingRoot);
    const pendingPath = semanticMutationIsolatedChildOutcomePendingPath(stagingRoot);
    const staleCheckpointPath = semanticMutationIsolatedProgressCheckpointPath(
      stagingRoot,
      'bootstrap-entered'
    );
    const staleCheckpointPendingPath = semanticMutationIsolatedProgressCheckpointPendingPath(
      stagingRoot,
      'module-entered'
    );
    await mkdir(path.dirname(outcomePath), { recursive: true });
    await writeFile(outcomePath, 'stale-final', 'utf8');
    await writeFile(pendingPath, 'stale-pending', 'utf8');
    await writeFile(staleCheckpointPath, 'stale-checkpoint', 'utf8');
    await writeFile(staleCheckpointPendingPath, 'stale-checkpoint-pending', 'utf8');

    const unavailable = await runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => undefined,
      runtimeCapabilityForTest,
      supervisor: async () => {
        await expect(stat(outcomePath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(staleCheckpointPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(stat(staleCheckpointPendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await publishFailedChildControl(stagingRoot, 'verify-all', 'verify-runtime');
        return {
          code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
          stdout: '',
          stderr: ''
        };
      },
      workspaceRoot: root,
      workspaceWriteLease
    }).then(() => undefined, (error: unknown) => error);

    expect(unavailable).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((unavailable as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'child-failed-before-artifacts',
      child: { stage: 'verify-all', boundary: 'verify-runtime' },
      artifact: 'verification-report',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });
    expect(await readFile(outcomePath, 'utf8')).toBe(
      '{"formatVersion":"semantic-mutation-isolated-child-outcome-v1","status":"failed","stage":"verify-all","boundary":"verify-runtime"}\n'
    );
  }, 'engineering-compiler-sm3-child-outcome-host-');
});

test('isolated host rejects a non-canonical child outcome before reading canonical reports', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    const outcomePath = semanticMutationIsolatedChildOutcomePath(stagingRoot);
    const unavailable = await runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => undefined,
      runtimeCapabilityForTest,
      supervisor: async () => {
        await publishProgressTrace(stagingRoot, failureProgressTrace('verify-all'));
        await writeFile(outcomePath, JSON.stringify({
          formatVersion: 'semantic-mutation-isolated-child-outcome-v1',
          status: 'failed',
          stage: 'verify-all'
        }, null, 2), 'utf8');
        return {
          code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
          stdout: '',
          stderr: ''
        };
      },
      workspaceRoot: root,
      workspaceWriteLease
    }).then(() => undefined, (error: unknown) => error);

    expect(unavailable).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((unavailable as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-parse',
      artifact: 'child-outcome',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });

    const oversized = await createResolvedIsolatedHostFixture(root, 'oversized-outcome', 'e');
    const oversizedError = await runSemanticMutationIsolatedVerificationChild(
      oversized.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: oversized.runtimeCapabilityForTest,
        supervisor: async () => {
          await publishProgressTrace(oversized.stagingRoot, failureProgressTrace('verify-all'));
          await writeFile(
            semanticMutationIsolatedChildOutcomePath(oversized.stagingRoot),
            new Uint8Array(513)
          );
          return {
            code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
            stdout: '',
            stderr: ''
          };
        },
        workspaceRoot: oversized.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(oversizedError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((oversizedError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-parse',
      artifact: 'child-outcome',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });
  }, 'engineering-compiler-sm3-child-outcome-parse-');
});

test('isolated host exposes only coarse termination and the last durable checkpoint without an outcome', async () => {
  await withTempWorkspace(async (root) => {
    const unclassified = await createResolvedIsolatedHostFixture(root, 'unclassified-exit', '8');
    const unclassifiedError = await runSemanticMutationIsolatedVerificationChild(
      unclassified.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: unclassified.runtimeCapabilityForTest,
        supervisor: async () => {
          await publishProgressTrace(unclassified.stagingRoot, [
            ...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all'
          ]);
          return { code: 1, stdout: 'poisoned stdout', stderr: 'poisoned stderr' };
        },
        workspaceRoot: unclassified.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(unclassifiedError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((unclassifiedError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'child-terminated-without-outcome',
      artifact: 'verification-report',
      termination: { class: 'unclassified-nonzero', checkpoint: 'verify-all' }
    });
    expect(JSON.stringify(unclassifiedError)).not.toContain('poisoned');

    for (const diagnostic of [
      {
        caseId: 'bundled-core-import-rejected',
        digit: 'a',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure,
        checkpoints: ['bootstrap-entered', 'loader-entered', 'core-import-started'] as const,
        termination: { class: 'loader-import-failure', checkpoint: 'core-import-started' } as const
      },
      {
        caseId: 'bootstrap-environment-rejected',
        digit: 'b',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure,
        checkpoints: [] as const,
        termination: { class: 'bootstrap-environment-boundary-failure' } as const
      }
    ]) {
      const fixture = await createResolvedIsolatedHostFixture(root, diagnostic.caseId, diagnostic.digit);
      const error = await runSemanticMutationIsolatedVerificationChild(fixture.stagingRoot, {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: fixture.runtimeCapabilityForTest,
        supervisor: async () => {
          await publishProgressTrace(fixture.stagingRoot, diagnostic.checkpoints);
          return {
            code: diagnostic.code,
            stdout: 'poisoned loader stdout',
            stderr: 'poisoned loader stderr'
          };
        },
        workspaceRoot: fixture.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }).then(() => undefined, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
      expect((error as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
        stage: 'child-terminated-without-outcome',
        artifact: 'verification-report',
        termination: diagnostic.termination
      });
      expect(JSON.stringify(error)).not.toContain('poisoned');
    }

    const interrupted = await createResolvedIsolatedHostFixture(root, 'progress-interrupted', '9');
    const interruptedError = await runSemanticMutationIsolatedVerificationChild(
      interrupted.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: interrupted.runtimeCapabilityForTest,
        supervisor: async () => {
          await publishProgressTrace(interrupted.stagingRoot, [
            ...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all'
          ]);
          await writeFile(
            semanticMutationIsolatedProgressCheckpointPendingPath(
              interrupted.stagingRoot,
              'failure-caught'
            ),
            'partial',
            'utf8'
          );
          return {
            code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure,
            stdout: '',
            stderr: ''
          };
        },
        workspaceRoot: interrupted.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(interruptedError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((interruptedError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'child-terminated-without-outcome',
      artifact: 'verification-report',
      termination: {
        class: 'progress-publication-failure',
        checkpoint: 'verify-all',
        pendingCheckpoint: 'failure-caught'
      }
    });
  }, 'engineering-compiler-sm3-child-termination-trace-');
});

test('isolated host enforces receipt, exit, and complete canonical report coherence', async () => {
  await withTempWorkspace(async (root) => {
    const receiptWithZero = await createResolvedIsolatedHostFixture(root, 'receipt-zero', '1');
    const receiptWithZeroError = await runSemanticMutationIsolatedVerificationChild(
      receiptWithZero.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: receiptWithZero.runtimeCapabilityForTest,
        supervisor: async () => {
          await writeIsolatedVerificationArtifacts(receiptWithZero.stagingRoot, 'passed');
          await publishFailedChildControl(receiptWithZero.stagingRoot, 'verify-all');
          return { code: 0, stdout: '', stderr: '' };
        },
        workspaceRoot: receiptWithZero.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(receiptWithZeroError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((receiptWithZeroError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-protocol',
      child: { stage: 'verify-all' },
      artifact: 'verification-set',
      termination: { class: 'zero', checkpoint: 'outcome-publish-started' }
    });

    const preflightWithReports = await createResolvedIsolatedHostFixture(root, 'preflight-reports', '2');
    const preflightError = await runSemanticMutationIsolatedVerificationChild(
      preflightWithReports.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: preflightWithReports.runtimeCapabilityForTest,
        supervisor: async () => {
          await writeIsolatedVerificationArtifacts(preflightWithReports.stagingRoot, 'failed');
          await publishFailedChildControl(preflightWithReports.stagingRoot, 'preflight');
          return {
            code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
            stdout: '',
            stderr: ''
          };
        },
        workspaceRoot: preflightWithReports.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(preflightError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((preflightError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-protocol',
      child: { stage: 'preflight' },
      artifact: 'verification-set',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });

    for (const adversarial of [
      {
        caseId: 'entry-with-reports',
        transactionDigit: 'b',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEntryFailure,
        checkpoints: RUNNER_ENTERED_PROGRESS_TRACE,
        termination: { class: 'runner-entry-failure', checkpoint: 'module-entered' } as const
      },
      {
        caseId: 'staging-tree-with-reports',
        transactionDigit: 'e',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure,
        checkpoints: RUNNER_ENTERED_PROGRESS_TRACE,
        termination: { class: 'runner-staging-tree-failure', checkpoint: 'module-entered' } as const
      },
      {
        caseId: 'environment-boundary-with-reports',
        transactionDigit: '6',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure,
        checkpoints: RUNNER_ENTERED_PROGRESS_TRACE,
        termination: {
          class: 'runner-environment-boundary-failure', checkpoint: 'module-entered'
        } as const
      },
      {
        caseId: 'staging-layout-boundary-with-reports',
        transactionDigit: '7',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure,
        checkpoints: RUNNER_ENTERED_PROGRESS_TRACE,
        termination: {
          class: 'runner-staging-layout-boundary-failure', checkpoint: 'module-entered'
        } as const
      },
      {
        caseId: 'progress-before-compile-with-reports',
        transactionDigit: 'c',
        code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure,
        checkpoints: [
          ...RUNNER_ENTERED_PROGRESS_TRACE, 'catch-armed', 'verify-all'
        ] as const,
        termination: { class: 'progress-publication-failure', checkpoint: 'verify-all' } as const
      },
      {
        caseId: 'unclassified-before-compile-with-reports',
        transactionDigit: 'd',
        code: 1,
        checkpoints: RUNNER_ENTERED_PROGRESS_TRACE,
        termination: { class: 'unclassified-nonzero', checkpoint: 'module-entered' } as const
      }
    ]) {
      const fixture = await createResolvedIsolatedHostFixture(
        root,
        adversarial.caseId,
        adversarial.transactionDigit
      );
      const error = await runSemanticMutationIsolatedVerificationChild(fixture.stagingRoot, {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: fixture.runtimeCapabilityForTest,
        supervisor: async () => {
          await writeIsolatedVerificationArtifacts(fixture.stagingRoot, 'failed');
          await publishProgressTrace(fixture.stagingRoot, adversarial.checkpoints);
          return { code: adversarial.code, stdout: '', stderr: '' };
        },
        workspaceRoot: fixture.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }).then(() => undefined, (failure: unknown) => failure);
      expect(error).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
      expect((error as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
        stage: 'artifact-protocol',
        artifact: 'verification-set',
        termination: adversarial.termination
      });
    }

    for (const [stage, transactionDigit] of [
      ['verify-all', '3'],
      ['postcondition', '4']
    ] as const) {
      const canonicalFailure = await createResolvedIsolatedHostFixture(
        root,
        `canonical-failure-${stage}`,
        transactionDigit
      );
      const result = await runSemanticMutationIsolatedVerificationChild(canonicalFailure.stagingRoot, {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: canonicalFailure.runtimeCapabilityForTest,
        supervisor: async () => {
          await writeIsolatedVerificationArtifacts(canonicalFailure.stagingRoot, 'failed');
          await publishFailedChildControl(canonicalFailure.stagingRoot, stage);
          return {
            code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
            stdout: '',
            stderr: ''
          };
        },
        workspaceRoot: canonicalFailure.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      });
      expect(result.status).toBe('failed');
    }

    const canonicalSuccess = await createResolvedIsolatedHostFixture(root, 'canonical-success', 'a');
    const success = await runSemanticMutationIsolatedVerificationChild(canonicalSuccess.stagingRoot, {
      commitFence: async () => undefined,
      runtimeCapabilityForTest: canonicalSuccess.runtimeCapabilityForTest,
      supervisor: async () => {
        await writeIsolatedVerificationArtifacts(canonicalSuccess.stagingRoot, 'passed');
        await publishSuccessfulChildTrace(canonicalSuccess.stagingRoot);
        return { code: 0, stdout: '', stderr: '' };
      },
      workspaceRoot: canonicalSuccess.workspaceRoot,
      workspaceWriteLease: workspaceWriteLeaseToken()
    });
    expect(success.status).toBe('passed');
  }, 'engineering-compiler-sm3-child-outcome-coherence-');
});

test('isolated host classifies the first report parse, read, or missing failure in canonical order', async () => {
  await withTempWorkspace(async (root) => {
    const runtimeParse = await createResolvedIsolatedHostFixture(root, 'runtime-parse', '5');
    const runtimeParseError = await runSemanticMutationIsolatedVerificationChild(runtimeParse.stagingRoot, {
      commitFence: async () => undefined,
      runtimeCapabilityForTest: runtimeParse.runtimeCapabilityForTest,
      supervisor: async () => {
        const paths = await writeIsolatedVerificationArtifacts(runtimeParse.stagingRoot, 'failed');
        await writeFile(paths.runtimeReportPath, '{', 'utf8');
        await rm(paths.policyReportPath, { force: true });
        await rm(paths.acceptanceCoveragePath, { force: true });
        await publishFailedChildControl(runtimeParse.stagingRoot, 'postcondition');
        return {
          code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
          stdout: '',
          stderr: ''
        };
      },
      workspaceRoot: runtimeParse.workspaceRoot,
      workspaceWriteLease: workspaceWriteLeaseToken()
    }).then(() => undefined, (error: unknown) => error);
    expect(runtimeParseError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((runtimeParseError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-parse',
      child: { stage: 'postcondition' },
      artifact: 'runtime-report',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });

    const policyRead = await createResolvedIsolatedHostFixture(root, 'policy-read', '6');
    const policyReadError = await runSemanticMutationIsolatedVerificationChild(policyRead.stagingRoot, {
      commitFence: async () => undefined,
      runtimeCapabilityForTest: policyRead.runtimeCapabilityForTest,
      supervisor: async () => {
        const paths = await writeIsolatedVerificationArtifacts(policyRead.stagingRoot, 'failed');
        await rm(paths.policyReportPath, { force: true });
        await mkdir(paths.policyReportPath);
        await rm(paths.acceptanceCoveragePath, { force: true });
        await publishFailedChildControl(policyRead.stagingRoot, 'postcondition');
        return {
          code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
          stdout: '',
          stderr: ''
        };
      },
      workspaceRoot: policyRead.workspaceRoot,
      workspaceWriteLease: workspaceWriteLeaseToken()
    }).then(() => undefined, (error: unknown) => error);
    expect(policyReadError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((policyReadError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-read',
      child: { stage: 'postcondition' },
      artifact: 'policy-report',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });

    const coverageMissing = await createResolvedIsolatedHostFixture(root, 'coverage-missing', '7');
    const coverageMissingError = await runSemanticMutationIsolatedVerificationChild(
      coverageMissing.stagingRoot,
      {
        commitFence: async () => undefined,
        runtimeCapabilityForTest: coverageMissing.runtimeCapabilityForTest,
        supervisor: async () => {
          const paths = await writeIsolatedVerificationArtifacts(coverageMissing.stagingRoot, 'failed');
          await rm(paths.acceptanceCoveragePath, { force: true });
          await publishFailedChildControl(coverageMissing.stagingRoot, 'postcondition');
          return {
            code: SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure,
            stdout: '',
            stderr: ''
          };
        },
        workspaceRoot: coverageMissing.workspaceRoot,
        workspaceWriteLease: workspaceWriteLeaseToken()
      }
    ).then(() => undefined, (error: unknown) => error);
    expect(coverageMissingError).toBeInstanceOf(SemanticMutationIsolatedVerificationUnavailableError);
    expect((coverageMissingError as SemanticMutationIsolatedVerificationUnavailableError).failure).toEqual({
      stage: 'artifact-missing',
      child: { stage: 'postcondition' },
      artifact: 'acceptance-coverage',
      termination: {
        class: 'runner-controlled-failure',
        checkpoint: 'outcome-publish-started'
      }
    });
  }, 'engineering-compiler-sm3-child-outcome-order-');
});

test('runtime plan treats TypeScript package entry metadata as assets, not loader authority', async () => {
  await withTempWorkspace(async (root) => {
    for (const testCase of [
      { id: 'escape-main', manifest: { name: 'typescript', main: './../escape.js', dependencies: {} } },
      {
        id: 'exports-authority',
        manifest: {
          name: 'typescript',
          main: './index.js',
          exports: { '.': './index.js' },
          dependencies: {}
        }
      },
      { id: 'missing-main', manifest: { name: 'typescript', main: './missing.js', dependencies: {} } }
    ]) {
      const caseRoot = path.join(root, testCase.id);
      const stagingRoot = stagingWorkspaceRoot(caseRoot);
      const browserSource = path.join(caseRoot, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const runtimeInputSources = await createRuntimeInputSources(caseRoot, browserSource);
      await writeFile(
        path.join(runtimeInputSources.compilerModulesRoot, 'typescript', 'package.json'),
        JSON.stringify(testCase.manifest),
        'utf8'
      );
      const capability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources
      });
      expect(capability).toEqual({ status: 'available' });
    }
  }, 'engineering-compiler-sm3-typescript-entry-authority-');
});

test('runtime plan rejects cloned bindings, stale sources, destination tamper, and extra empty directories', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runtimeCapability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapability.status).toBe('available');
    const capabilityPlan = await planSemanticMutationVerificationCapabilities({
      snapshot: {
        ir: {
          inputRevision: `sha256:${'1'.repeat(64)}`,
          semanticRevision: `sha256:${'2'.repeat(64)}`,
          entities: [],
          facts: []
        }
      } as never,
      requirements: [{ kind: 'pass', passId: 'verify' }],
      isolationCapabilityProbe: () => runtimeCapability
    });
    expect(capabilityPlan.status).toBe('runnable');
    const projectRoot = path.join(stagingRoot, 'project');
    const parkedProjectRoot = path.join(stagingRoot, 'project.parked-parent-swap');
    const outsideProjectRoot = path.join(root, 'outside-project-parent-swap');
    const outsideSentinel = path.join(outsideProjectRoot, 'node_modules', 'outside.bin');
    await mkdir(path.join(stagingRoot, '.isolated-process'), { recursive: true });
    await mkdir(path.dirname(outsideSentinel), { recursive: true });
    await writeFile(outsideSentinel, 'outside-must-not-change', 'utf8');
    let swapFenceCalls = 0;
    let projectParked = false;
    let projectAliased = false;
    try {
      await expect(materializeSemanticMutationIsolatedRuntime({
        binding: capabilityPlan,
        commitFence: async () => {
          swapFenceCalls += 1;
          if (swapFenceCalls === 3) {
            await rename(projectRoot, parkedProjectRoot);
            projectParked = true;
            await symlink(outsideProjectRoot, projectRoot, process.platform === 'win32' ? 'junction' : 'dir');
            projectAliased = true;
          }
        },
        stagingWorkspaceRoot: stagingRoot
      })).rejects.toThrow(/aliases|parent changed|reparse entry/u);
    } finally {
      if (projectAliased) await unlink(projectRoot);
      if (projectParked) await rename(parkedProjectRoot, projectRoot);
    }
    expect(await readFile(outsideSentinel, 'utf8')).toBe('outside-must-not-change');

    let fenceCalls = 0;
    const commitFence = async (): Promise<void> => {
      fenceCalls += 1;
    };
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });
    expect(fenceCalls).toBeLessThanOrEqual(20);
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'compiler',
      'compose',
      'templates',
      'template.txt'
    ), 'utf8')).toBe('template');
    const runnerPath = path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    );
    const bootstrapPath = path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH.split('/')
    );
    const loaderPath = path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH.split('/')
    );
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: structuredClone(capabilityPlan),
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('invalid or forged');
    expect(await readFile(runnerPath, 'utf8')).toBe('console.log("runner")');
    expect(await readFile(bootstrapPath, 'utf8')).toContain('bootstrap-entered');
    expect(await readFile(loaderPath, 'utf8')).toContain('await import(new URL(');
    expect(await readFile(loaderPath, 'utf8')).not.toContain('exactTypeScriptEntryUrl');

    const extraDirectory = path.join(stagingRoot, '.isolated-compiler', 'unexpected-empty');
    await mkdir(extraDirectory, { recursive: true });
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination structure is not exact');
    await rm(extraDirectory, { recursive: true, force: true });

    const tamperedBootstrap = new Uint8Array(await readFile(bootstrapPath));
    tamperedBootstrap[0] = tamperedBootstrap[0]! ^ 1;
    await writeFile(bootstrapPath, tamperedBootstrap);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });

    const tamperedLoader = new Uint8Array(await readFile(loaderPath));
    tamperedLoader[0] = tamperedLoader[0]! ^ 1;
    await writeFile(loaderPath, tamperedLoader);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });

    const dependencyFile = path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/'),
      'cache.bin'
    );
    const tamperedDependency = new Uint8Array(await readFile(dependencyFile));
    tamperedDependency[0] = tamperedDependency[0]! ^ 1;
    await writeFile(dependencyFile, tamperedDependency);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });

    const extraDependencyDirectory = path.join(
      stagingRoot,
      ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/'),
      'unexpected-empty'
    );
    await mkdir(extraDependencyDirectory, { recursive: true });
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination structure is not exact');
    await rm(extraDependencyDirectory, { recursive: true, force: true });

    const typeScriptManifestPath = path.join(
      stagingRoot, '.isolated-compiler', 'node_modules', 'typescript', 'package.json'
    );
    const tamperedTypeScriptManifest = new Uint8Array(await readFile(typeScriptManifestPath));
    tamperedTypeScriptManifest[0] = tamperedTypeScriptManifest[0]! ^ 1;
    await writeFile(typeScriptManifestPath, tamperedTypeScriptManifest);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });

    const typeScriptEntryPath = path.join(
      stagingRoot, '.isolated-compiler', 'node_modules', 'typescript', 'index.js'
    );
    const tamperedTypeScriptEntry = new Uint8Array(await readFile(typeScriptEntryPath));
    tamperedTypeScriptEntry[0] = tamperedTypeScriptEntry[0]! ^ 1;
    await writeFile(typeScriptEntryPath, tamperedTypeScriptEntry);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });

    const tamperedRunner = new Uint8Array(await readFile(runnerPath));
    tamperedRunner[0] = tamperedRunner[0]! ^ 1;
    await writeFile(runnerPath, tamperedRunner);
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');

    await writeFile(path.join(runtimeInputSources.composeTemplates, 'template.txt'), 'stale', 'utf8');
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('source changed before materialization');
    expect(new Uint8Array(await readFile(runnerPath))).toEqual(tamperedRunner);
  }, 'engineering-compiler-sm3-runtime-plan-manifest-');
});

test.skipIf(process.platform === 'win32')(
  'runtime plan excludes dependency node_modules bin links and binds ordinary executable modes',
  async () => {
    await withTempWorkspace(async (root) => {
      const stagingRoot = stagingWorkspaceRoot(root);
      const browserSource = path.join(root, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const sources = await createRuntimeInputSources(root, browserSource);
      const binRoot = path.join(sources.dependencyModules, '.bin');
      const targetPath = path.join(sources.dependencyModules, 'tool', 'bin', 'cli.js');
      const targetBytes = 'export const cli = "direct-module-only";\n';
      await Promise.all([
        mkdir(binRoot, { recursive: true }),
        mkdir(path.dirname(targetPath), { recursive: true })
      ]);
      await writeFile(targetPath, targetBytes, 'utf8');
      await chmod(targetPath, 0o755);
      await symlink('../tool/bin/cli.js', path.join(binRoot, 'cli'));

      const capability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      });
      expect(capability).toEqual({ status: 'available' });
      await materializeSemanticMutationIsolatedRuntime({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });

      const destinationModules = path.join(
        stagingRoot,
        ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/')
      );
      await expect(stat(path.join(destinationModules, '.bin'))).rejects.toMatchObject({
        code: 'ENOENT'
      });
      const destinationTarget = path.join(destinationModules, 'tool', 'bin', 'cli.js');
      expect(await readFile(destinationTarget, 'utf8')).toBe(targetBytes);
      expect((await stat(destinationTarget)).mode & 0o777).toBe(0o755);
      for (const { moduleRelativePath } of Object.values(RUNTIME_VERIFICATION_INVOCATION_CONTRACT)) {
        if (moduleRelativePath === null) continue;
        expect(await readFile(
          path.join(destinationModules, ...moduleRelativePath.split('/')),
          'utf8'
        )).toBe(directRuntimeModuleFixture(moduleRelativePath));
      }
      await assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });
      await chmod(destinationTarget, 0o644);
      await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      })).rejects.toThrow('destination structure is not exact');

      const invalidStagingRoot = stagingWorkspaceRoot(root, 'b'.repeat(64));
      const invalidBrowserSource = path.join(root, 'invalid-browser-source');
      await mkdir(invalidStagingRoot, { recursive: true });
      await writeProjectBaseline(invalidStagingRoot);
      const invalidSources = await createRuntimeInputSources(
        path.join(root, 'invalid'),
        invalidBrowserSource
      );
      await symlink(
        'cache.bin',
        path.join(invalidSources.dependencyModules, 'unexpected-link')
      );
      expect(await probeSemanticMutationIsolatedRuntimeCapability(invalidStagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: invalidSources
      })).toEqual({ status: 'unavailable' });
    }, 'engineering-compiler-sm3-package-bin-exclusion-');
  }
);

test('runtime capability requires both exact nonempty direct module entrypoints', async () => {
  for (const [step, relativePath] of Object.entries(
    RUNTIME_VERIFICATION_INVOCATION_CONTRACT
  ).flatMap(([step, { moduleRelativePath }]) =>
    moduleRelativePath === null ? [] : [[step, moduleRelativePath] as const])) {
    await withTempWorkspace(async (root) => {
      const stagingRoot = stagingWorkspaceRoot(root);
      const browserSource = path.join(root, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const sources = await createRuntimeInputSources(root, browserSource);
      const entrypoint = path.join(sources.dependencyModules, ...relativePath.split('/'));

      await rm(entrypoint);
      expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      })).toEqual({ status: 'unavailable' });

      await writeFile(entrypoint, new Uint8Array());
      expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      })).toEqual({ status: 'unavailable' });

      await rm(entrypoint);
      await mkdir(entrypoint);
      expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      })).toEqual({ status: 'unavailable' });

      await rm(entrypoint, { recursive: true });
      if (process.platform !== 'win32') {
        const linkTarget = path.join(root, `${step}-link-target.js`);
        await writeFile(linkTarget, 'export {};\n', 'utf8');
        await symlink(linkTarget, entrypoint);
        expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
          buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
          runtimeInputSources: sources
        })).toEqual({ status: 'unavailable' });
        await rm(entrypoint);
      }

      await writeFile(entrypoint, `export const restored = ${JSON.stringify(step)};\n`, 'utf8');
      expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      })).toEqual({ status: 'available' });
    }, `engineering-compiler-sm3-direct-${step}-`);
  }
});

test('direct runtime module identities remain bound through materialize and launch proof', async () => {
  for (const [step, relativePath] of Object.entries(
    RUNTIME_VERIFICATION_INVOCATION_CONTRACT
  ).flatMap(([step, { moduleRelativePath }]) =>
    moduleRelativePath === null ? [] : [[step, moduleRelativePath] as const])) {
    await withTempWorkspace(async (root) => {
      const stagingRoot = stagingWorkspaceRoot(root);
      const browserSource = path.join(root, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const sources = await createRuntimeInputSources(root, browserSource);
      const entrypoint = path.join(sources.dependencyModules, ...relativePath.split('/'));
      const capability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      });
      expect(capability).toEqual({ status: 'available' });
      await writeFile(entrypoint, `export const replaced = ${JSON.stringify(step)};\n`, 'utf8');
      await expect(materializeSemanticMutationIsolatedRuntime({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      })).rejects.toThrow('runtime source changed before materialization');
    }, `engineering-compiler-sm3-direct-source-${step}-`);

    await withTempWorkspace(async (root) => {
      const stagingRoot = stagingWorkspaceRoot(root);
      const browserSource = path.join(root, 'browser-source');
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
      const sources = await createRuntimeInputSources(root, browserSource);
      const expectedBytes = directRuntimeModuleFixture(relativePath);
      const capability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => new TextEncoder().encode('export {};\n'),
        runtimeInputSources: sources
      });
      expect(capability).toEqual({ status: 'available' });
      await materializeSemanticMutationIsolatedRuntime({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });
      const destination = path.join(
        stagingRoot,
        ...SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT.split('/'),
        ...relativePath.split('/')
      );
      expect(await readFile(destination, 'utf8')).toBe(expectedBytes);
      await assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });

      await rm(destination);
      await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      })).rejects.toThrow('destination structure is not exact');
      await writeFile(destination, expectedBytes, 'utf8');
      await assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      });
      await writeFile(destination, `${expectedBytes}tampered\n`, 'utf8');
      await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
        binding: capability,
        commitFence: async () => undefined,
        stagingWorkspaceRoot: stagingRoot
      })).rejects.toThrow('destination structure is not exact');
    }, `engineering-compiler-sm3-direct-destination-${step}-`);
  }
});

test('isolated staging tree rejects hard links and reparse aliases', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    await mkdir(stagingRoot, { recursive: true });
    const original = path.join(stagingRoot, 'original.txt');
    const hardLink = path.join(stagingRoot, 'hard-link.txt');
    await writeFile(original, 'shared-bytes', 'utf8');
    await link(original, hardLink);

    await expect(assertIsolatedStagingTree(stagingRoot)).rejects.toThrow('hard-linked file');

    await rm(hardLink, { force: true });
    const outside = path.join(root, 'outside');
    const alias = path.join(stagingRoot, 'reparse-alias');
    await mkdir(outside, { recursive: true });
    await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(assertIsolatedStagingTree(stagingRoot)).rejects.toThrow(
      'symbolic link, junction, or reparse point'
    );
  }, 'engineering-compiler-sm3-isolated-staging-links-');
});

test('runtime source snapshot cache reuses capture across staging roots and invalidates changed sources', async () => {
  await withTempWorkspace(async (root) => {
    const stagingA = stagingWorkspaceRoot(root, 'a'.repeat(64));
    const stagingB = stagingWorkspaceRoot(root, 'b'.repeat(64));
    const stagingC = stagingWorkspaceRoot(root, 'c'.repeat(64));
    const stagingD = stagingWorkspaceRoot(root, 'd'.repeat(64));
    await Promise.all([stagingA, stagingB, stagingC, stagingD].map(async (stagingRoot) => {
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
    }));
    const browserSource = path.join(root, 'browser-source');
    const sources = await createRuntimeInputSources(root, browserSource);
    const runnerBytes = new TextEncoder().encode('console.log("snapshot-cache")');
    const probe = async (stagingRoot: string, runnerBundle = runnerBytes) => {
      const result = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
        buildRunnerBundle: async () => runnerBundle.slice(),
        runtimeInputSources: sources
      });
      expect(result.status).toBe('available');
      return result;
    };

    const capabilityA = await probe(stagingA);
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 1, entries: 1, flights: 0, revalidations: 0
    });
    const capabilityB = await probe(stagingB);
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 1, entries: 1, flights: 0, revalidations: 1
    });
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: capabilityA,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingB
    })).rejects.toThrow('different staging workspace');
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityB,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingB
    });

    const templateSource = path.join(sources.composeTemplates, 'template.txt');
    await writeFile(templateSource, 'template-v2-with-new-size', 'utf8');
    const capabilityC = await probe(stagingC);
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 2, entries: 1, flights: 0, revalidations: 2
    });
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityC,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingC
    });
    expect(await readFile(path.join(
      stagingC,
      '.isolated-compiler',
      'platform',
      'compiler',
      'compose',
      'templates',
      'template.txt'
    ), 'utf8')).toBe('template-v2-with-new-size');
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: capabilityA,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingA
    })).rejects.toThrow('source changed before materialization');

    const addedTemplateSource = path.join(sources.composeTemplates, 'added-template.txt');
    await writeFile(addedTemplateSource, 'added-after-snapshot', 'utf8');
    await probe(stagingD);
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 3, entries: 1, flights: 0, revalidations: 3
    });

    const runnerSourceV2 = 'console.log("snapshot-cache-v2")';
    const runnerBytesV2 = new TextEncoder().encode(runnerSourceV2);
    const capabilityD = await probe(stagingD, runnerBytesV2);
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 4, entries: 2, flights: 0, revalidations: 3
    });
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityD,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingD
    });
    expect(await readFile(path.join(
      stagingD,
      '.isolated-compiler',
      'platform',
      'compiler',
      'compose',
      'templates',
      'added-template.txt'
    ), 'utf8')).toBe('added-after-snapshot');
    expect(await readFile(path.join(
      stagingD,
      ...SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH.split('/')
    ), 'utf8')).toBe(runnerSourceV2);
  }, 'engineering-compiler-sm3-runtime-source-snapshot-cache-');
});

test('runtime source snapshot cache single-flights concurrent probes and evicts failed capture', async () => {
  await withTempWorkspace(async (root) => {
    const stagingA = stagingWorkspaceRoot(root, 'd'.repeat(64));
    const stagingB = stagingWorkspaceRoot(root, 'e'.repeat(64));
    await Promise.all([stagingA, stagingB].map(async (stagingRoot) => {
      await mkdir(stagingRoot, { recursive: true });
      await writeProjectBaseline(stagingRoot);
    }));
    const browserSource = path.join(root, 'browser-source');
    const sources = await createRuntimeInputSources(root, browserSource);
    const executable = path.join(
      browserSource,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    );
    await rm(executable, { force: true });
    const options = {
      buildRunnerBundle: async () => new Uint8Array([7, 8, 9]),
      runtimeInputSources: sources
    };
    expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingA, options))
      .toEqual({ status: 'unavailable' });
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 0, entries: 0, flights: 0, revalidations: 0
    });

    await writeFile(executable, 'playwright-executable-restored', 'utf8');
    const [capabilityA, capabilityB] = await Promise.all([
      probeSemanticMutationIsolatedRuntimeCapability(stagingA, options),
      probeSemanticMutationIsolatedRuntimeCapability(stagingB, options)
    ]);
    expect(capabilityA.status).toBe('available');
    expect(capabilityB.status).toBe('available');
    expect(semanticMutationRuntimeSourceSnapshotCacheStatsForTests(sources)).toEqual({
      captures: 1, entries: 1, flights: 0, revalidations: 0
    });

    const telemetry = await Promise.all([stagingA, stagingB].map(async (stagingRoot) => {
      const result = await readSemanticMutationIsolatedPhaseTelemetry(stagingRoot);
      expect(result.status).toBe('valid');
      if (result.status !== 'valid') throw new Error('Snapshot cache telemetry was not readable');
      const events = new Set(result.events.map((event) => `${event.phase}:${event.state}`));
      return {
        captureStarted: events.has('source-snapshot-capture:started'),
        captureCompleted: events.has('source-snapshot-capture:completed'),
        waitStarted: events.has('source-snapshot-single-flight-wait:started'),
        waitCompleted: events.has('source-snapshot-single-flight-wait:completed')
      };
    }));
    for (const phases of telemetry) {
      expect(phases.captureCompleted).toBe(phases.captureStarted);
      expect(phases.waitCompleted).toBe(phases.waitStarted);
    }
    expect(telemetry.filter((phases) => phases.captureStarted)).toHaveLength(1);
    expect(telemetry.filter((phases) => phases.waitStarted)).toHaveLength(1);
    expect(telemetry.filter((phases) => phases.captureStarted && phases.waitStarted))
      .toHaveLength(0);
  }, 'engineering-compiler-sm3-runtime-source-snapshot-flight-');
});

test('isolated runtime capability permits baseline bootstrap but blocks Prisma and linked opaque modules', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(browserSource, { recursive: true });
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    let bundleBuilds = 0;
    const probe = () => probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilds += 1;
        return new Uint8Array([1]);
      },
      runtimeInputSources
    });

    const unclassifiedFailure = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        throw new Error('Z:\\must-not-survive generic runner failure');
      },
      runtimeInputSources
    });
    expect(unclassifiedFailure).toEqual({ status: 'unavailable' });
    expect(semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests(unclassifiedFailure))
      .toBeUndefined();

    const preparationFailure = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        throw legacyWindowsAppContainerExecutionError(
          'preparation',
          undefined,
          undefined,
          'native-helper-build'
        );
      },
      runtimeInputSources
    });
    expect(preparationFailure).toEqual({ status: 'unavailable' });
    expect(Object.keys(preparationFailure)).toEqual(['status']);
    expect(semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests(preparationFailure)).toEqual({
      stage: 'appcontainer-execution',
      appContainer: {
        phase: 'preparation',
        preparationSubstage: 'native-helper-build'
      }
    });
    expect(semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests({ ...preparationFailure }))
      .toBeUndefined();

    expect(await probe()).toEqual({ status: 'available' });
    await mkdir(path.join(stagingRoot, 'source', 'schema'), { recursive: true });
    await writeFile(path.join(stagingRoot, 'source', 'schema', 'db.prisma.template'), 'model A {}', 'utf8');
    const prismaUnavailable = await probe();
    expect(prismaUnavailable).toEqual({ status: 'unavailable' });
    expect(semanticMutationIsolatedRuntimeCapabilityDiagnosticForTests(prismaUnavailable))
      .toBeUndefined();
    await rm(path.join(stagingRoot, 'source', 'schema'), { recursive: true, force: true });
    await mkdir(path.join(stagingRoot, 'source', 'code', 'opaque', 'example'), { recursive: true });
    await writeFile(path.join(stagingRoot, 'source', 'code', 'opaque', 'example', 'module.yaml'), 'name: example', 'utf8');
    expect(await probe()).toEqual({ status: 'unavailable' });
    await rm(path.join(stagingRoot, 'source', 'code', 'opaque'), { recursive: true, force: true });
    expect(await probe()).toEqual({ status: 'available' });
    expect(bundleBuilds).toBe(2);
  }, 'engineering-compiler-sm3-isolated-capability-blockers-');
});

test('production staged Verification proof is neutral, one-shot, and child-source-bound', async () => {
  const source = await readFile(path.join(
    compilerRoot,
    'platform',
    'compiler',
    'verify',
    'staged-verification-proof.ts'
  ), 'utf8');
  expect(source).not.toContain("from '../semantic-mutation/");
  expect(source).not.toContain('run-semantic-mutation-isolated-child');
  expect(source).toContain('const issuedSources = new WeakMap');
  expect(source).toContain('const issuedProofs = new WeakMap');
  expect(source).toContain('source.consumed = true;');
  expect(source).toContain('state.consumed = true;');
  expect(source).toContain('verificationArtifactDigest');
  expect(source).toContain('rawArtifactSetDigest');

  const childSource = await readFile(path.join(
    compilerRoot,
    'platform',
    'compiler',
    'verify',
    'run-semantic-mutation-isolated-child.ts'
  ), 'utf8');
  const childStart = childSource.indexOf(
    'export async function runSemanticMutationIsolatedVerificationChild('
  );
  const child = childSource.slice(childStart);
  expect(child).toMatch(
    /const commitFence = productionInvocation\r?\n      \? createWorkspaceWriteCommitFence\(workspaceRoot, workspaceWriteLease\)/u
  );
  expect(child).toContain('const canIssueProofSource = productionInvocation');
  expect(child).toContain(
    'if (!canIssueProofSource) await assertIsolatedStagingTree(stagingWorkspaceRoot);'
  );
  expect(child).toContain('const stagedVerificationProofSource = await issueStagedVerificationProofSource({');

  const orchestratorSource = await readFile(path.join(
    compilerRoot,
    'platform',
    'orchestrator',
    'semantic-mutation-orchestrator.ts'
  ), 'utf8');
  const productionCallStart = orchestratorSource.indexOf(
    'const artifacts = await runSemanticMutationIsolatedVerificationChild('
  );
  const productionCallEnd = orchestratorSource.indexOf('\n      );', productionCallStart);
  const productionCall = orchestratorSource.slice(productionCallStart, productionCallEnd);
  expect(productionCall).not.toContain('commitFence,');
  expect(orchestratorSource).toContain('const execution = buildSemanticMutationVerificationExecutionRef(report);');
  expect(orchestratorSource).toContain('const binding = stagedVerificationProofBinding(passedExecution, sha256(report));');
  expect(orchestratorSource).toContain('const proof = await issueStagedVerificationProof({');
});
