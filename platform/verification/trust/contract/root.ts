import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V3 = 'sec-trusted-bootstrap-registry-v3' as const;
export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3 = 'platform/shared/ci-trust-root-registry.json' as const;

export type SecTrustedBootstrapRegistryV3 = Readonly<{
  schema: typeof SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V3;
  staticExactPaths: readonly string[];
  staticDirectoryPaths: readonly string[];
  staticPrefixes: readonly string[];
  runtimeEntrypoints: readonly string[];
  reviewedSutEdges: readonly string[];
  reviewedBoundaryEdges: readonly string[];
}>;

export type SecTrustedBootstrapTrustRootV3 = Readonly<{
  schema: 'sec-trusted-bootstrap-trust-root-v3';
  registry: SecTrustedBootstrapRegistryV3;
  causalRuntimePaths: readonly string[];
  paths: readonly string[];
  prefixes: readonly string[];
}>;

export type SecTrustedBootstrapPathMatchV3 = Readonly<{
  kind: 'static-exact' | 'static-directory' | 'static-prefix' | 'causal-runtime';
  rule: string;
}>;

/**
 * Structured projection of the trusted runtime's process and network
 * dispatch boundaries.
 *
 * This is deliberately a dataflow contract rather than a source-text
 * expectation.  The exact-tree TCB compiler supplies the immutable dispatcher
 * identities it observed; this owner supplies the machine vocabulary that
 * describes how those identities cross an Effect boundary.  Consumers must
 * reason over this projection and may not infer authority from a function
 * spelling, argument layout, or source snippet.
 */
export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA_V1 =
  'sec-trusted-bootstrap-dispatcher-projection-v1' as const;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE_V1 =
  'sec-trusted-bootstrap-dispatcher-dataflow-v1' as const;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER_V1 =
  'platform/shared/tcb-trust-root-contract.ts' as const;

export type SecTrustedBootstrapDispatcherKindV1 = 'process' | 'network';

export type SecTrustedBootstrapDispatcherLoaderV1 =
  | 'exec'
  | 'execFile'
  | 'execFileSync'
  | 'execSync'
  | 'fork'
  | 'spawn'
  | 'spawnSync'
  | 'Bun.spawn'
  | 'Bun.spawnSync'
  | 'globalThis.fetch';

export type SecTrustedBootstrapDispatcherBoundaryV1 =
  | 'general-process'
  | 'verification-action'
  | 'hosted-archive-inventory'
  | 'github-api'
  | 'local-actions-runner'
  | 'docs-doctor-index';

export type SecTrustedBootstrapDispatcherDataflowV1 = Readonly<{
  executable:
    | 'process-exec-path'
    | 'fixed-interpreter'
    | 'command-input'
    | 'not-applicable';
  argv:
    | 'normalized-operation'
    | 'fixed-script-input'
    | 'command-and-args'
    | 'url-and-request-init'
    | 'not-applicable';
  cwd: 'repository-root' | 'caller-cwd' | 'none' | 'not-applicable';
  environment: 'explicit-allowlist' | 'provider-bound' | 'caller-bound' | 'not-applicable';
  stdio: 'inherit' | 'captured' | 'piped' | 'provider-bound' | 'not-applicable';
  shell: 'forbidden' | 'not-applicable';
  output: 'bounded' | 'provider-bound' | 'not-captured' | 'not-applicable';
  deadline: 'bounded' | 'provider-bound' | 'not-applicable';
}>;

export type SecTrustedBootstrapDispatcherEvidenceKindV1 =
  | 'exact-tree-dispatcher-census'
  | 'module-graph-closure'
  | 'effect-dataflow'
  | 'content-digest-readback';

export type SecTrustedBootstrapDispatcherAuthorityV1 = Readonly<{
  ownerId: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER_V1;
  principleId: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE_V1;
  machineTargets: readonly [
    'tcb-closure-lock.reviewedProcessDispatchers',
    'tcb-closure-lock.reviewedNetworkDispatchers'
  ];
  evidence: readonly [
    'exact-tree-dispatcher-census',
    'module-graph-closure',
    'effect-dataflow',
    'content-digest-readback'
  ];
}>;

export type SecTrustedBootstrapDispatcherEntryV1 = Readonly<{
  kind: SecTrustedBootstrapDispatcherKindV1;
  identity: string;
  repositoryPath: string;
  ownerChain: string;
  owner: string;
  loader: SecTrustedBootstrapDispatcherLoaderV1;
  ordinal: number;
  boundary: SecTrustedBootstrapDispatcherBoundaryV1;
  dataflow: SecTrustedBootstrapDispatcherDataflowV1;
  authority: SecTrustedBootstrapDispatcherAuthorityV1;
}>;

export type SecTrustedBootstrapNonDispatchingBoundaryV1 = Readonly<{
  boundary: 'worktree-physical-closeout';
  repositoryPath: string;
  owner: string;
  expected: 'no-process-dispatcher';
}>;

export type SecTrustedBootstrapDispatcherProjectionV1 = Readonly<{
  schema: typeof SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA_V1;
  authority: SecTrustedBootstrapDispatcherAuthorityV1;
  process: readonly SecTrustedBootstrapDispatcherEntryV1[];
  network: readonly SecTrustedBootstrapDispatcherEntryV1[];
  nonDispatching: readonly SecTrustedBootstrapNonDispatchingBoundaryV1[];
}>;

export type SecTrustedBootstrapDispatcherCounterexampleDeltaV1 =
  | 'dispatcher-identity'
  | 'module-graph-closure'
  | 'effect-dataflow'
  | 'content-digest-readback';

export type SecTrustedBootstrapDispatcherCounterexampleV1 = Readonly<{
  status: 'counterexample';
  dispatcherIdentity: string;
  owner: SecTrustedBootstrapDispatcherAuthorityV1;
  designDelta: Readonly<{
    kind: SecTrustedBootstrapDispatcherCounterexampleDeltaV1;
    machineTarget: SecTrustedBootstrapDispatcherAuthorityV1['machineTargets'][number];
  }>;
  migrationClosure: Readonly<{
    ownerId: SecTrustedBootstrapDispatcherAuthorityV1['ownerId'];
    machineTargets: SecTrustedBootstrapDispatcherAuthorityV1['machineTargets'];
    evidence: SecTrustedBootstrapDispatcherAuthorityV1['evidence'];
  }>;
}>;

export const SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY_V1: SecTrustedBootstrapDispatcherAuthorityV1 =
  Object.freeze({
    ownerId: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER_V1,
    principleId: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PRINCIPLE_V1,
    machineTargets: Object.freeze([
      'tcb-closure-lock.reviewedProcessDispatchers',
      'tcb-closure-lock.reviewedNetworkDispatchers'
    ]) as SecTrustedBootstrapDispatcherAuthorityV1['machineTargets'],
    evidence: Object.freeze([
      'exact-tree-dispatcher-census',
      'module-graph-closure',
      'effect-dataflow',
      'content-digest-readback'
    ]) as SecTrustedBootstrapDispatcherAuthorityV1['evidence']
  });

const TRUSTED_BOOTSTRAP_DISPATCHER_LOADERS = new Set<SecTrustedBootstrapDispatcherLoaderV1>([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
  'Bun.spawn',
  'Bun.spawnSync',
  'globalThis.fetch'
]);

const TRUSTED_BOOTSTRAP_PROCESS_LOADERS = new Set<SecTrustedBootstrapDispatcherLoaderV1>([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync',
  'Bun.spawn',
  'Bun.spawnSync'
]);

const TRUSTED_BOOTSTRAP_NON_DISPATCHING_BOUNDARIES_V1: readonly SecTrustedBootstrapNonDispatchingBoundaryV1[] =
  Object.freeze([
    Object.freeze({
      boundary: 'worktree-physical-closeout',
      repositoryPath: 'scripts/codex/worktree-physical-closeout.ts',
      owner: 'runRepositoryGit',
      expected: 'no-process-dispatcher'
    })
  ]);

const TRUSTED_BOOTSTRAP_COUNTEREXAMPLE_DELTAS_V1 = new Set<SecTrustedBootstrapDispatcherCounterexampleDeltaV1>([
  'dispatcher-identity',
  'module-graph-closure',
  'effect-dataflow',
  'content-digest-readback'
]);

const REGISTRY_KEYS = [
  'schema',
  'staticExactPaths',
  'staticDirectoryPaths',
  'staticPrefixes',
  'runtimeEntrypoints',
  'reviewedSutEdges',
  'reviewedBoundaryEdges'
] as const;

const REQUIRED_STATIC_EXACT_PATHS = [
  '.bun-version',
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3,
  'platform/shared/tcb-closure-lock.ts',
  'scripts/codex/branch-local-residue-closeout.ts',
  'scripts/codex/branch-lifecycle.ts',
  'scripts/codex/trusted-runtime.Dockerfile'
] as const;

const REQUIRED_REVIEWED_BOUNDARY_EDGES = [] as const;

// These are invariant privileged surfaces, not an import-graph inventory. The
// exact-tree compiler remains the sole owner of the complete derived closure.
const REQUIRED_PRIVILEGED_RUNTIME_SURFACES = [
  'platform/shared/agent-operation-activation-contract.ts',
  'platform/shared/agent-operation-read-plan-contract.ts',
  'platform/shared/agent-skill-contract.ts',
  'platform/shared/agent-task-capsule-contract.ts',
  'platform/shared/ci-evidence-contract.ts',
  'platform/shared/ci-verification-revision.ts',
  'platform/shared/integration-authorization-contract.ts',
  'platform/shared/integration-platform-policy.ts',
  'platform/shared/main-health-contract.ts',
  'platform/shared/review-stability-contract.ts',
  'platform/shared/scope-authorization-contract.ts',
  'platform/semantic/mutation/runtime/staging-boundary.ts',
  'platform/shared/tcb-trust-root-contract.ts',
  'platform/shared/verification-action-ci-contract.ts',
  'platform/shared/verification-action-contract.ts',
  'platform/shared/verification-action-provider-contract.ts',
  'platform/shared/verification-result-contract.ts',
  'platform/shared/verification-session-contract.ts',
  'platform/workspace/state/write-lease.ts',
  'scripts/codex/agent-operation-activation.ts',
  'scripts/codex/branch-closeout-contract.ts',
  'scripts/codex/branch-closeout-receipt.ts',
  'scripts/codex/branch-closeout.ts',
  'scripts/codex/branch-recovery.ts',
  'scripts/codex/integration-authorization-publication.ts',
  'scripts/codex/merge-gate.ts',
  'scripts/codex/operation-read-plan.ts',
  'scripts/codex/skill-applicability.ts',
  'scripts/codex/task-capsule.ts',
  'scripts/codex/trusted-runtime-closeout.ts',
  'scripts/codex/trusted-runtime-container.ts',
  'scripts/codex/verification-action-github-provider.ts',
  'scripts/codex/verification-session-github.ts',
  'scripts/codex/verification-session-runtime.ts',
  'scripts/codex/verification-session.ts',
  'platform/runtime-state/worktree-closeout-contract.ts',
  'scripts/codex/worktree-physical-closeout.ts',
  'scripts/codex/work-selection.ts',
  'tooling/sec-dev/runtime-state-authority.ts',
  'tooling/sec-dev/runtime-state-journal-filesystem.ts',
  'tooling/sec-dev/verification-action-journal.ts',
  'tooling/sec-dev/verification-action-runner.ts'
] as const;

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  const expected = [...REGISTRY_KEYS].sort();
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    throw new Error('Trusted bootstrap registry has unknown or missing fields.');
  }
}

function assertBoundedNfc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0') || value.normalize('NFC') !== value) {
    throw new Error(`${label} must be bounded NFC text without NUL characters.`);
  }
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new Error(`${label} must be strictly code-unit sorted and unique.`);
    }
  }
}

function assertRepositoryPath(value: string, label: string, directory: boolean): void {
  assertBoundedNfc(value, label);
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/u.test(value) || value.includes('//'))
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  if (directory !== value.endsWith('/')) {
    throw new Error(`${label} ${directory ? 'must' : 'must not'} end with '/'.`);
  }
  const comparable = directory ? value.slice(0, -1) : value;
  if (
    comparable.length === 0 ||
    comparable === '.' ||
    comparable === '..' ||
    comparable.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ||
    path.posix.normalize(comparable) !== comparable
  )
    throw new Error(`${label} is not canonical after POSIX normalization.`);
}

function assertPrefix(value: string, label: string): void {
  assertBoundedNfc(value, label);
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes('..')
  )
    throw new Error(`${label} is not a canonical repository prefix.`);
}

const TRUSTED_BOOTSTRAP_DISPATCHER_IDENTITY_PATTERN =
  /^(.+?)::(.+?)::(exec|execFile|execFileSync|execSync|fork|spawn|spawnSync|Bun\.spawn|Bun\.spawnSync|globalThis\.fetch)#([1-9][0-9]*)$/u;

function dispatcherBoundary(
  repositoryPath: string,
  owner: string,
  kind: SecTrustedBootstrapDispatcherKindV1
): SecTrustedBootstrapDispatcherBoundaryV1 {
  if (kind === 'network' || repositoryPath === 'scripts/codex/integration-authorization-status-github.ts') {
    return 'github-api';
  }
  if (
    repositoryPath === 'platform/dev-runner/verification-action-executor.ts' ||
    repositoryPath === 'scripts/codex/verification-action-github-provider.ts' ||
    (repositoryPath === 'scripts/ci-verification.ts' && owner !== 'inspectHostedActionArchiveMetadataV2')
  ) {
    return 'verification-action';
  }
  if (repositoryPath === 'scripts/ci-verification.ts' && owner === 'inspectHostedActionArchiveMetadataV2') {
    return 'hosted-archive-inventory';
  }
  if (repositoryPath === 'scripts/codex/local-github-actions-runner.ts' && owner === 'runCommand') {
    return 'local-actions-runner';
  }
  if (repositoryPath === 'docs/scripts/docs-doctor.ts') {
    return 'docs-doctor-index';
  }
  return 'general-process';
}

function dispatcherDataflow(
  kind: SecTrustedBootstrapDispatcherKindV1,
  boundary: SecTrustedBootstrapDispatcherBoundaryV1,
  loader: SecTrustedBootstrapDispatcherLoaderV1
): SecTrustedBootstrapDispatcherDataflowV1 {
  if (kind === 'network') {
    return Object.freeze({
      executable: 'not-applicable',
      argv: 'url-and-request-init',
      cwd: 'not-applicable',
      environment: 'provider-bound',
      stdio: 'not-applicable',
      shell: 'not-applicable',
      output: 'provider-bound',
      deadline: 'provider-bound'
    });
  }
  if (boundary === 'verification-action' && loader === 'Bun.spawn') {
    return Object.freeze({
      executable: 'process-exec-path',
      argv: 'normalized-operation',
      cwd: 'repository-root',
      environment: 'caller-bound',
      stdio: 'inherit',
      shell: 'forbidden',
      output: 'not-captured',
      deadline: 'provider-bound'
    });
  }
  if (boundary === 'hosted-archive-inventory') {
    return Object.freeze({
      executable: 'fixed-interpreter',
      argv: 'fixed-script-input',
      cwd: 'none',
      environment: 'explicit-allowlist',
      stdio: 'captured',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  if (boundary === 'local-actions-runner') {
    return Object.freeze({
      executable: 'command-input',
      argv: 'command-and-args',
      cwd: 'caller-cwd',
      environment: 'provider-bound',
      stdio: 'piped',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  if (boundary === 'docs-doctor-index') {
    return Object.freeze({
      executable: 'command-input',
      argv: 'command-and-args',
      cwd: 'repository-root',
      environment: 'provider-bound',
      stdio: 'captured',
      shell: 'forbidden',
      output: 'bounded',
      deadline: 'bounded'
    });
  }
  return Object.freeze({
    executable: loader === 'Bun.spawn' || loader === 'Bun.spawnSync'
      ? 'process-exec-path'
      : 'command-input',
    argv: 'command-and-args',
    cwd: 'caller-cwd',
    environment: 'provider-bound',
    stdio: 'provider-bound',
    shell: 'forbidden',
    output: 'provider-bound',
    deadline: 'provider-bound'
  });
}

function projectTrustedBootstrapDispatcherV1(
  kind: SecTrustedBootstrapDispatcherKindV1,
  identity: string
): SecTrustedBootstrapDispatcherEntryV1 {
  assertBoundedNfc(identity, `${kind} dispatcher identity`);
  const match = TRUSTED_BOOTSTRAP_DISPATCHER_IDENTITY_PATTERN.exec(identity);
  if (match === null) {
    throw new Error(`Trusted bootstrap ${kind} dispatcher identity is not canonical: ${identity}.`);
  }
  const repositoryPath = match[1]!;
  const ownerChain = match[2]!;
  const loader = match[3]! as SecTrustedBootstrapDispatcherLoaderV1;
  const ordinal = Number(match[4]!);
  assertRepositoryPath(repositoryPath, `${kind} dispatcher repositoryPath`, false);
  assertBoundedNfc(ownerChain, `${kind} dispatcher ownerChain`);
  if (!TRUSTED_BOOTSTRAP_DISPATCHER_LOADERS.has(loader)) {
    throw new Error(`Trusted bootstrap dispatcher loader is not recognized: ${loader}.`);
  }
  if (kind === 'process' && !TRUSTED_BOOTSTRAP_PROCESS_LOADERS.has(loader)) {
    throw new Error(`Network loader cannot be projected as a process dispatcher: ${loader}.`);
  }
  if (kind === 'network' && loader !== 'globalThis.fetch') {
    throw new Error(`Process loader cannot be projected as a network dispatcher: ${loader}.`);
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 4_096) {
    throw new Error(`Trusted bootstrap dispatcher ordinal is outside the bounded range: ${identity}.`);
  }
  const ownerSegment = ownerChain.slice(ownerChain.lastIndexOf('>') + 1);
  const owner = ownerSegment.replace(/^[^:]+:/u, '');
  assertBoundedNfc(owner, `${kind} dispatcher owner`);
  const boundary = dispatcherBoundary(repositoryPath, owner, kind);
  return Object.freeze({
    kind,
    identity,
    repositoryPath,
    ownerChain,
    owner,
    loader,
    ordinal,
    boundary,
    dataflow: dispatcherDataflow(kind, boundary, loader),
    authority: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY_V1
  });
}

function normalizeDispatcherIdentities(
  values: Iterable<string>,
  kind: SecTrustedBootstrapDispatcherKindV1
): string[] {
  const identities: string[] = [];
  for (const identity of values) {
    if (identities.length >= 4_096) {
      throw new Error(`Trusted bootstrap ${kind} dispatcher projection is too large.`);
    }
    identities.push(identity);
  }
  identities.forEach((identity, index) => assertBoundedNfc(identity, `${kind} dispatchers[${index}]`));
  const sorted = [...identities].sort();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1] === sorted[index]) {
      throw new Error(`Trusted bootstrap ${kind} dispatcher projection contains a duplicate identity.`);
    }
  }
  return sorted;
}

/**
 * Project an exact-tree dispatcher census into the machine structure consumed
 * by contract tests and higher-level trust-root views.  The input is an
 * immutable identity census; this function owns the semantic dataflow
 * vocabulary and rejects malformed, cross-kind, or unbounded identities.
 */
export function projectSecTrustedBootstrapDispatcherDataflowV1(input: Readonly<{
  processDispatchers: Iterable<string>;
  networkDispatchers?: Iterable<string>;
}>): SecTrustedBootstrapDispatcherProjectionV1 {
  const processIdentities = normalizeDispatcherIdentities(input.processDispatchers, 'process');
  const networkIdentities = normalizeDispatcherIdentities(input.networkDispatchers ?? [], 'network');
  const processEntries = processIdentities.map((identity) =>
    projectTrustedBootstrapDispatcherV1('process', identity)
  );
  const networkEntries = networkIdentities.map((identity) =>
    projectTrustedBootstrapDispatcherV1('network', identity)
  );
  const allIdentities = new Set<string>();
  for (const entry of [...processEntries, ...networkEntries]) {
    if (allIdentities.has(entry.identity)) {
      throw new Error(`Trusted bootstrap dispatcher appears in both process and network projections: ${entry.identity}.`);
    }
    allIdentities.add(entry.identity);
  }
  return Object.freeze({
    schema: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA_V1,
    authority: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY_V1,
    process: Object.freeze(processEntries),
    network: Object.freeze(networkEntries),
    nonDispatching: TRUSTED_BOOTSTRAP_NON_DISPATCHING_BOUNDARIES_V1
  });
}

/**
 * Return the canonical owner and migration closure for a dispatcher
 * counterexample.  This is diagnostic reverse projection only: it does not
 * admit an effect, change the TCB allowlist, or create a work-plan decision.
 * Unknown identities remain attached to the same owner but are never inferred
 * from source text or document headings.
 */
export function reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1(input: Readonly<{
  projection: SecTrustedBootstrapDispatcherProjectionV1;
  dispatcherIdentity: string;
  designDelta: SecTrustedBootstrapDispatcherCounterexampleDeltaV1;
}>): SecTrustedBootstrapDispatcherCounterexampleV1 {
  if (input.projection.schema !== SEC_TRUSTED_BOOTSTRAP_DISPATCHER_PROJECTION_SCHEMA_V1) {
    throw new Error('Dispatcher counterexample projection schema is not recognized.');
  }
  assertBoundedNfc(input.dispatcherIdentity, 'dispatcher counterexample identity');
  if (!TRUSTED_BOOTSTRAP_COUNTEREXAMPLE_DELTAS_V1.has(input.designDelta)) {
    throw new Error(`Dispatcher counterexample design delta is not recognized: ${input.designDelta}.`);
  }
  const entry = [...input.projection.process, ...input.projection.network]
    .find((candidate) => candidate.identity === input.dispatcherIdentity);
  const authority = SEC_TRUSTED_BOOTSTRAP_DISPATCHER_AUTHORITY_V1;
  const machineTarget = entry?.kind === 'network'
    ? authority.machineTargets[1]
    : authority.machineTargets[0];
  return Object.freeze({
    status: 'counterexample',
    dispatcherIdentity: input.dispatcherIdentity,
    owner: authority,
    designDelta: Object.freeze({
      kind: input.designDelta,
      machineTarget
    }),
    migrationClosure: Object.freeze({
      ownerId: authority.ownerId,
      machineTargets: authority.machineTargets,
      evidence: authority.evidence
    })
  });
}

function stringArray(
  value: unknown,
  label: string,
  maximum = 4_096,
  allowEmpty = false
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maximum) {
    throw new Error(`${label} must be a ${allowEmpty ? '' : 'non-empty '}bounded array.`);
  }
  const result = value.map((entry, index) => {
    assertBoundedNfc(entry, `${label}[${index}]`);
    return entry;
  });
  assertSortedUnique(result, label);
  return result;
}

function assertNoStaticOverlap(registry: SecTrustedBootstrapRegistryV3): void {
  for (let index = 0; index < registry.staticPrefixes.length; index += 1) {
    const prefix = registry.staticPrefixes[index]!;
    for (const other of registry.staticPrefixes.slice(index + 1)) {
      if (prefix.startsWith(other) || other.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap prefixes overlap: ${prefix} / ${other}.`);
      }
    }
  }
  for (const exact of registry.staticExactPaths) {
    for (const directory of registry.staticDirectoryPaths) {
      if (exact.startsWith(directory)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by ${directory}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (exact.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${exact} is covered by prefix ${prefix}.`);
      }
    }
  }
  for (let index = 0; index < registry.staticDirectoryPaths.length; index += 1) {
    const directory = registry.staticDirectoryPaths[index]!;
    for (const other of registry.staticDirectoryPaths.slice(index + 1)) {
      if (directory.startsWith(other) || other.startsWith(directory)) {
        throw new Error(`Trusted bootstrap directory paths overlap: ${directory} / ${other}.`);
      }
    }
    for (const prefix of registry.staticPrefixes) {
      if (directory.startsWith(prefix)) {
        throw new Error(`Trusted bootstrap static path overlap: ${directory} is covered by prefix ${prefix}.`);
      }
    }
  }
}

function assertRegistrySourceEnvelope(source: string): void {
  if (
    source.length === 0 ||
    source.length > 131_072 ||
    source[0] !== '{' ||
    !source.endsWith('\n') ||
    source.endsWith('\n\n') ||
    source.includes('\r') ||
    source.includes('\0')
  ) {
    throw new Error('Trusted bootstrap registry must be bounded LF JSON with exactly one trailing newline.');
  }
}

function topLevelJsonObjectKeys(source: string): string[] {
  const keys: string[] = [];
  let objectDepth = 0;
  let arrayDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      for (; index < source.length; index += 1) {
        const current = source[index]!;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (current === '\\') {
          escaped = true;
          continue;
        }
        if (current === '"') break;
      }
      if (index >= source.length) {
        throw new Error('Trusted bootstrap registry contains an unterminated JSON string.');
      }
      if (objectDepth === 1 && arrayDepth === 0) {
        let cursor = index + 1;
        while (cursor < source.length && /\s/u.test(source[cursor]!)) cursor += 1;
        if (source[cursor] === ':') {
          keys.push(JSON.parse(source.slice(start, index + 1)) as string);
        }
      }
      continue;
    }
    if (character === '{') objectDepth += 1;
    else if (character === '}') objectDepth -= 1;
    else if (character === '[') arrayDepth += 1;
    else if (character === ']') arrayDepth -= 1;
  }
  return keys;
}

function validateSecTrustedBootstrapRegistryValueV3(value: unknown): SecTrustedBootstrapRegistryV3 {
  assertPlainObject(value, 'trusted bootstrap registry');
  assertExactKeys(value);
  if (value.schema !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V3) {
    throw new Error('Trusted bootstrap registry schema mismatch.');
  }

  const staticExactPaths = stringArray(value.staticExactPaths, 'staticExactPaths');
  const staticDirectoryPaths = stringArray(value.staticDirectoryPaths, 'staticDirectoryPaths');
  const staticPrefixes = stringArray(value.staticPrefixes, 'staticPrefixes', 128);
  const runtimeEntrypoints = stringArray(value.runtimeEntrypoints, 'runtimeEntrypoints');
  const reviewedSutEdges = stringArray(value.reviewedSutEdges, 'reviewedSutEdges');
  const reviewedBoundaryEdges = stringArray(
    value.reviewedBoundaryEdges,
    'reviewedBoundaryEdges',
    4_096,
    true
  );

  staticExactPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticExactPaths[${index}]`, false));
  staticDirectoryPaths.forEach((entry, index) => assertRepositoryPath(entry, `staticDirectoryPaths[${index}]`, true));
  staticPrefixes.forEach((entry, index) => assertPrefix(entry, `staticPrefixes[${index}]`));
  runtimeEntrypoints.forEach((entry, index) => assertRepositoryPath(entry, `runtimeEntrypoints[${index}]`, false));

  const registry: SecTrustedBootstrapRegistryV3 = Object.freeze({
    schema: SEC_TRUSTED_BOOTSTRAP_REGISTRY_SCHEMA_V3,
    staticExactPaths: Object.freeze(staticExactPaths),
    staticDirectoryPaths: Object.freeze(staticDirectoryPaths),
    staticPrefixes: Object.freeze(staticPrefixes),
    runtimeEntrypoints: Object.freeze(runtimeEntrypoints),
    reviewedSutEdges: Object.freeze(reviewedSutEdges),
    reviewedBoundaryEdges: Object.freeze(reviewedBoundaryEdges)
  });

  assertNoStaticOverlap(registry);
  if (registry.staticDirectoryPaths.includes('scripts/codex/')) {
    throw new Error('scripts/codex/ cannot be a directory-level verifier trust root.');
  }
  for (const required of REQUIRED_STATIC_EXACT_PATHS) {
    if (!registry.staticExactPaths.includes(required)) {
      throw new Error(`Trusted bootstrap registry omits required privileged surface ${required}.`);
    }
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedSutEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedSutEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedSutEdges[${index}].to`, false);
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    if (!match) throw new Error(`reviewedBoundaryEdges[${index}] must use canonical 'from -> to' syntax.`);
    assertRepositoryPath(match[1]!, `reviewedBoundaryEdges[${index}].from`, false);
    assertRepositoryPath(match[2]!, `reviewedBoundaryEdges[${index}].to`, false);
    if (!registry.staticExactPaths.includes(match[2]!)) {
      throw new Error(`Reviewed boundary target is not a staticExactPath: ${match[2]}.`);
    }
  }
  for (const required of REQUIRED_REVIEWED_BOUNDARY_EDGES) {
    if (!registry.reviewedBoundaryEdges.includes(required)) {
      throw new Error(`Trusted bootstrap registry omits required privileged boundary ${required}.`);
    }
  }
  return registry;
}

export function parseSecTrustedBootstrapRegistryV3(source: string): SecTrustedBootstrapRegistryV3 {
  assertRegistrySourceEnvelope(source);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Trusted bootstrap registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rawKeys = topLevelJsonObjectKeys(source);
  if (rawKeys.length !== REGISTRY_KEYS.length || new Set(rawKeys).size !== rawKeys.length) {
    throw new Error('Trusted bootstrap registry top-level keys must appear exactly once.');
  }
  return validateSecTrustedBootstrapRegistryValueV3(value);
}

export function loadSecTrustedBootstrapRegistryV3(): SecTrustedBootstrapRegistryV3 {
  const absolutePath = path.join(import.meta.dir, 'ci-trust-root-registry.json');
  return parseSecTrustedBootstrapRegistryV3(readFileSync(absolutePath, 'utf8'));
}

export const SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3 = loadSecTrustedBootstrapRegistryV3();

export function createSecTrustedBootstrapTrustRootV3(
  input: Readonly<{
    registry: SecTrustedBootstrapRegistryV3;
    causalRuntimePaths: readonly string[];
  }>
): SecTrustedBootstrapTrustRootV3 {
  const registry = validateSecTrustedBootstrapRegistryValueV3(input.registry);
  const causalRuntimePaths = stringArray(input.causalRuntimePaths, 'causalRuntimePaths');
  causalRuntimePaths.forEach((entry, index) => assertRepositoryPath(entry, `causalRuntimePaths[${index}]`, false));
  const causal = new Set(causalRuntimePaths);
  for (const staticExactPath of registry.staticExactPaths) {
    if (causal.has(staticExactPath)) {
      throw new Error(`Trusted bootstrap path cannot be both staticExact and causalRuntime: ${staticExactPath}.`);
    }
  }
  for (const required of REQUIRED_PRIVILEGED_RUNTIME_SURFACES) {
    if (!causal.has(required)) {
      throw new Error(`Trusted bootstrap causal closure omits required runtime surface ${required}.`);
    }
  }
  if (causal.has('scripts/codex/repository-audit.ts')) {
    throw new Error('repository-audit.ts cannot enter the causal verifier closure without new physical closure evidence.');
  }
  for (const entrypoint of registry.runtimeEntrypoints) {
    if (!causal.has(entrypoint)) {
      throw new Error(`Runtime entrypoint is absent from causalRuntimePaths: ${entrypoint}.`);
    }
  }
  for (const [index, edge] of registry.reviewedSutEdges.entries()) {
    const source = /^([^ ]+) -> ([^ ]+)$/u.exec(edge)?.[1];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed SUT edge source is outside causalRuntimePaths: ${source ?? index}.`);
    }
  }
  for (const [index, edge] of registry.reviewedBoundaryEdges.entries()) {
    const match = /^([^ ]+) -> ([^ ]+)$/u.exec(edge);
    const source = match?.[1];
    const target = match?.[2];
    if (source === undefined || !causal.has(source)) {
      throw new Error(`Reviewed boundary source is outside causalRuntimePaths: ${source ?? index}.`);
    }
    if (target !== undefined && causal.has(target)) {
      throw new Error(`Reviewed boundary target cannot also be a causalRuntimePath: ${target}.`);
    }
  }
  return Object.freeze({
    schema: 'sec-trusted-bootstrap-trust-root-v3' as const,
    registry,
    causalRuntimePaths: Object.freeze(causalRuntimePaths),
    paths: Object.freeze([...new Set([...registry.staticExactPaths, ...registry.staticDirectoryPaths, ...causalRuntimePaths])].sort()),
    prefixes: registry.staticPrefixes
  });
}

export function matchSecTrustedBootstrapPathV3(
  repositoryPath: string,
  trustRoot: SecTrustedBootstrapTrustRootV3
): SecTrustedBootstrapPathMatchV3 | null {
  assertRepositoryPath(repositoryPath, 'repositoryPath', false);
  const registry = trustRoot.registry;
  if (registry.staticExactPaths.includes(repositoryPath)) {
    return { kind: 'static-exact', rule: repositoryPath };
  }
  const staticDirectory = registry.staticDirectoryPaths.find((entry) => repositoryPath.startsWith(entry));
  if (staticDirectory) return { kind: 'static-directory', rule: staticDirectory };
  const staticPrefix = registry.staticPrefixes.find((entry) => repositoryPath.startsWith(entry));
  if (staticPrefix) return { kind: 'static-prefix', rule: staticPrefix };
  if (trustRoot.causalRuntimePaths.includes(repositoryPath)) {
    return { kind: 'causal-runtime', rule: repositoryPath };
  }
  return null;
}
