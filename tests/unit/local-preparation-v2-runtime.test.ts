import { afterAll, beforeAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isolatedGitReadEnvironment } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { compileRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../src/adapters/repository/source-program-model/test-impact-projection.ts';
import { acquireExactGitTreeWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { resolveSecRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { readLocalVerificationStatusWithTrustedRuntime, verifyWithTrustedRuntime } from '../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { currentDocumentationVerificationBaseline } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { createCiVerificationLocalExecutionEnvironment } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { bindDocumentationVerificationGateInput, CodexDevelopmentBuildVerificationPlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { assertVerificationSessionLocalPreparationV2Current, createVerificationSessionLocalPreparationRequestV2 } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { parseVerificationSessionLocalPreparationRequest, prepareLocalQuickVerificationActionPlan, prepareLocalVerificationIntent } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { buildAffectedTestInventory } from '../../src/adapters/verification/platform/test-impact/affected.ts';
import { issueTestInventoryProjection } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { createRepositoryTestImpactSourceProvider, type CodexDevelopmentTestImpactSourceProvider } from '../../src/adapters/verification/platform/test-impact/runtime/impact.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation, CodexDevelopmentTestImpactTransitionDigest } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { CodedFailure } from '../../src/contracts/failure.ts';
import type { GitHubCandidateObservation } from '../../src/execution/verification/session.ts';

const D = `sha256:${'a'.repeat(64)}` as const;
const BASE = '1'.repeat(40), HEAD = '3'.repeat(40);
let nativeProvider: CodexDevelopmentTestImpactSourceProvider;
let nativeFixtureRoot: string;

beforeAll(() => {
  nativeFixtureRoot = mkdtempSync(path.join(tmpdir(), 'sec-local-v2-native-inputs-'));
  const sources = new Map<string, string>([
    ['tsconfig.json', JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src/**/*.ts', 'crates/**/*.ts'] })],
    ['package.json', '{"name":"native-plan-fixture","private":true}'],
    ['.bun-version', '1.4.4'], ['bun.lock', 'fixture lock'], ['bunfig.toml', ''],
    ['crates/gift-author-kernel/Cargo.toml', '[package]\nname="native-plan-fixture"\nversion="0.1.0"\n'],
    ['crates/gift-author-kernel/Cargo.lock', '# fixture lock\n'],
    ['crates/gift-author-kernel/build.rs', 'fn main() {}\n'],
    ['crates/gift-author-kernel/src/lib.rs', 'pub fn fixture() {}\n'],
    ['crates/gift-author-kernel/src/main.rs', 'fn main() {}\n'],
    ['crates/gift-author-kernel/fixtures/shared-views.module.json', '{}'],
    ['schema/author/first-layer/codec-parameters.json', JSON.stringify({
      schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
      resources: [], externals: [], extensions: []
    })],
    ['schema/source/binding-lock-1.schema.json', '{}'],
    ['src/adapters/compilation/module.json', '{"importGraph":"runtime","externalEntrypoints":[]}'],
    ['src/adapters/compilation/author-kernel.ts', 'export {};\n'],
    ['tools/documentation/codec_parameters.py', '# fixture oracle source\n'],
    ['tools/documentation/source_inventory.py', '# fixture oracle source\n']
  ]);
  for (const name of ['codec', 'complete-base', 'schema', 'developer-surface', 'lexical-boundary']) {
    sources.set(`examples/第一层作者/names-and-roots/${name}-cases.json`, '[]');
  }
  // These source inputs exercise selection and identity. The fixture does not
  // execute a Rust kernel, CLI or oracle program.
  for (const file of [
    'src/contracts/author-native-methods.ts', 'src/contracts/author-kernel-verification.ts',
    'src/bootstrap/cli/cli.ts', 'src/adapters/toolchain/runtime/package-source-launcher.ts',
    'crates/gift-author-kernel/tests/reader-check.ts', 'crates/gift-author-kernel/tests/target-check.ts'
  ]) sources.set(file, 'export {};\n');
  for (const [file, source] of sources) {
    const target = path.join(nativeFixtureRoot, ...file.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: nativeFixtureRoot, encoding: 'utf8', windowsHide: true,
      env: { ...isolatedGitReadEnvironment(), GIT_AUTHOR_NAME: 'SEC Test',
        GIT_AUTHOR_EMAIL: 'sec-test@example.invalid', GIT_COMMITTER_NAME: 'SEC Test',
        GIT_COMMITTER_EMAIL: 'sec-test@example.invalid' } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--quiet', '--initial-branch=main']);
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'Native planning inputs']);
  const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot: nativeFixtureRoot,
    commitSha: git(['rev-parse', 'HEAD']) });
  const compilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot: snapshot,
    repositoryRoot: nativeFixtureRoot });
  nativeProvider = bindDocumentationVerificationGateInput(createRepositoryTestImpactSourceProvider({
    projection: issueTestImpactProjection({ workspaceSnapshot: snapshot, repositoryModel: compilation.model,
      typeScriptModel: compilation.typeScriptCompilation.model, testObservations: compilation.testObservations }),
    testInventory: issueTestInventoryProjection({ snapshot }), activeDocumentationPaths: []
  }), currentDocumentationVerificationBaseline());
}, 180_000);
afterAll(() => {
  if (nativeFixtureRoot !== undefined) rmSync(nativeFixtureRoot, { recursive: true, force: true });
});
function facts() {
  return {
    repository: 'sec-platform/sec',
    candidate: { repository: 'sec-platform/sec', number: 123, baseSha: BASE, baseTreeSha: '2'.repeat(40),
      headSha: HEAD, headTreeSha: '4'.repeat(40), authorNodeId: 'AUTHOR' } as GitHubCandidateObservation,
    manifestPath: 'config/repository/work-packages/local.md', manifestDigest: D,
    changedPaths: ['src/example.ts'], profile: 'full' as const,
    testImpactTransition: CodexDevelopmentCreateTestImpactTransitionObservation({ baseSha: BASE, headSha: HEAD,
      records: [{ status: 'changed', path: 'src/example.ts' }], readPathBlob: () => null }),
    testImpactSourceProvider: nativeProvider, producerPrincipalNodeId: 'MAINTAINER',
    dependencyBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map(p => ({ path: p,
      baseSource: 'fixed dependency fixture', candidateSource: 'fixed dependency fixture' }))
  };
}
function preparation() { return prepareLocalVerificationIntent(facts()); }

test('actual V2 planning owner freezes requirements without constructing health, Session or Action authority', () => {
  const plan = CodexDevelopmentBuildVerificationPlan('full', [], nativeProvider);
  expect(plan.selectionResolved).toBe(true);
  expect(plan.requiredNativeMethods.map(({ id }) => id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
  const prepared = preparation();
  expect(prepared).toEqual(preparation());
  expect(prepared.request.qualificationRequirements.nativeContentManifestDigest).toBeNull();
  expect(prepared.request.qualificationRequirements.trustedRevision).toBe(BASE);
  for (const key of ['health', 'healthy', 'mainHealth', 'expectedSessionRevision', 'expectedActionPlanDigest', 'authorization']) {
    expect(Object.hasOwn(prepared.request, key)).toBe(false);
  }
  expect(parseVerificationSessionLocalPreparationRequest(JSON.stringify(prepared))).toEqual(prepared);
});

test('issued native inventory selects Rust quick methods and keeps the complete target oracle risk-only', () => {
  const native = buildAffectedTestInventory(['crates/gift-author-kernel/src/lib.rs'], nativeProvider);
  expect(native.selectedFastTests).toEqual([]);
  expect(native.selectedNativeMethods.map(({ id }) => id)).toEqual(['cargo-tests', 'reader-check']);
  expect(native.sourceChanged).toBe(true);
  expect(native.selectionResolved).toBe(true);
  expect(native.unresolvedNativeInputs).toEqual([]);

  const target = buildAffectedTestInventory(['crates/gift-author-kernel/tests/target-check.ts'], nativeProvider);
  expect(target.selectedFastTests).toEqual([]);
  expect(target.selectedNativeMethods).toEqual([]);
  expect(target.sourceChanged).toBe(false);
  expect(target.selectionResolved).toBe(true);
  const risk = CodexDevelopmentBuildVerificationPlan('quick', ['crates/gift-author-kernel/tests/target-check.ts'], nativeProvider);
  expect(risk.requiredNativeMethods.map(({ id }) => id)).toEqual(['target-check']);
  expect(risk.gates.filter(({ id }) => id === 'native-target-check')).toHaveLength(1);
});

test('source facts, actor, plan profile and dependency closure cannot drift under a saved V2 request', () => {
  const saved = preparation();
  const original = facts();
  const changedActor = prepareLocalVerificationIntent({ ...original, producerPrincipalNodeId: 'OTHER' });
  expect(() => assertVerificationSessionLocalPreparationV2Current(saved, changedActor)).toThrow();
  const changedDependencies = prepareLocalVerificationIntent({ ...original,
    dependencyBlobs: original.dependencyBlobs.map(v => ({ ...v, baseSource: 'different', candidateSource: 'different' })) });
  expect(() => assertVerificationSessionLocalPreparationV2Current(saved, changedDependencies)).toThrow();
  expect(() => prepareLocalVerificationIntent({ ...original, dependencyBlobs: [] })).toThrow('incomplete');
  expect(() => prepareLocalVerificationIntent({ ...original,
    dependencyBlobs: original.dependencyBlobs.map(v => ({ ...v, candidateSource: 'drift' })) })).toThrow('drifted');
});

test('local quick Action preparation refuses native requirements before constructing an Action', () => {
  const original = facts();
  const changedPaths = ['crates/gift-author-kernel/Cargo.toml'];
  const transition = CodexDevelopmentCreateTestImpactTransitionObservation({ baseSha: BASE, headSha: HEAD,
    records: [{ status: 'changed', path: changedPaths[0]! }], readPathBlob: () => null });
  const plan = CodexDevelopmentBuildVerificationPlan('quick', changedPaths, nativeProvider, transition);
  expect(plan.selectionResolved).toBe(true);
  expect(plan.requiredNativeMethods.filter(({ phase }) => phase === 'quick').map(({ id }) => id))
    .toEqual(['cargo-tests', 'reader-check']);
  let action: ReturnType<typeof prepareLocalQuickVerificationActionPlan> | undefined;
  let failure: unknown;
  try {
    action = prepareLocalQuickVerificationActionPlan({ candidate: original.candidate,
      manifestPath: original.manifestPath, manifestDigest: original.manifestDigest,
      changedPaths, testImpactTransition: transition, testImpactSourceProvider: nativeProvider,
      expectedTestImpactTransitionDigest: CodexDevelopmentTestImpactTransitionDigest(transition), scopeAuthorizationRevision: D,
      executionEnvironment: createCiVerificationLocalExecutionEnvironment({ os: process.platform,
        arch: process.arch, bunVersion: Bun.version }), dependencyBlobs: original.dependencyBlobs });
  } catch (error) {
    failure = error;
  }
  expect(action).toBeUndefined();
  expect(failure).toBeInstanceOf(CodedFailure);
  expect((failure as CodedFailure).details).toMatchObject({ kind: 'missing-native-environment',
    reason: 'native-runtime-qualification-unavailable', requiredMethods: ['cargo-tests', 'reader-check'] });
});

function stateFixture(operation: (input: { root: string; state: string; cache: string; records: string }) => void) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-local-v2-'));
  const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
  mkdirSync(root);
  const oldState = process.env.SEC_STATE_HOME, oldCache = process.env.SEC_CACHE_HOME;
  process.env.SEC_STATE_HOME = state; process.env.SEC_CACHE_HOME = cache;
  try {
    const layout = resolveSecRuntimeStateForRepository({ repositoryRoot: root, repository: 'sec-platform/sec' });
    operation({ root, state, cache, records: path.join(layout.repositoryStateRoot, 'trusted-runtime',
      'local-preparation-v2', preparation().request.requestOperationId.slice(7)) });
  } finally {
    if (oldState === undefined) delete process.env.SEC_STATE_HOME; else process.env.SEC_STATE_HOME = oldState;
    if (oldCache === undefined) delete process.env.SEC_CACHE_HOME; else process.env.SEC_CACHE_HOME = oldCache;
    rmSync(parent, { recursive: true, force: true });
  }
}

test('V2 read-only status has no invented Session and creates no runtime roots', () => {
  stateFixture(({ root, state, cache }) => {
    const status = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(status).toMatchObject({ status: 'LOCAL_REQUEST_OBSERVED', stage: 'read-only-projection',
      sessionRevision: null, verificationStatus: 'not-observed', preparationInputMatched: false,
      sourceQualification: 'not-revalidated', executionStarted: false });
    expect(existsSync(state)).toBe(false); expect(existsSync(cache)).toBe(false);
  });
});

test('copied preparation input alone never revives live qualification or creates a Session', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(preparation())}\n`);
    const status = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(status).toMatchObject({ preparationInputMatched: true, sessionRevision: null,
      evidenceRecord: 'not-observed', sourceQualification: 'not-revalidated', integrationAuthorization: 'not-evaluated' });
  });
});

test('V2 status rejects absent or different original preparation before accepting prior computation', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'verification-action.json'), '{}');
    const read = () => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(read).toThrow('no exact stored preparation');
    const { requestDigest: _digest, requestOperationId: _operation, ...body } = preparation().request;
    const other = createVerificationSessionLocalPreparationRequestV2({ ...body, actorNodeId: 'OTHER' });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(other)}\n`);
    expect(read).toThrow();
  });
});

test('V2 repository mismatch is rejected before execution provider discovery', async () => {
  await expect(verifyWithTrustedRuntime({ repositoryRoot: '/does-not-exist',
    repository: 'other/repo', request: preparation() })).rejects.toThrow('another repository');
});

test('V2 attempt-only residue cannot be adopted by recreating a missing preparation input', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'source-program-attempt-historical.json'), '{}');
    expect(() => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() })).toThrow('no exact stored preparation');
  });
});

test('public local decoder enforces byte and depth limits before version-specific decoding', () => {
  expect(() => parseVerificationSessionLocalPreparationRequest(' '.repeat(1024 * 1024) + '{'))
    .toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequest('雪'.repeat(400_000)))
    .toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequest('{"a":{"b":{"c":{"d":{"e":1}}}}}'))
    .toThrow('depth');
  const v2 = JSON.stringify(preparation());
  expect(() => parseVerificationSessionLocalPreparationRequest(v2.replace('{', '{"schema":"duplicate",')))
    .toThrow('duplicate');
});
