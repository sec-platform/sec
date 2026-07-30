import { createHash } from 'node:crypto';

import {
  CodexDevelopmentAssertCiExecutionEnvironmentBindingV1,
  CodexDevelopmentBuildSanitizedChildEnvironmentV1,
  type CodexDevelopmentCiExecutionEnvironmentBindingV1
} from './ci-execution-environment.ts';
import { CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION } from './ci-verification-revision.ts';

export const CodexDevelopmentEvidenceCompositionPolicyRevisionV1 =
  'codex-development-evidence-composition-policy-v1' as const;
export const CodexDevelopmentReusableEvidenceFormatV1 =
  'legacy-frozen-exact-production-pass-v1-env-unbound' as const;
export const CodexDevelopmentSyntheticEvidencePolicyIdV1 =
  'ci-v8-synthetic-composition-v1' as const;

export type CodexDevelopmentEvidenceDispositionV1 = 'executed' | 'reused' | 'delta';

export type CodexDevelopmentVerificationScopeV1 = {
  order: number;
  scopeId: string;
  refinement: 'allowed' | 'forbidden';
  inventoryDigest: string;
  runtime: string;
  argv: string[];
  env: Record<string, string>;
  requiredGitBlobs: CodexDevelopmentRequiredGitBlobV1[];
};

export type CodexDevelopmentVerificationScopeInventoryV1 = {
  profile: 'quick' | 'full';
  fullChangedFiles: string[];
  fullChangedInputDigest: string;
  fullSelectionDigest: string;
  scopes: CodexDevelopmentVerificationScopeV1[];
};

export type CodexDevelopmentRequiredGitBlobV1 = {
  path: string;
  blobSha: string;
  mode: '100644' | '100755';
  type: 'blob';
};

export type CodexDevelopmentExactGitBlobV1 = {
  blobSha: string;
  mode: '100644' | '100755';
  type: 'blob';
};

export type CodexDevelopmentExactGitBlobBytesV1 = CodexDevelopmentExactGitBlobV1 & {
  bytes: Uint8Array;
};

export type CodexDevelopmentReusableGitBlobV1 = {
  id: string;
  testedPath: string;
  testedBlobSha: string;
  testedMode: '100644' | '100755';
  testedType: 'blob';
  currentPath: string;
  currentBlobSha: string;
  currentMode: '100644' | '100755';
  currentType: 'blob';
};

export type CodexDevelopmentReusableScopeV1 = {
  scopeId: string;
  inventoryDigest: string;
  gitBlobIds: string[];
};

export type CodexDevelopmentReusableEvidenceV1 = {
  schemaVersion: '1';
  recordType: string;
  identity: string;
  status: 'PASS';
  testedHead: string;
  testedTree: string;
  runtime: { version: string };
  execution: { argv: string[]; rerunAllowed: false };
};

export type CodexDevelopmentEvidenceCompositionAssignmentV1 = {
  scopeId: string;
  inventoryDigest: string;
  disposition: CodexDevelopmentEvidenceDispositionV1;
  evidenceIdentity: string | null;
  gateId: string | null;
};

export type CodexDevelopmentEvidenceCompositionPolicyGateV1 = {
  order: number;
  gateId: string;
  disposition: 'executed' | 'delta';
  runtime: string;
  argv: string[];
  env: Record<string, string>;
  coveredScopeIds: string[];
};

export type CodexDevelopmentEvidenceCompositionRefinementV1 = {
  parentScopeId: string;
  parentInventoryDigest: string;
  scopes: CodexDevelopmentVerificationScopeV1[];
};

export type CodexDevelopmentEvidenceReuseBindingV1 = {
  evidenceFormat: typeof CodexDevelopmentReusableEvidenceFormatV1;
  evidenceIdentity: string;
  evidencePath: string;
  evidenceDigest: string;
  evidenceBlobSha: string;
  evidenceMode: '100644' | '100755';
  evidenceType: 'blob';
  environmentBinding: 'legacy-unbound-v1';
  scopeBinding: 'base-policy-exact-v1';
  expandable: false;
  recordType: string;
  status: 'PASS';
  rerunAllowed: false;
  testedHead: string;
  testedTree: string;
  runtime: string;
  argv: string[];
  gitBlobs: CodexDevelopmentReusableGitBlobV1[];
  inventory: CodexDevelopmentReusableScopeV1[];
};

export type CodexDevelopmentEvidenceCompositionPolicyV1 = {
  policyRevision: typeof CodexDevelopmentEvidenceCompositionPolicyRevisionV1;
  policyId: string;
  workPackageId: string;
  ciRevision: typeof CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION;
  requiredProfile: 'quick' | 'full';
  parentSelectionDigest: string;
  fullSelectionDigest: string;
  refinements: CodexDevelopmentEvidenceCompositionRefinementV1[];
  assignments: CodexDevelopmentEvidenceCompositionAssignmentV1[];
  gates: CodexDevelopmentEvidenceCompositionPolicyGateV1[];
  reusedEvidence: CodexDevelopmentEvidenceReuseBindingV1[];
};

export type CodexDevelopmentEvidenceCoverageLedgerEntryV1 = {
  scopeId: string;
  inventoryDigest: string;
  disposition: CodexDevelopmentEvidenceDispositionV1;
  evidenceIdentity: string | null;
  gateId: string | null;
};

export type CodexDevelopmentReusedEvidenceRecordV1 = {
  policyId: string;
  evidenceIdentity: string;
  evidencePath: string;
  evidenceDigest: string;
  evidenceBlobSha: string;
  evidenceMode: '100644' | '100755';
  evidenceType: 'blob';
  environmentBinding: 'legacy-unbound-v1';
  scopeBinding: 'base-policy-exact-v1';
  expandable: false;
  assignmentDigest: string;
  inventoryDigest: string;
  baselineArgvDigest: string;
  gitBlobClosureDigest: string;
  testedHead: string;
  testedTree: string;
};

export type CodexDevelopmentEvidenceCompositionGateV1 = {
  order: number;
  coveredScopeIds: string[];
  disposition: 'executed' | 'delta';
  gateId: string;
  runtime: string;
  argv: string[];
  env: Record<string, string>;
  envAllowlistRevision: string;
  envDigest: string;
};

export type CodexDevelopmentEvidenceCompositionPlanV1 = {
  policyId: string;
  requiredProfile: 'quick' | 'full';
  fullChangedFiles: string[];
  fullChangedInputDigest: string;
  fullSelectionDigest: string;
  refinedSelectionDigest: string;
  coverageLedger: CodexDevelopmentEvidenceCoverageLedgerEntryV1[];
  reusedEvidence: CodexDevelopmentReusedEvidenceRecordV1[];
  uncoveredScopes: string[];
  gates: CodexDevelopmentEvidenceCompositionGateV1[];
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: unknown): string {
  function normalize(input: unknown): JsonValue {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Evidence composition cannot canonicalize a non-finite number.');
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, normalize(nested)]));
    }
    throw new Error(`Evidence composition cannot canonicalize ${typeof input}.`);
  }
  return JSON.stringify(normalize(value));
}

export function CodexDevelopmentEvidenceCompositionDigestV1(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

export function CodexDevelopmentEvidenceCompositionRawDigestV1(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function CodexDevelopmentVerificationScopeV1(
  scopeId: string,
  runtime: string,
  argv: readonly string[],
  inventory: unknown,
  requiredGitBlobs: readonly CodexDevelopmentRequiredGitBlobV1[] = [],
  order = 0,
  env: Readonly<Record<string, string>> = {},
  refinement: 'allowed' | 'forbidden' = 'forbidden'
): CodexDevelopmentVerificationScopeV1 {
  return {
    order,
    scopeId,
    refinement,
    inventoryDigest: CodexDevelopmentEvidenceCompositionDigestV1({
      scopeId,
      refinement,
      runtime,
      argv: [...argv],
      env,
      inventory,
      requiredGitBlobs
    }),
    runtime,
    argv: [...argv],
    env: { ...env },
    requiredGitBlobs: requiredGitBlobs.map((entry) => ({ ...entry }))
  };
}

export function CodexDevelopmentVerificationSelectionDigestV1(
  profile: 'quick' | 'full',
  fullChangedFiles: readonly string[],
  scopes: readonly Pick<
    CodexDevelopmentVerificationScopeV1,
    'order' | 'scopeId' | 'refinement' | 'inventoryDigest' | 'runtime' | 'argv' | 'env'
  >[],
  fullChangedInputDigest = CodexDevelopmentEvidenceCompositionDigestV1({ fullChangedFiles })
): string {
  return CodexDevelopmentEvidenceCompositionDigestV1({
    profile,
    fullChangedFiles: [...fullChangedFiles],
    fullChangedInputDigest,
    scopes: scopes.map(({ order, scopeId, refinement, inventoryDigest, runtime, argv, env }) => ({
      order,
      scopeId,
      refinement,
      inventoryDigest,
      runtime,
      argv,
      env
    }))
  });
}

function gitBlobSha(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

const SYNTHETIC_TESTED_HEAD = '1'.repeat(40);
const SYNTHETIC_TESTED_TREE = '2'.repeat(40);
const SYNTHETIC_COVERED_BYTES = 'synthetic reusable coverage\n';
const SYNTHETIC_COVERED_BLOB = gitBlobSha(SYNTHETIC_COVERED_BYTES);
const SYNTHETIC_DELTA_TESTED_BYTES = 'synthetic historical delta coverage\n';
const SYNTHETIC_DELTA_CURRENT_BYTES = 'synthetic current delta coverage\n';
const SYNTHETIC_REQUIRED_BLOBS = [{
  path: 'tests/fixtures/ci-evidence-reuse/synthetic-covered.txt',
  blobSha: SYNTHETIC_COVERED_BLOB,
  mode: '100644' as const,
  type: 'blob' as const
}];
const SYNTHETIC_DELTA_REQUIRED_BLOBS = [{
  ...SYNTHETIC_REQUIRED_BLOBS[0]!
}, {
  path: 'tests/fixtures/ci-evidence-reuse/synthetic-delta-current.txt',
  blobSha: gitBlobSha(SYNTHETIC_DELTA_CURRENT_BYTES),
  mode: '100644' as const,
  type: 'blob' as const
}];
const SYNTHETIC_REUSABLE_BLOBS: CodexDevelopmentReusableGitBlobV1[] = [{
  id: 'synthetic-common-input',
  testedPath: SYNTHETIC_REQUIRED_BLOBS[0]!.path,
  testedBlobSha: SYNTHETIC_REQUIRED_BLOBS[0]!.blobSha,
  testedMode: '100644',
  testedType: 'blob',
  currentPath: SYNTHETIC_REQUIRED_BLOBS[0]!.path,
  currentBlobSha: SYNTHETIC_REQUIRED_BLOBS[0]!.blobSha,
  currentMode: '100644',
  currentType: 'blob'
}, {
  id: 'synthetic-delta-input',
  testedPath: 'tests/fixtures/ci-evidence-reuse/synthetic-delta-historical.txt',
  testedBlobSha: gitBlobSha(SYNTHETIC_DELTA_TESTED_BYTES),
  testedMode: '100644',
  testedType: 'blob',
  currentPath: SYNTHETIC_DELTA_REQUIRED_BLOBS[1]!.path,
  currentBlobSha: SYNTHETIC_DELTA_REQUIRED_BLOBS[1]!.blobSha,
  currentMode: '100644',
  currentType: 'blob'
}];
const SYNTHETIC_REUSED_SCOPE = CodexDevelopmentVerificationScopeV1(
  'test-title:synthetic-file:frozen-title',
  'bun@1.3.6',
  ['bun', 'run', 'test:slow', '--', '--suite', 'synthetic-reused'],
  { files: ['tests/fixtures/ci-evidence-reuse/synthetic-covered.txt'] },
  SYNTHETIC_REQUIRED_BLOBS,
  2
);
const SYNTHETIC_EXECUTED_SCOPE = CodexDevelopmentVerificationScopeV1(
  'test-title:synthetic-file:sibling-a',
  'bun@1.3.6',
  ['bun', 'test', 'tests/unit/ci-evidence-reuse-contract.test.ts', '--test-name-pattern', '^(sibling-a|sibling-b)$'],
  { testFile: 'tests/unit/ci-evidence-reuse-contract.test.ts', testTitle: 'sibling-a' },
  SYNTHETIC_REQUIRED_BLOBS,
  0
);
const SYNTHETIC_EXECUTED_SIBLING_SCOPE = CodexDevelopmentVerificationScopeV1(
  'test-title:synthetic-file:sibling-b',
  SYNTHETIC_EXECUTED_SCOPE.runtime,
  SYNTHETIC_EXECUTED_SCOPE.argv,
  { testFile: 'tests/unit/ci-evidence-reuse-contract.test.ts', testTitle: 'sibling-b' },
  SYNTHETIC_REQUIRED_BLOBS,
  1
);
const SYNTHETIC_DELTA_SCOPE = CodexDevelopmentVerificationScopeV1(
  'test-title:synthetic-wrapper:production-sentinel',
  'bun@1.3.6',
  ['bun', 'test', 'tests/unit/ci-evidence-reuse-contract.test.ts', '--test-name-pattern', 'delta'],
  { testFile: 'tests/unit/ci-evidence-reuse-contract.test.ts', selection: 'delta' },
  SYNTHETIC_DELTA_REQUIRED_BLOBS,
  3,
  { SEC_RUN_SYNTHETIC_SENTINEL: '1' }
);
const SYNTHETIC_CHANGED_FILES = [
  'tests/fixtures/ci-evidence-reuse/synthetic-covered.txt',
  'tests/fixtures/ci-evidence-reuse/synthetic-delta-current.txt'
];
const SYNTHETIC_SCOPES = [
  SYNTHETIC_EXECUTED_SCOPE,
  SYNTHETIC_EXECUTED_SIBLING_SCOPE,
  SYNTHETIC_REUSED_SCOPE,
  SYNTHETIC_DELTA_SCOPE
];
const SYNTHETIC_PARENT_SCOPES = [
  CodexDevelopmentVerificationScopeV1(
    'fast-test:synthetic-file',
    'bun@1.3.6',
    ['bun', 'run', 'test:fast', '--', 'tests/integration/synthetic.test.ts'],
    { testFile: 'tests/integration/synthetic.test.ts' },
    SYNTHETIC_REQUIRED_BLOBS,
    0,
    {},
    'allowed'
  ),
  CodexDevelopmentVerificationScopeV1(
    'fast-test:synthetic-wrapper',
    'bun@1.3.6',
    ['bun', 'run', 'test:fast', '--', 'tests/integration/synthetic-wrapper.test.ts'],
    { testFile: 'tests/integration/synthetic-wrapper.test.ts' },
    SYNTHETIC_DELTA_REQUIRED_BLOBS,
    1,
    {},
    'allowed'
  )
];
const SYNTHETIC_PARENT_SELECTION_DIGEST = CodexDevelopmentVerificationSelectionDigestV1(
  'quick',
  SYNTHETIC_CHANGED_FILES,
  SYNTHETIC_PARENT_SCOPES
);
const SYNTHETIC_SELECTION_DIGEST = CodexDevelopmentVerificationSelectionDigestV1(
  'quick',
  SYNTHETIC_CHANGED_FILES,
  SYNTHETIC_SCOPES
);
const SYNTHETIC_EVIDENCE: CodexDevelopmentReusableEvidenceV1 = {
  schemaVersion: '1',
  recordType: 'frozen-exact-production-pass-evidence',
  identity: 'synthetic-reused-pass-v1',
  status: 'PASS',
  testedHead: SYNTHETIC_TESTED_HEAD,
  testedTree: SYNTHETIC_TESTED_TREE,
  runtime: { version: '1.3.6' },
  execution: {
    argv: [...SYNTHETIC_REUSED_SCOPE.argv],
    rerunAllowed: false
  }
};

export const CodexDevelopmentSyntheticReusableEvidenceV1 = Object.freeze(SYNTHETIC_EVIDENCE);
export const CodexDevelopmentSyntheticReusableEvidenceSourceV1 = `${JSON.stringify(SYNTHETIC_EVIDENCE, null, 2)}\n`;

const SYNTHETIC_POLICY: CodexDevelopmentEvidenceCompositionPolicyV1 = {
  policyRevision: CodexDevelopmentEvidenceCompositionPolicyRevisionV1,
  policyId: CodexDevelopmentSyntheticEvidencePolicyIdV1,
  workPackageId: 'ci-v8-evidence-composition-bootstrap-v1',
  ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
  requiredProfile: 'quick',
  parentSelectionDigest: SYNTHETIC_PARENT_SELECTION_DIGEST,
  fullSelectionDigest: SYNTHETIC_SELECTION_DIGEST,
  refinements: [
    {
      parentScopeId: SYNTHETIC_PARENT_SCOPES[0]!.scopeId,
      parentInventoryDigest: SYNTHETIC_PARENT_SCOPES[0]!.inventoryDigest,
      scopes: [SYNTHETIC_EXECUTED_SCOPE, SYNTHETIC_EXECUTED_SIBLING_SCOPE, SYNTHETIC_REUSED_SCOPE]
    },
    {
      parentScopeId: SYNTHETIC_PARENT_SCOPES[1]!.scopeId,
      parentInventoryDigest: SYNTHETIC_PARENT_SCOPES[1]!.inventoryDigest,
      scopes: [SYNTHETIC_DELTA_SCOPE]
    }
  ],
  assignments: [
    {
      scopeId: SYNTHETIC_EXECUTED_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_EXECUTED_SCOPE.inventoryDigest,
      disposition: 'executed',
      evidenceIdentity: null,
      gateId: 'synthetic-focused'
    },
    {
      scopeId: SYNTHETIC_EXECUTED_SIBLING_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_EXECUTED_SIBLING_SCOPE.inventoryDigest,
      disposition: 'executed',
      evidenceIdentity: null,
      gateId: 'synthetic-focused'
    },
    {
      scopeId: SYNTHETIC_REUSED_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_REUSED_SCOPE.inventoryDigest,
      disposition: 'reused',
      evidenceIdentity: SYNTHETIC_EVIDENCE.identity,
      gateId: null
    },
    {
      scopeId: SYNTHETIC_DELTA_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_DELTA_SCOPE.inventoryDigest,
      disposition: 'delta',
      evidenceIdentity: SYNTHETIC_EVIDENCE.identity,
      gateId: 'synthetic-delta'
    }
  ],
  gates: [
    {
      order: 0,
      gateId: 'synthetic-focused',
      disposition: 'executed',
      runtime: SYNTHETIC_EXECUTED_SCOPE.runtime,
      argv: [...SYNTHETIC_EXECUTED_SCOPE.argv],
      env: {},
      coveredScopeIds: [SYNTHETIC_EXECUTED_SCOPE.scopeId, SYNTHETIC_EXECUTED_SIBLING_SCOPE.scopeId]
    },
    {
      order: 1,
      gateId: 'synthetic-delta',
      disposition: 'delta',
      runtime: SYNTHETIC_DELTA_SCOPE.runtime,
      argv: [...SYNTHETIC_DELTA_SCOPE.argv],
      env: { SEC_RUN_SYNTHETIC_SENTINEL: '1' },
      coveredScopeIds: [SYNTHETIC_DELTA_SCOPE.scopeId]
    }
  ],
  reusedEvidence: [{
    evidenceFormat: CodexDevelopmentReusableEvidenceFormatV1,
    evidenceIdentity: SYNTHETIC_EVIDENCE.identity,
    evidencePath: 'tests/fixtures/ci-evidence-reuse/synthetic-pass.json',
    evidenceDigest: CodexDevelopmentEvidenceCompositionRawDigestV1(CodexDevelopmentSyntheticReusableEvidenceSourceV1),
    evidenceBlobSha: gitBlobSha(CodexDevelopmentSyntheticReusableEvidenceSourceV1),
    evidenceMode: '100644',
    evidenceType: 'blob',
    environmentBinding: 'legacy-unbound-v1',
    scopeBinding: 'base-policy-exact-v1',
    expandable: false,
    recordType: SYNTHETIC_EVIDENCE.recordType,
    status: SYNTHETIC_EVIDENCE.status,
    rerunAllowed: SYNTHETIC_EVIDENCE.execution.rerunAllowed,
    testedHead: SYNTHETIC_EVIDENCE.testedHead,
    testedTree: SYNTHETIC_EVIDENCE.testedTree,
    runtime: SYNTHETIC_REUSED_SCOPE.runtime,
    argv: [...SYNTHETIC_REUSED_SCOPE.argv],
    gitBlobs: SYNTHETIC_REUSABLE_BLOBS.map((entry) => ({ ...entry })),
    inventory: [{
      scopeId: SYNTHETIC_REUSED_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_REUSED_SCOPE.inventoryDigest,
      gitBlobIds: ['synthetic-common-input']
    }, {
      scopeId: SYNTHETIC_DELTA_SCOPE.scopeId,
      inventoryDigest: SYNTHETIC_DELTA_SCOPE.inventoryDigest,
      gitBlobIds: ['synthetic-common-input', 'synthetic-delta-input']
    }]
  }]
};

function clonePolicy(policy: CodexDevelopmentEvidenceCompositionPolicyV1): CodexDevelopmentEvidenceCompositionPolicyV1 {
  return structuredClone(policy);
}

export function CodexDevelopmentSyntheticEvidenceCompositionPolicyV1(): CodexDevelopmentEvidenceCompositionPolicyV1 {
  return clonePolicy(SYNTHETIC_POLICY);
}

export function CodexDevelopmentSyntheticVerificationInventoryV1(): CodexDevelopmentVerificationScopeInventoryV1 {
  return {
    profile: 'quick',
    fullChangedFiles: [...SYNTHETIC_CHANGED_FILES],
    fullChangedInputDigest: CodexDevelopmentEvidenceCompositionDigestV1({
      fullChangedFiles: SYNTHETIC_CHANGED_FILES
    }),
    fullSelectionDigest: SYNTHETIC_PARENT_SELECTION_DIGEST,
    scopes: SYNTHETIC_PARENT_SCOPES.map((scope) => ({
      ...scope,
      argv: [...scope.argv],
      env: { ...scope.env },
      requiredGitBlobs: scope.requiredGitBlobs.map((entry) => ({ ...entry }))
    }))
  };
}

function assertCanonicalId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9:-]*$/u.test(value)) throw new Error(`${label} must be a stable canonical ID.`);
}

function assertDigest(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a sha256 digest.`);
}

function assertSha(value: string, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be a lowercase Git SHA.`);
}

function canonicalPath(value: string, label: string): void {
  if (
    value.length === 0 || value.includes('\\') || value.startsWith('/') || value.startsWith('./') ||
    value.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) throw new Error(`${label} must be a canonical repository-relative path.`);
}

function exactArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCanonicalEnvironment(env: Record<string, string>, label: string): void {
  const keys = Object.keys(env);
  assertCanonicalUniqueStrings(keys, `${label} keys`);
  for (const [key, value] of Object.entries(env)) {
    if (!/^SEC_RUN_[A-Z0-9_]+$/u.test(key) || value !== '1') {
      throw new Error(`${label} may only opt into base-policy SEC_RUN_* sentinels with value 1.`);
    }
  }
}

function assertScopeInventoryShape(inventory: CodexDevelopmentVerificationScopeInventoryV1): void {
  assertCanonicalUniqueStrings(inventory.fullChangedFiles, 'Verification full changed files');
  assertDigest(inventory.fullChangedInputDigest, 'Verification full changed input digest');
  assertDigest(inventory.fullSelectionDigest, 'Verification full selection digest');
  const scopeIds = inventory.scopes.map((scope) => scope.scopeId);
  if (new Set(scopeIds).size !== scopeIds.length) throw new Error('Verification selector inventory has duplicate scopes.');
  inventory.scopes.forEach((scope, index) => {
    if (scope.order !== index) throw new Error('Verification selector inventory order is not canonical.');
    if (scope.refinement !== 'allowed' && scope.refinement !== 'forbidden') {
      throw new Error(`Verification selector scope ${scope.scopeId} has an invalid refinement boundary.`);
    }
    assertCanonicalEnvironment(scope.env, `${scope.scopeId} environment`);
    assertCanonicalUniqueStrings(scope.requiredGitBlobs.map((blob) => blob.path), `${scope.scopeId} required Git blobs`);
    for (const blob of scope.requiredGitBlobs) {
      canonicalPath(blob.path, `${scope.scopeId} required Git blob path`);
      assertSha(blob.blobSha, `${scope.scopeId} required Git blob SHA`);
      if (blob.type !== 'blob' || (blob.mode !== '100644' && blob.mode !== '100755')) {
        throw new Error(`${scope.scopeId} required Git entry must be an ordinary blob with exact mode.`);
      }
    }
  });
  const recomputed = CodexDevelopmentVerificationSelectionDigestV1(
    inventory.profile,
    inventory.fullChangedFiles,
    inventory.scopes,
    inventory.fullChangedInputDigest
  );
  if (recomputed !== inventory.fullSelectionDigest) {
    throw new Error('Verification selector inventory digest mismatch.');
  }
}

function requiredBlobUnion(scopes: readonly CodexDevelopmentVerificationScopeV1[]): CodexDevelopmentRequiredGitBlobV1[] {
  const byPath = new Map<string, CodexDevelopmentRequiredGitBlobV1>();
  for (const blob of scopes.flatMap((scope) => scope.requiredGitBlobs)) {
    const previous = byPath.get(blob.path);
    if (previous !== undefined && !exactArray(
      [previous.blobSha, previous.mode, previous.type],
      [blob.blobSha, blob.mode, blob.type]
    )) {
      throw new Error(`Verification scope refinements disagree on Git blob ${blob.path}.`);
    }
    byPath.set(blob.path, { ...blob });
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, blob]) => blob);
}

function applyPolicyRefinements(
  policy: CodexDevelopmentEvidenceCompositionPolicyV1,
  parentInventory: CodexDevelopmentVerificationScopeInventoryV1,
  currentHead: string,
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null
): CodexDevelopmentVerificationScopeInventoryV1 {
  assertScopeInventoryShape(parentInventory);
  if (parentInventory.fullSelectionDigest !== policy.parentSelectionDigest) {
    throw new Error('Evidence composition policy does not bind the complete parent selector inventory.');
  }
  const refinementIds = policy.refinements.map((refinement) => refinement.parentScopeId);
  if (new Set(refinementIds).size !== refinementIds.length) {
    throw new Error('Evidence composition policy refines one parent scope more than once.');
  }
  const refinementById = new Map(policy.refinements.map((refinement) => [refinement.parentScopeId, refinement]));
  const parentIds = new Set(parentInventory.scopes.map((scope) => scope.scopeId));
  const unknownParents = refinementIds.filter((scopeId) => !parentIds.has(scopeId));
  if (unknownParents.length > 0) {
    throw new Error(`Evidence composition policy refines unselected parent scopes: ${unknownParents.join(', ')}.`);
  }
  const refinedScopes: CodexDevelopmentVerificationScopeV1[] = [];
  for (const parent of parentInventory.scopes) {
    const refinement = refinementById.get(parent.scopeId);
    if (!refinement) {
      refinedScopes.push({
        ...parent,
        order: refinedScopes.length,
        argv: [...parent.argv],
        env: { ...parent.env },
        requiredGitBlobs: parent.requiredGitBlobs.map((blob) => ({ ...blob }))
      });
      continue;
    }
    if (parent.refinement !== 'allowed') {
      throw new Error(`Evidence composition policy cannot refine canonical scope ${parent.scopeId}.`);
    }
    if (refinement.parentInventoryDigest !== parent.inventoryDigest || refinement.scopes.length === 0) {
      throw new Error(`Evidence composition refinement parent mismatch: ${parent.scopeId}.`);
    }
    const childBlobUnion = requiredBlobUnion(refinement.scopes);
    const childBlobByPath = new Map(childBlobUnion.map((blob) => [blob.path, blob]));
    if (parent.requiredGitBlobs.some((blob) => {
      const childBlob = childBlobByPath.get(blob.path);
      return !childBlob || !exactArray(
        [childBlob.blobSha, childBlob.mode, childBlob.type],
        [blob.blobSha, blob.mode, blob.type]
      );
    })) {
      throw new Error(`Evidence composition refinement omits or changes parent Git blobs for ${parent.scopeId}.`);
    }
    for (const blob of childBlobUnion) {
      const currentEntry = gitBlob(currentHead, blob.path);
      if (!currentEntry || !exactArray(
        [currentEntry.blobSha, currentEntry.mode, currentEntry.type],
        [blob.blobSha, blob.mode, blob.type]
      )) {
        throw new Error(`Evidence composition refinement Git blob is not exact at current head: ${blob.path}.`);
      }
    }
    for (const child of refinement.scopes) {
      if (child.order !== refinedScopes.length) {
        throw new Error(`Evidence composition refinement order is not canonical for ${child.scopeId}.`);
      }
      if (child.refinement !== 'forbidden') {
        throw new Error(`Evidence composition refinement child cannot be refinable: ${child.scopeId}.`);
      }
      refinedScopes.push({
        ...child,
        argv: [...child.argv],
        env: { ...child.env },
        requiredGitBlobs: child.requiredGitBlobs.map((blob) => ({ ...blob }))
      });
    }
  }
  const refined: CodexDevelopmentVerificationScopeInventoryV1 = {
    profile: parentInventory.profile,
    fullChangedFiles: [...parentInventory.fullChangedFiles],
    fullChangedInputDigest: parentInventory.fullChangedInputDigest,
    fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1(
      parentInventory.profile,
      parentInventory.fullChangedFiles,
      refinedScopes,
      parentInventory.fullChangedInputDigest
    ),
    scopes: refinedScopes
  };
  assertScopeInventoryShape(refined);
  if (refined.fullSelectionDigest !== policy.fullSelectionDigest) {
    throw new Error('Evidence composition policy does not bind the complete refined selector inventory.');
  }
  return refined;
}

function codeUnitSorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function assertCanonicalUniqueStrings(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length || !exactArray(values, codeUnitSorted(values))) {
    throw new Error(`${label} must be unique and canonically ordered.`);
  }
}

function bindingScope(
  binding: CodexDevelopmentEvidenceReuseBindingV1,
  scopeId: string
): CodexDevelopmentReusableScopeV1 {
  const entry = binding.inventory.find((candidate) => candidate.scopeId === scopeId);
  if (!entry) throw new Error(`Reusable evidence inventory does not cover ${scopeId}.`);
  return entry;
}

function scopedBlobMappings(
  binding: CodexDevelopmentEvidenceReuseBindingV1,
  scopeId: string
): CodexDevelopmentReusableGitBlobV1[] {
  const ids = new Set(bindingScope(binding, scopeId).gitBlobIds);
  return binding.gitBlobs.filter((blob) => ids.has(blob.id));
}

function currentRequiredBlobs(
  binding: CodexDevelopmentEvidenceReuseBindingV1,
  scopeId: string
): CodexDevelopmentRequiredGitBlobV1[] {
  return scopedBlobMappings(binding, scopeId)
    .map((blob) => ({
      path: blob.currentPath,
      blobSha: blob.currentBlobSha,
      mode: blob.currentMode,
      type: blob.currentType
    }));
}

function assertBlobEntries(
  binding: CodexDevelopmentEvidenceReuseBindingV1,
  currentHead: string,
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null
): void {
  if (binding.gitBlobs.length === 0) {
    throw new Error(`Reusable evidence ${binding.evidenceIdentity} has no exact Git blob closure.`);
  }
  const blobIds = binding.gitBlobs.map((blob) => blob.id);
  assertCanonicalUniqueStrings(blobIds, `Reusable evidence ${binding.evidenceIdentity} Git blob IDs`);
  const referencedBlobIds = binding.inventory.flatMap((entry) => {
    assertCanonicalUniqueStrings(entry.gitBlobIds, `Reusable evidence ${entry.scopeId} Git blob IDs`);
    return entry.gitBlobIds;
  });
  if (
    !exactArray(codeUnitSorted([...new Set(referencedBlobIds)]), blobIds)
  ) throw new Error(`Reusable evidence ${binding.evidenceIdentity} Git blob mappings are incomplete or overlapping.`);
  const testedPaths = binding.gitBlobs.map((blob) => blob.testedPath);
  const currentPaths = binding.gitBlobs.map((blob) => blob.currentPath);
  if (new Set(testedPaths).size !== testedPaths.length || new Set(currentPaths).size !== currentPaths.length) {
    throw new Error(`Reusable evidence ${binding.evidenceIdentity} has duplicate Git blob paths.`);
  }
  for (const blob of binding.gitBlobs) {
    assertCanonicalId(blob.id, 'Reusable evidence Git blob ID');
    canonicalPath(blob.testedPath, 'Reusable evidence tested Git blob path');
    canonicalPath(blob.currentPath, 'Reusable evidence current Git blob path');
    assertSha(blob.testedBlobSha, 'Reusable evidence tested Git blob SHA');
    assertSha(blob.currentBlobSha, 'Reusable evidence current Git blob SHA');
    const testedEntry = gitBlob(binding.testedHead, blob.testedPath);
    if (!testedEntry || !exactArray(
      [testedEntry.blobSha, testedEntry.mode, testedEntry.type],
      [blob.testedBlobSha, blob.testedMode, blob.testedType]
    )) {
      throw new Error(`Reusable evidence historical Git blob mismatch: ${blob.testedPath}.`);
    }
    const currentEntry = gitBlob(currentHead, blob.currentPath);
    if (!currentEntry || !exactArray(
      [currentEntry.blobSha, currentEntry.mode, currentEntry.type],
      [blob.currentBlobSha, blob.currentMode, blob.currentType]
    )) {
      throw new Error(`Reusable evidence current Git blob mismatch: ${blob.currentPath}.`);
    }
  }
}

function assertReusableEvidence(
  raw: string,
  binding: CodexDevelopmentEvidenceReuseBindingV1,
  currentHead: string,
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null,
  gitTree: (ref: string) => string | null
): void {
  if (CodexDevelopmentEvidenceCompositionRawDigestV1(raw) !== binding.evidenceDigest) {
    throw new Error(`Reusable evidence digest mismatch: ${binding.evidenceIdentity}.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Reusable evidence is not JSON: ${binding.evidenceIdentity}.`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Reusable evidence must be an object: ${binding.evidenceIdentity}.`);
  }
  if (binding.evidenceFormat !== CodexDevelopmentReusableEvidenceFormatV1) {
    throw new Error(`Reusable evidence format is unsupported: ${binding.evidenceFormat}.`);
  }
  if (
    binding.environmentBinding !== 'legacy-unbound-v1'
    || binding.scopeBinding !== 'base-policy-exact-v1'
    || binding.expandable !== false
  ) throw new Error(`Reusable legacy evidence boundary is invalid: ${binding.evidenceIdentity}.`);
  const evidence = value as Partial<CodexDevelopmentReusableEvidenceV1>;
  const projection = {
    schemaVersion: evidence.schemaVersion,
    recordType: evidence.recordType,
    identity: evidence.identity,
    status: evidence.status,
    testedHead: evidence.testedHead,
    testedTree: evidence.testedTree,
    runtime: evidence.runtime?.version === undefined ? undefined : `bun@${evidence.runtime.version}`,
    argv: evidence.execution?.argv,
    rerunAllowed: evidence.execution?.rerunAllowed
  };
  const expected = {
    schemaVersion: '1',
    recordType: binding.recordType,
    identity: binding.evidenceIdentity,
    status: binding.status,
    testedHead: binding.testedHead,
    testedTree: binding.testedTree,
    runtime: binding.runtime,
    argv: binding.argv,
    rerunAllowed: binding.rerunAllowed
  };
  if (JSON.stringify(projection) !== JSON.stringify(expected)) {
    throw new Error(`Reusable evidence identity or immutable binding mismatch: ${binding.evidenceIdentity}.`);
  }
  assertSha(binding.testedHead, 'Reusable evidence testedHead');
  assertSha(binding.testedTree, 'Reusable evidence testedTree');
  if (gitTree(binding.testedHead) !== binding.testedTree) {
    throw new Error(`Reusable evidence tested tree mismatch: ${binding.evidenceIdentity}.`);
  }
  assertBlobEntries(binding, currentHead, gitBlob);
}

export function CodexDevelopmentBuildEvidenceCompositionPlanV1(options: {
  policyId: string;
  workPackageId: string;
  ciRevision: string;
  profile: 'quick' | 'full';
  inventory: CodexDevelopmentVerificationScopeInventoryV1;
  runtime: string;
  currentHead: string;
  currentTree: string;
  readEvidence: (ref: string, evidencePath: string) => CodexDevelopmentExactGitBlobBytesV1 | null;
  resolvePolicy: (policyId: string) => CodexDevelopmentEvidenceCompositionPolicyV1;
  gitBlob: (ref: string, file: string) => CodexDevelopmentExactGitBlobV1 | null;
  gitTree: (ref: string) => string | null;
  executionEnvironment?: NodeJS.ProcessEnv;
  gateEnvironmentBindings?: Readonly<Record<string, CodexDevelopmentCiExecutionEnvironmentBindingV1>>;
}): CodexDevelopmentEvidenceCompositionPlanV1 {
  if (options.profile !== 'quick' || options.inventory.profile !== 'quick') {
    throw new Error('Evidence composition policy revision V1 supports Quick only.');
  }
  assertSha(options.currentHead, 'Evidence composition currentHead');
  assertSha(options.currentTree, 'Evidence composition currentTree');
  if (options.gitTree(options.currentHead) !== options.currentTree) {
    throw new Error('Evidence composition current head/tree mismatch.');
  }
  if ((options.executionEnvironment === undefined) === (options.gateEnvironmentBindings === undefined)) {
    throw new Error('Evidence composition requires exactly one execution environment binding source.');
  }
  const policy = options.resolvePolicy(options.policyId);
  if (policy.requiredProfile !== 'quick') {
    throw new Error('Evidence composition policy revision V1 requires Quick profile.');
  }
  if (policy.policyId !== options.policyId || policy.policyRevision !== CodexDevelopmentEvidenceCompositionPolicyRevisionV1) {
    throw new Error('Evidence composition policy identity or revision mismatch.');
  }
  assertCanonicalId(policy.policyId, 'Evidence composition policy ID');
  if (policy.workPackageId !== options.workPackageId) {
    throw new Error('Evidence composition policy is registered for a different Work Package.');
  }
  if (
    options.ciRevision !== CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION
    || policy.ciRevision !== options.ciRevision
  ) {
    throw new Error('Evidence composition policy CI revision mismatch.');
  }
  if (policy.requiredProfile !== options.profile || options.inventory.profile !== options.profile) {
    throw new Error('Evidence composition policy required profile mismatch.');
  }
  const inventory = applyPolicyRefinements(policy, options.inventory, options.currentHead, options.gitBlob);
  const scopeIds = inventory.scopes.map((scope) => scope.scopeId);
  const assignmentIds = policy.assignments.map((assignment) => assignment.scopeId);
  if (new Set(assignmentIds).size !== assignmentIds.length) throw new Error('Evidence policy assigns one scope more than once.');
  const scopeById = new Map(inventory.scopes.map((scope) => [scope.scopeId, scope]));
  const assignmentById = new Map(policy.assignments.map((assignment) => [assignment.scopeId, assignment]));
  const uncoveredScopes = scopeIds.filter((scopeId) => !assignmentById.has(scopeId));
  const unknownAssignments = assignmentIds.filter((scopeId) => !scopeById.has(scopeId));
  if (unknownAssignments.length > 0) {
    throw new Error(`Evidence policy contains selector scopes not present in the complete inventory: ${unknownAssignments.join(', ')}.`);
  }
  if (uncoveredScopes.length > 0) {
    throw new Error(`Evidence composition has uncovered selector scopes: ${uncoveredScopes.join(', ')}.`);
  }
  const bindingByIdentity = new Map(policy.reusedEvidence.map((binding) => [binding.evidenceIdentity, binding]));
  if (bindingByIdentity.size !== policy.reusedEvidence.length) {
    throw new Error('Evidence composition policy has duplicate reuse identities.');
  }
  const policyGateById = new Map(policy.gates.map((gate) => [gate.gateId, gate]));
  if (policyGateById.size !== policy.gates.length) throw new Error('Evidence composition policy has duplicate gate IDs.');
  const usedReuseIdentities = new Set<string>();
  const coverageLedger: CodexDevelopmentEvidenceCoverageLedgerEntryV1[] = [];
  for (const scope of inventory.scopes) {
    const assignment = assignmentById.get(scope.scopeId)!;
    if (assignment.inventoryDigest !== scope.inventoryDigest) {
      throw new Error(`Evidence policy inventory digest mismatch for ${scope.scopeId}.`);
    }
    if (assignment.disposition === 'reused') {
      if (assignment.gateId !== null || !assignment.evidenceIdentity) {
        throw new Error(`Reused scope ${scope.scopeId} has an executable or incomplete assignment.`);
      }
      const binding = bindingByIdentity.get(assignment.evidenceIdentity);
      if (!binding) throw new Error(`Reused scope ${scope.scopeId} has no registered immutable evidence binding.`);
      if (binding.runtime !== options.runtime || binding.runtime !== scope.runtime || !exactArray(binding.argv, scope.argv)) {
        throw new Error(`Reusable evidence runtime or argv does not match current scope ${scope.scopeId}.`);
      }
      if (scope.requiredGitBlobs.length === 0 || !exactArray(currentRequiredBlobs(binding, scope.scopeId), scope.requiredGitBlobs)) {
        throw new Error(`Reusable evidence Git blob closure does not exactly cover ${scope.scopeId}.`);
      }
      usedReuseIdentities.add(binding.evidenceIdentity);
    } else if (assignment.disposition === 'executed') {
      if (assignment.evidenceIdentity !== null || !assignment.gateId) {
        throw new Error(`${assignment.disposition} scope ${scope.scopeId} has an incomplete gate assignment.`);
      }
    } else {
      if (!assignment.evidenceIdentity || !assignment.gateId) {
        throw new Error(`Delta scope ${scope.scopeId} must bind both baseline evidence and one delta gate.`);
      }
      if (!bindingByIdentity.has(assignment.evidenceIdentity)) {
        throw new Error(`Delta scope ${scope.scopeId} has no registered baseline evidence.`);
      }
      if (scope.requiredGitBlobs.length === 0) {
        throw new Error(`Delta scope ${scope.scopeId} has no exact current-head Git blob closure.`);
      }
      const binding = bindingByIdentity.get(assignment.evidenceIdentity)!;
      const requiredByPath = new Map(scope.requiredGitBlobs.map((blob) => [blob.path, blob]));
      if (currentRequiredBlobs(binding, scope.scopeId).some((blob) => {
        const required = requiredByPath.get(blob.path);
        return !required || !exactArray(
          [required.blobSha, required.mode, required.type],
          [blob.blobSha, blob.mode, blob.type]
        );
      })) {
        throw new Error(`Delta evidence current Git blob closure is not a conservative subset of ${scope.scopeId}.`);
      }
      usedReuseIdentities.add(binding.evidenceIdentity);
    }
    coverageLedger.push({
      scopeId: scope.scopeId,
      inventoryDigest: scope.inventoryDigest,
      disposition: assignment.disposition,
      evidenceIdentity: assignment.evidenceIdentity,
      gateId: assignment.gateId
    });
  }
  const policyGateOrders = policy.gates.map((gate) => gate.order);
  if (new Set(policyGateOrders).size !== policyGateOrders.length || policyGateOrders.some((order, index) => order !== index)) {
    throw new Error('Evidence composition policy gate order is not canonical.');
  }
  const gateCoverageOrders: number[][] = [];
  const gates: CodexDevelopmentEvidenceCompositionGateV1[] = policy.gates.map((gate) => {
    const gateId = gate.gateId;
    if (new Set(gate.coveredScopeIds).size !== gate.coveredScopeIds.length) {
      throw new Error(`Evidence composition gate ${gateId} has duplicate covered scopes.`);
    }
    const assignedScopes = coverageLedger.filter((entry) => entry.gateId === gateId);
    if (assignedScopes.length === 0 || !exactArray(gate.coveredScopeIds, assignedScopes.map((entry) => entry.scopeId))) {
      throw new Error(`Evidence composition gate ${gateId} coverage does not match scope assignments.`);
    }
    const coveredOrders = assignedScopes.map((entry) => scopeById.get(entry.scopeId)!.order);
    if (coveredOrders.some((order, index) => index > 0 && order !== coveredOrders[index - 1]! + 1)) {
      throw new Error(`Evidence composition gate ${gateId} coverage is not one contiguous selector block.`);
    }
    gateCoverageOrders.push(coveredOrders);
    if (assignedScopes.some((entry) => entry.disposition !== gate.disposition)) {
      throw new Error(`Evidence composition gate ${gateId} disposition does not match scope assignments.`);
    }
    if (gate.runtime !== options.runtime || gate.argv.length === 0) {
      throw new Error(`Evidence composition gate ${gateId} runtime or argv is invalid.`);
    }
    assertCanonicalEnvironment(gate.env, `Evidence composition gate ${gateId} environment`);
    if (assignedScopes.some((entry) => !exactArray(
      Object.entries(scopeById.get(entry.scopeId)!.env),
      Object.entries(gate.env)
    ))) throw new Error(`Evidence composition gate ${gateId} environment does not match its scopes.`);
    if (gate.disposition === 'executed' && assignedScopes.some((entry) => {
      const scope = scopeById.get(entry.scopeId)!;
      return scope.runtime !== gate.runtime || !exactArray(scope.argv, gate.argv);
    })) throw new Error(`Executed gate ${gateId} does not preserve the canonical selector command.`);
    const environmentBinding = options.executionEnvironment === undefined
      ? options.gateEnvironmentBindings?.[gateId]
      : CodexDevelopmentBuildSanitizedChildEnvironmentV1(
        options.executionEnvironment,
        gate.env,
        gateId
      ).binding;
    if (!environmentBinding) {
      throw new Error(`Evidence composition gate ${gateId} has no execution environment binding.`);
    }
    CodexDevelopmentAssertCiExecutionEnvironmentBindingV1(environmentBinding);
    return {
      order: gate.order,
      coveredScopeIds: [...gate.coveredScopeIds],
      disposition: gate.disposition,
      gateId,
      runtime: gate.runtime,
      argv: [...gate.argv],
      env: { ...gate.env },
      envAllowlistRevision: environmentBinding.allowlistRevision,
      envDigest: environmentBinding.digest
    };
  });
  if (gateCoverageOrders.some((orders, index) => (
    index > 0 && orders[0]! <= gateCoverageOrders[index - 1]!.at(-1)!
  ))) {
    throw new Error('Evidence composition policy gates do not follow canonical selector order.');
  }
  const assignedGateIds = new Set(coverageLedger.flatMap((entry) => entry.gateId === null ? [] : [entry.gateId]));
  if ([...assignedGateIds].some((gateId) => !policyGateById.has(gateId))) {
    throw new Error('Evidence composition scope references an unknown policy gate.');
  }
  const unusedReuse = policy.reusedEvidence.filter((binding) => !usedReuseIdentities.has(binding.evidenceIdentity));
  if (unusedReuse.length > 0) throw new Error('Evidence composition policy contains unused reusable evidence bindings.');
  for (const identity of usedReuseIdentities) {
    const binding = bindingByIdentity.get(identity)!;
    const expectedInventory = coverageLedger
      .filter((entry) => entry.evidenceIdentity === identity)
      .map(({ scopeId, inventoryDigest }) => ({ scopeId, inventoryDigest }));
    const actualInventory = binding.inventory.map(({ scopeId, inventoryDigest }) => ({ scopeId, inventoryDigest }));
    if (!exactArray(actualInventory, expectedInventory)) {
      throw new Error(`Reusable evidence inventory does not exactly cover assigned scopes: ${identity}.`);
    }
    const entryByScope = new Map(coverageLedger.map((entry) => [entry.scopeId, entry]));
    for (const blob of binding.gitBlobs) {
      const referencingEntries = binding.inventory.filter((entry) => entry.gitBlobIds.includes(blob.id));
      const referencingLedger = referencingEntries.map((inventoryEntry) => {
        const ledger = entryByScope.get(inventoryEntry.scopeId);
        if (!ledger || ledger.evidenceIdentity !== identity) {
          throw new Error(`Reusable evidence Git blob ${blob.id} is not assigned to its bound scope.`);
        }
        return ledger;
      });
      const changed = blob.testedPath !== blob.currentPath
        || blob.testedBlobSha !== blob.currentBlobSha
        || blob.testedMode !== blob.currentMode
        || blob.testedType !== blob.currentType;
      if (changed && referencingLedger.some((ledger) => ledger.disposition !== 'delta' || ledger.gateId === null)) {
        throw new Error(`Every scope referencing changed Git blob ${blob.id} must be closed by a delta gate.`);
      }
    }
  }
  for (const identity of usedReuseIdentities) {
    const binding = bindingByIdentity.get(identity)!;
    canonicalPath(binding.evidencePath, 'Reusable evidence path');
    assertDigest(binding.evidenceDigest, 'Reusable evidence digest');
    assertSha(binding.evidenceBlobSha, 'Reusable evidence blob SHA');
    if (binding.evidenceType !== 'blob' || (binding.evidenceMode !== '100644' && binding.evidenceMode !== '100755')) {
      throw new Error(`Reusable evidence file entry is invalid: ${binding.evidenceIdentity}.`);
    }
    const evidenceEntry = options.readEvidence(options.currentHead, binding.evidencePath);
    if (
      !evidenceEntry
      || !exactArray(
        [evidenceEntry.blobSha, evidenceEntry.mode, evidenceEntry.type],
        [binding.evidenceBlobSha, binding.evidenceMode, binding.evidenceType]
      )
      || gitBlobSha(evidenceEntry.bytes) !== evidenceEntry.blobSha
    ) {
      throw new Error(`Reusable evidence is not an exact ordinary Git blob: ${binding.evidenceIdentity}.`);
    }
    assertReusableEvidence(
      new TextDecoder('utf-8', { fatal: true }).decode(evidenceEntry.bytes),
      binding,
      options.currentHead,
      options.gitBlob,
      options.gitTree
    );
  }
  return {
    policyId: policy.policyId,
    requiredProfile: policy.requiredProfile,
    fullChangedFiles: [...inventory.fullChangedFiles],
    fullChangedInputDigest: inventory.fullChangedInputDigest,
    fullSelectionDigest: options.inventory.fullSelectionDigest,
    refinedSelectionDigest: inventory.fullSelectionDigest,
    coverageLedger,
    reusedEvidence: [...usedReuseIdentities].sort().map((identity) => {
      const binding = bindingByIdentity.get(identity)!;
      const assignments = coverageLedger.filter((entry) => entry.evidenceIdentity === identity);
      return {
        policyId: policy.policyId,
        evidenceIdentity: binding.evidenceIdentity,
        evidencePath: binding.evidencePath,
        evidenceDigest: binding.evidenceDigest,
        evidenceBlobSha: binding.evidenceBlobSha,
        evidenceMode: binding.evidenceMode,
        evidenceType: binding.evidenceType,
        environmentBinding: binding.environmentBinding,
        scopeBinding: binding.scopeBinding,
        expandable: binding.expandable,
        assignmentDigest: CodexDevelopmentEvidenceCompositionDigestV1(assignments),
        inventoryDigest: CodexDevelopmentEvidenceCompositionDigestV1(binding.inventory),
        baselineArgvDigest: CodexDevelopmentEvidenceCompositionDigestV1(binding.argv),
        gitBlobClosureDigest: CodexDevelopmentEvidenceCompositionDigestV1(binding.gitBlobs),
        testedHead: binding.testedHead,
        testedTree: binding.testedTree
      };
    }),
    uncoveredScopes: [],
    gates
  };
}
