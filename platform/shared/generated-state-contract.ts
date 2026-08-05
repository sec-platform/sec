import { createHash } from 'node:crypto';

export const GENERATED_STATE_REGISTRY_REVISION = 'sec-generated-state-registry-v1' as const;
export const GENERATED_STATE_OWNER_SCHEMA = 'sec-generated-state-owner-v1' as const;
export const GENERATED_STATE_INVENTORY_SCHEMA = 'sec-generated-state-inventory-v1' as const;
export const GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA = 'sec-generated-state-cleanup-receipt-v1' as const;
export const GENERATED_STATE_TRANSACTION_SCHEMA = 'sec-generated-state-cleanup-transaction-v1' as const;

export const GENERATED_STATE_LEGACY_WORKSPACE_GRACE_MS = 30 * 60 * 1000;
export const GENERATED_STATE_DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type GeneratedStateClass =
  | 'rebuildable-cache'
  | 'derived-toolchain'
  | 'ephemeral-workspace'
  | 'diagnostic'
  | 'recovery-asset'
  | 'identity-bound-control'
  | 'unknown';

export type GeneratedStateStatus =
  | 'active'
  | 'rebuildable'
  | 'retained'
  | 'expired-diagnostic'
  | 'orphaned'
  | 'legacy-unowned'
  | 'legacy-expired'
  | 'invalid-location'
  | 'control-state'
  | 'cleanup-residue'
  | 'unsafe-entry'
  | 'unknown';

export type GeneratedStateCleanupProfile = 'automatic' | 'safe' | 'all-rebuildable';
export type GeneratedStateCleanupStatus = 'completed' | 'residue' | 'blocked' | 'no-op';
export type GeneratedStatePathKind = 'file' | 'directory' | 'symlink' | 'other' | 'missing';
export type GeneratedStateReconstruction =
  | 'producer-recompute'
  | 'fixture-rebuild'
  | 'rerun-diagnostic'
  | 'owner-recovery-only'
  | 'external-recovery-required'
  | 'none';

export type GeneratedStateRule = Readonly<{
  id: string;
  owner: string;
  stateClass: Exclude<GeneratedStateClass, 'unknown'>;
  match: Readonly<
    | { kind: 'exact'; value: string }
    | { kind: 'prefix'; value: string }
    | { kind: 'pattern'; value: RegExp }
  >;
  reconstruction: GeneratedStateReconstruction;
  cleanup: readonly GeneratedStateCleanupProfile[];
  settlement: 'allowed' | 'block';
}>;

const ROOT_DIAGNOSTIC_PATTERN = /^(?:fence-(?:coverage|policy|report|runtime)(?:-after)?\.json|tree\.txt)$/u;
const TEST_IMPACT_CACHE_STAGING_PATTERN = /^test-impact-cache\.json\.\d+\.tmp$/u;
const TEMPLATE_LOCK_PATTERN = /^test-workspaces\/\.templates\/[^/]+\.lock(?:\/.*)?$/u;
const TEMPLATE_STAGING_PATTERN = /^test-workspaces\/\.templates\/[^/]+\.staging-[^/]+(?:\/.*)?$/u;
const CI_WORKSPACE_FAST_PATTERN = /^ci-workspace-fast-[^/]+(?:\/.*)?$/u;
const HEAVY_GATE_PATTERN = /^heavy-verification-gate-v1(?:\/.*|\.(?:candidate|reclaim|release)-[^/]+(?:\/.*)?)?$/u;
const WORK_PACKAGE_GATE_RUN_LEGACY_PATTERN = /^sm3-r3(?:-v[23])?-work-package-gate(?:\/.*)?$/u;
const WORK_PACKAGE_GATE_TEST_FIXTURE_PATTERN = /^work-package-gate-[^/]+(?:\/.*)?$/u;
const SYNTHETIC_GATE_CONTRACT_PATTERN = /^synthetic-gate-contract-[^/]+(?:\/.*)?$/u;
const SYNTHETIC_TEST_STATE_PATTERN = /^synthetic-[^/]+(?:\/.*)?$/u;
const VERIFICATION_EVIDENCE_STAGING_PATTERN = /^ci-verification-evidence\.json\.\d+\.[0-9a-f-]+\.tmp$/u;
const RISK_BATCH_EVIDENCE_STAGING_PATTERN = /^ci-risk-batch-evidence\.json\.\d+\.[0-9a-f-]+\.tmp$/u;

/**
 * Ordered, closed lifecycle registry for repository-root `.tmp` state.
 * First match wins. Narrow control/staging rules must precede broader cache or
 * workspace rules. Unknown is never inferred from a filename such as "tmp".
 */
export const GENERATED_STATE_RULES: readonly GeneratedStateRule[] = Object.freeze([
  {
    id: 'cleanup-transactions',
    owner: 'generated-state-lifecycle',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: '.generated-state-transactions' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'cleanup-lock',
    owner: 'generated-state-lifecycle',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: '.generated-state-cleanup-lock' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'work-package-gate-publication',
    owner: 'work-package-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: '.gate-checkpoint-publications' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'work-package-gate-snapshot',
    owner: 'work-package-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: 'gate-execution-snapshots' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'work-package-gate-run-v4',
    owner: 'work-package-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: 'sm3-r3-v4-work-package-gate' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'work-package-gate-run-r2',
    owner: 'work-package-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: 'sm3-r2-work-package-gate' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'work-package-gate-run-legacy',
    owner: 'work-package-gate',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: WORK_PACKAGE_GATE_RUN_LEGACY_PATTERN },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'heavy-verification-gate-lease',
    owner: 'heavy-verification-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'pattern', value: HEAVY_GATE_PATTERN },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'test-gate-supervisor-lease',
    owner: 'work-package-gate',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: 'test-workspaces/.gate-supervisor-leases' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'test-template-lock',
    owner: 'test-runtime-fixtures',
    stateClass: 'identity-bound-control',
    match: { kind: 'pattern', value: TEMPLATE_LOCK_PATTERN },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'test-template-staging',
    owner: 'test-runtime-fixtures',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: TEMPLATE_STAGING_PATTERN },
    reconstruction: 'fixture-rebuild',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'test-workspace-template',
    owner: 'test-runtime-fixtures',
    stateClass: 'rebuildable-cache',
    match: { kind: 'prefix', value: 'test-workspaces/.templates' },
    reconstruction: 'fixture-rebuild',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'playwright-transform-cache',
    owner: 'playwright-provider',
    stateClass: 'rebuildable-cache',
    match: { kind: 'prefix', value: 'test-workspaces/playwright-transform-cache' },
    reconstruction: 'producer-recompute',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'legacy-test-cleanup-marker',
    owner: 'generated-state-lifecycle',
    stateClass: 'diagnostic',
    match: { kind: 'exact', value: 'test-workspaces/.last-cleanup' },
    reconstruction: 'none',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'legacy-test-cleanup-lock',
    owner: 'generated-state-lifecycle',
    stateClass: 'identity-bound-control',
    match: { kind: 'prefix', value: 'test-workspaces/.cleanup-lock' },
    reconstruction: 'owner-recovery-only',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'test-workspace-run',
    owner: 'test-runtime-fixtures',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'prefix', value: 'test-workspaces' },
    reconstruction: 'fixture-rebuild',
    cleanup: ['automatic', 'safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'import-candidate-snapshot',
    owner: 'import-organizer',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'prefix', value: 'import-candidate-snapshots' },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'codex-merge-gate-scratch',
    owner: 'codex-merge-gate',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'prefix', value: 'codex' },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'runtime-authority-fixtures',
    owner: 'runtime-authority-tests',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'prefix', value: 'runtime-authority-fixtures' },
    reconstruction: 'fixture-rebuild',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'work-package-gate-test-fixture',
    owner: 'work-package-gate-tests',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: WORK_PACKAGE_GATE_TEST_FIXTURE_PATTERN },
    reconstruction: 'fixture-rebuild',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'gate-test-workspace',
    owner: 'work-package-gate-tests',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'prefix', value: 'workspace' },
    reconstruction: 'fixture-rebuild',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'synthetic-gate-contract',
    owner: 'work-package-gate-tests',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: SYNTHETIC_GATE_CONTRACT_PATTERN },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'synthetic-test-state',
    owner: 'work-package-gate-tests',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: SYNTHETIC_TEST_STATE_PATTERN },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'ci-workspace-fast',
    owner: 'ci-workspace-fast',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: CI_WORKSPACE_FAST_PATTERN },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'compiler-dependency-install-state',
    owner: 'compiler-dependency-runtime',
    stateClass: 'derived-toolchain',
    match: { kind: 'prefix', value: 'dependency-installs' },
    reconstruction: 'producer-recompute',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'typecheck-incremental-cache',
    owner: 'typescript-toolchain',
    stateClass: 'rebuildable-cache',
    match: { kind: 'prefix', value: 'typecheck' },
    reconstruction: 'producer-recompute',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'branch-recovery-invalid-location',
    owner: 'branch-ref-lifecycle',
    stateClass: 'recovery-asset',
    match: { kind: 'prefix', value: 'recovery' },
    reconstruction: 'external-recovery-required',
    cleanup: [],
    settlement: 'block'
  },
  {
    id: 'compiler-dependency-stamp',
    owner: 'compiler-dependency-runtime',
    stateClass: 'rebuildable-cache',
    match: { kind: 'exact', value: 'compiler-deps.stamp.json' },
    reconstruction: 'producer-recompute',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'test-impact-cache-staging',
    owner: 'affected-test-selection',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: TEST_IMPACT_CACHE_STAGING_PATTERN },
    reconstruction: 'producer-recompute',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'test-impact-cache',
    owner: 'affected-test-selection',
    stateClass: 'rebuildable-cache',
    match: { kind: 'exact', value: 'test-impact-cache.json' },
    reconstruction: 'producer-recompute',
    cleanup: ['all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'root-diagnostic-snapshot',
    owner: 'local-diagnostic-producer',
    stateClass: 'diagnostic',
    match: { kind: 'pattern', value: ROOT_DIAGNOSTIC_PATTERN },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'ci-verification-evidence',
    owner: 'verification-evidence-producers',
    stateClass: 'diagnostic',
    match: { kind: 'exact', value: 'ci-verification-evidence.json' },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'ci-verification-evidence-staging',
    owner: 'verification-evidence-producers',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: VERIFICATION_EVIDENCE_STAGING_PATTERN },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'ci-risk-batch-evidence',
    owner: 'verification-evidence-producers',
    stateClass: 'diagnostic',
    match: { kind: 'exact', value: 'ci-risk-batch-evidence.json' },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'ci-risk-batch-evidence-staging',
    owner: 'verification-evidence-producers',
    stateClass: 'ephemeral-workspace',
    match: { kind: 'pattern', value: RISK_BATCH_EVIDENCE_STAGING_PATTERN },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  },
  {
    id: 'runtime-source-phase-attribution',
    owner: 'semantic-mutation-runtime-tests',
    stateClass: 'diagnostic',
    match: { kind: 'exact', value: 'runtime-browser-cache-v10-phase-attribution.json' },
    reconstruction: 'rerun-diagnostic',
    cleanup: ['safe', 'all-rebuildable'],
    settlement: 'allowed'
  }
]);

export const KNOWN_GENERATED_STATE_PRODUCERS = Object.freeze([
  Object.freeze({ relativePath: '.generated-state-transactions/tx/transaction.json', ruleId: 'cleanup-transactions' }),
  Object.freeze({ relativePath: '.generated-state-cleanup-lock/owner.json', ruleId: 'cleanup-lock' }),
  Object.freeze({ relativePath: '.gate-checkpoint-publications/example.pending/checkpoint.json', ruleId: 'work-package-gate-publication' }),
  Object.freeze({ relativePath: 'gate-execution-snapshots/example/HEAD', ruleId: 'work-package-gate-snapshot' }),
  Object.freeze({ relativePath: 'heavy-verification-gate-v1/owner.json', ruleId: 'heavy-verification-gate-lease' }),
  Object.freeze({ relativePath: 'test-workspaces/.gate-supervisor-leases/example.lock/owner.json', ruleId: 'test-gate-supervisor-lease' }),
  Object.freeze({ relativePath: 'test-workspaces/.templates/locked-default.lock/owner.json', ruleId: 'test-template-lock' }),
  Object.freeze({ relativePath: 'test-workspaces/.templates/locked-default.staging-123/project/package.json', ruleId: 'test-template-staging' }),
  Object.freeze({ relativePath: 'test-workspaces/.templates/locked-default/.template-ready', ruleId: 'test-workspace-template' }),
  Object.freeze({ relativePath: 'test-workspaces/playwright-transform-cache/aa/cache.js', ruleId: 'playwright-transform-cache' }),
  Object.freeze({ relativePath: 'test-workspaces/.last-cleanup', ruleId: 'legacy-test-cleanup-marker' }),
  Object.freeze({ relativePath: 'test-workspaces/.cleanup-lock/owner.json', ruleId: 'legacy-test-cleanup-lock' }),
  Object.freeze({ relativePath: 'test-workspaces/fast-1/project/package.json', ruleId: 'test-workspace-run' }),
  Object.freeze({ relativePath: 'import-candidate-snapshots/example/package.json', ruleId: 'import-candidate-snapshot' }),
  Object.freeze({ relativePath: 'ci-workspace-fast-example/project/package.json', ruleId: 'ci-workspace-fast' }),
  Object.freeze({ relativePath: 'dependency-installs/compiler-backups/example', ruleId: 'compiler-dependency-install-state' }),
  Object.freeze({ relativePath: 'typecheck/tsconfig.tsbuildinfo', ruleId: 'typecheck-incremental-cache' }),
  Object.freeze({ relativePath: 'recovery/branch.bundle', ruleId: 'branch-recovery-invalid-location' }),
  Object.freeze({ relativePath: 'compiler-deps.stamp.json', ruleId: 'compiler-dependency-stamp' }),
  Object.freeze({ relativePath: 'test-impact-cache.json.123.tmp', ruleId: 'test-impact-cache-staging' }),
  Object.freeze({ relativePath: 'test-impact-cache.json', ruleId: 'test-impact-cache' }),
  Object.freeze({ relativePath: 'fence-policy-after.json', ruleId: 'root-diagnostic-snapshot' }),
  Object.freeze({ relativePath: 'tree.txt', ruleId: 'root-diagnostic-snapshot' }),
  Object.freeze({ relativePath: 'ci-verification-evidence.json', ruleId: 'ci-verification-evidence' }),
  Object.freeze({
    relativePath: 'ci-verification-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp',
    ruleId: 'ci-verification-evidence-staging'
  }),
  Object.freeze({ relativePath: 'ci-risk-batch-evidence.json', ruleId: 'ci-risk-batch-evidence' }),
  Object.freeze({
    relativePath: 'ci-risk-batch-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp',
    ruleId: 'ci-risk-batch-evidence-staging'
  }),
  Object.freeze({ relativePath: 'codex/codex-development-scope-attestation-v1.json', ruleId: 'codex-merge-gate-scratch' }),
  Object.freeze({ relativePath: 'codex/merge-gate-input.json', ruleId: 'codex-merge-gate-scratch' }),
  Object.freeze({ relativePath: 'codex/candidate/.git/HEAD', ruleId: 'codex-merge-gate-scratch' }),
  Object.freeze({ relativePath: 'codex/legacy/.git/HEAD', ruleId: 'codex-merge-gate-scratch' }),
  Object.freeze({ relativePath: 'sm3-r2-work-package-gate/evidence.json', ruleId: 'work-package-gate-run-r2' }),
  Object.freeze({ relativePath: 'sm3-r3-work-package-gate/state.json', ruleId: 'work-package-gate-run-legacy' }),
  Object.freeze({ relativePath: 'sm3-r3-v2-work-package-gate/state.json', ruleId: 'work-package-gate-run-legacy' }),
  Object.freeze({ relativePath: 'sm3-r3-v3-work-package-gate/state.json', ruleId: 'work-package-gate-run-legacy' }),
  Object.freeze({ relativePath: 'sm3-r3-v4-work-package-gate/state.json', ruleId: 'work-package-gate-run-v4' }),
  Object.freeze({ relativePath: 'runtime-authority-fixtures/node.exe', ruleId: 'runtime-authority-fixtures' }),
  Object.freeze({ relativePath: 'work-package-gate-protected-ledger-fixture/custody.txt', ruleId: 'work-package-gate-test-fixture' }),
  Object.freeze({ relativePath: 'work-package-gate-directory-snapshot-abc/state.json', ruleId: 'work-package-gate-test-fixture' }),
  Object.freeze({ relativePath: 'work-package-gate-raw-text-abc/state.json', ruleId: 'work-package-gate-test-fixture' }),
  Object.freeze({ relativePath: 'synthetic-gate-contract-123.json', ruleId: 'synthetic-gate-contract' }),
  Object.freeze({ relativePath: 'synthetic-owner-census-abc/state.json', ruleId: 'synthetic-test-state' }),
  Object.freeze({ relativePath: 'synthetic-lease-census-abc/state.json', ruleId: 'synthetic-test-state' }),
  Object.freeze({ relativePath: 'synthetic-lease-recovery-abc/state.json', ruleId: 'synthetic-test-state' }),
  Object.freeze({ relativePath: 'synthetic-p0-protected-record.json', ruleId: 'synthetic-test-state' }),
  Object.freeze({ relativePath: 'synthetic-new-protected-record.json', ruleId: 'synthetic-test-state' }),
  Object.freeze({ relativePath: 'workspace/.sec/semantic-mutation/v1/transactions/example', ruleId: 'gate-test-workspace' }),
  Object.freeze({ relativePath: 'runtime-browser-cache-v10-phase-attribution.json', ruleId: 'runtime-source-phase-attribution' })
] as const);

export const KNOWN_GENERATED_STATE_PRODUCER_PATHS = Object.freeze(
  KNOWN_GENERATED_STATE_PRODUCERS.map((producer) => producer.relativePath)
);

export type GeneratedStateClassification = Readonly<{
  ruleId: string | null;
  owner: string | null;
  stateClass: GeneratedStateClass;
  reconstruction: GeneratedStateReconstruction;
  cleanup: readonly GeneratedStateCleanupProfile[];
  settlement: 'allowed' | 'block';
}>;

export type GeneratedStateOwner = Readonly<{
  schema: typeof GENERATED_STATE_OWNER_SCHEMA;
  repositoryRoot: string;
  namespace: string;
  host: string;
  pid: number;
  token: string;
  createdAt: string;
}>;

export type GeneratedStateOwnerResolution = Readonly<{
  state: 'active' | 'dead' | 'cross-host' | 'invalid' | 'absent';
  owners: readonly GeneratedStateOwner[];
  invalidFiles: readonly string[];
}>;

export type GeneratedStateInventoryEntry = Readonly<{
  relativePath: string;
  absolutePath: string;
  kind: GeneratedStatePathKind;
  ruleId: string | null;
  owner: string | null;
  stateClass: GeneratedStateClass;
  reconstruction: GeneratedStateReconstruction;
  cleanupProfiles: readonly GeneratedStateCleanupProfile[];
  status: GeneratedStateStatus;
  settlement: 'allowed' | 'block';
  modifiedAt: string | null;
  size: Readonly<{
    files: number | null;
    directories: number | null;
    bytes: number | null;
  }>;
  ownerResolution: GeneratedStateOwnerResolution | null;
  diagnostics: readonly string[];
}>;

export type GeneratedStateInventory = Readonly<{
  schema: typeof GENERATED_STATE_INVENTORY_SCHEMA;
  registryRevision: typeof GENERATED_STATE_REGISTRY_REVISION;
  repositoryRoot: string;
  generatedRoot: string;
  observedAt: string;
  entries: readonly GeneratedStateInventoryEntry[];
  blockers: readonly string[];
  digest: `sha256:${string}`;
}>;

export type GeneratedStateCleanupAttempt = Readonly<{
  relativePath: string;
  action: 'planned' | 'quarantined' | 'deleted' | 'protected' | 'failed' | 'recovered';
  attempt: number;
  code: string | null;
  message: string | null;
}>;

export type GeneratedStateCleanupReceipt = Readonly<{
  schema: typeof GENERATED_STATE_CLEANUP_RECEIPT_SCHEMA;
  registryRevision: typeof GENERATED_STATE_REGISTRY_REVISION;
  repositoryRoot: string;
  generatedRoot: string;
  transactionId: string;
  requestedProfile: GeneratedStateCleanupProfile;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
  beforeDigest: `sha256:${string}`;
  afterDigest: `sha256:${string}`;
  beforeBlockers: readonly string[];
  afterBlockers: readonly string[];
  selected: readonly string[];
  protected: readonly string[];
  attempts: readonly GeneratedStateCleanupAttempt[];
  status: GeneratedStateCleanupStatus;
  digest: `sha256:${string}`;
}>;

export type GeneratedStateCleanupTransactionItem = Readonly<{
  relativePath: string;
  sourcePath: string;
  quarantinePath: string;
  expectedIdentity: Readonly<{
    dev: string;
    ino: string;
    mode: string;
    mtimeMs: number;
    size: number;
  }>;
  physicalSnapshotDigest: `sha256:${string}`;
}>;

export type GeneratedStateCleanupTransaction = Readonly<{
  schema: typeof GENERATED_STATE_TRANSACTION_SCHEMA;
  transactionId: string;
  repositoryRoot: string;
  generatedRoot: string;
  profile: GeneratedStateCleanupProfile;
  createdAt: string;
  owner: GeneratedStateOwner;
  items: readonly GeneratedStateCleanupTransactionItem[];
}>;

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || normalized.includes('//')
    || normalized.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    || /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return null;
  return normalized;
}

function ruleMatches(rule: GeneratedStateRule, relativePath: string): boolean {
  switch (rule.match.kind) {
    case 'exact':
      return relativePath === rule.match.value;
    case 'prefix': {
      const prefix = rule.match.value.replace(/\/+$/u, '');
      return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
    }
    case 'pattern':
      rule.match.value.lastIndex = 0;
      return rule.match.value.test(relativePath);
  }
}

export function classifyGeneratedStatePath(value: string): GeneratedStateClassification {
  const relativePath = normalizeRelativePath(value);
  if (relativePath === null) {
    return Object.freeze({
      ruleId: null,
      owner: null,
      stateClass: 'unknown',
      reconstruction: 'none',
      cleanup: Object.freeze([]),
      settlement: 'block'
    });
  }
  const rule = GENERATED_STATE_RULES.find((candidate) => ruleMatches(candidate, relativePath));
  if (!rule) {
    return Object.freeze({
      ruleId: null,
      owner: null,
      stateClass: 'unknown',
      reconstruction: 'none',
      cleanup: Object.freeze([]),
      settlement: 'block'
    });
  }
  return Object.freeze({
    ruleId: rule.id,
    owner: rule.owner,
    stateClass: rule.stateClass,
    reconstruction: rule.reconstruction,
    cleanup: rule.cleanup,
    settlement: rule.settlement
  });
}

export function assertGeneratedStateRegistry(): void {
  const ids = new Set<string>();
  for (const [index, rule] of GENERATED_STATE_RULES.entries()) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(rule.id)) {
      throw new Error(`Generated-state rule ${index} has an invalid id.`);
    }
    if (ids.has(rule.id)) throw new Error(`Generated-state registry contains duplicate id ${rule.id}.`);
    ids.add(rule.id);
    if (rule.match.kind !== 'pattern' && normalizeRelativePath(rule.match.value) === null) {
      throw new Error(`Generated-state rule ${rule.id} has an invalid path.`);
    }
    if (new Set(rule.cleanup).size !== rule.cleanup.length) {
      throw new Error(`Generated-state rule ${rule.id} contains duplicate cleanup profiles.`);
    }
  }
  for (const producer of KNOWN_GENERATED_STATE_PRODUCERS) {
    const classification = classifyGeneratedStatePath(producer.relativePath);
    if (classification.ruleId !== producer.ruleId) {
      throw new Error(
        `Known generated-state producer ${producer.relativePath} resolved to `
        + `${classification.ruleId ?? 'unknown'} instead of ${producer.ruleId}.`
      );
    }
  }
}

export function isGeneratedStateOwner(value: unknown): value is GeneratedStateOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return owner.schema === GENERATED_STATE_OWNER_SCHEMA
    && typeof owner.repositoryRoot === 'string' && owner.repositoryRoot.length > 0
    && typeof owner.namespace === 'string' && /^[A-Za-z0-9._-]+$/u.test(owner.namespace)
    && owner.namespace !== '.' && owner.namespace !== '..'
    && typeof owner.host === 'string' && owner.host.length > 0
    && Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0
    && typeof owner.token === 'string'
    && /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(owner.token)
    && typeof owner.createdAt === 'string' && Number.isFinite(Date.parse(owner.createdAt));
}

export function generatedStateCleanupAllowed(
  entry: Pick<GeneratedStateInventoryEntry, 'stateClass' | 'status' | 'cleanupProfiles'>,
  profile: GeneratedStateCleanupProfile
): boolean {
  if (!entry.cleanupProfiles.includes(profile)) return false;
  if (
    entry.status === 'active'
    || entry.status === 'retained'
    || entry.status === 'legacy-unowned'
    || entry.status === 'invalid-location'
    || entry.status === 'control-state'
    || entry.status === 'cleanup-residue'
    || entry.status === 'unsafe-entry'
    || entry.status === 'unknown'
    || entry.stateClass === 'recovery-asset'
    || entry.stateClass === 'identity-bound-control'
    || entry.stateClass === 'unknown'
  ) return false;
  if (profile === 'automatic') return entry.status === 'orphaned';
  if (profile === 'safe') {
    return entry.status === 'orphaned'
      || entry.status === 'legacy-expired'
      || entry.status === 'expired-diagnostic';
  }
  return entry.status === 'orphaned'
    || entry.status === 'legacy-expired'
    || entry.status === 'expired-diagnostic'
    || entry.stateClass === 'rebuildable-cache'
    || entry.stateClass === 'derived-toolchain';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function generatedStateDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

assertGeneratedStateRegistry();
