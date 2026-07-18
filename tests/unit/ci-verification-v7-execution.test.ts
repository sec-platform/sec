import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationEvidenceV3,
  type CodexDevelopmentVerificationEvidenceV3
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  CodexDevelopmentEvidenceCompositionRawDigestV1,
  CodexDevelopmentVerificationScopeV1,
  CodexDevelopmentVerificationSelectionDigestV1,
  type CodexDevelopmentEvidenceCompositionPolicyV1,
  type CodexDevelopmentExactGitBlobV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import {
  CodexDevelopmentBuildChangedInputDigestV1,
  CodexDevelopmentBuildVerificationScopeInventoryV1
} from '../../platform/shared/verification-scope-inventory.ts';
import { CodexDevelopmentCiVerificationMain } from '../../scripts/ci-verification.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);
const TESTED_HEAD = '4'.repeat(40);
const TESTED_TREE = '5'.repeat(40);
const MANIFEST_PATH = 'docs/work-packages/ci-v7-evidence-composition-bootstrap-v1.md';
const POLICY_ID = 'ci-v7-runner-execution-fixture-v1';
const WORK_PACKAGE_ID = 'ci-v7-evidence-composition-bootstrap-v1';
const EVIDENCE_PATH = 'tests/fixtures/ci-evidence-reuse/synthetic-pass.json';
const SOURCE_FILE = 'platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
const TEST_FILE = 'tests/contract/contract-freeze.test.ts';
const CHANGED_RECORDS = [
  { status: 'changed' as const, path: 'docs/test-feedback-and-ci-lanes.md' },
  { status: 'changed' as const, path: TEST_FILE }
];
const COMPOSITION_AMBIENT_ENV: NodeJS.ProcessEnv = {
  PATH: 'C:\\trusted-bin',
  SYSTEMROOT: 'C:\\Windows',
  HOME: 'C:\\fixture-home',
  TEMP: 'C:\\fixture-temp',
  CI: 'true'
};

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex');
}

const CURRENT_SOURCE = `import '../../${SOURCE_FILE}';\n`;
const CURRENT_BYTES = new TextEncoder().encode(CURRENT_SOURCE);
const BASE_BYTES = new TextEncoder().encode('base bytes\n');
const CURRENT_ENTRY: CodexDevelopmentExactGitBlobV1 = {
  blobSha: gitBlobSha(CURRENT_BYTES),
  mode: '100644',
  type: 'blob'
};
const BASE_ENTRY: CodexDevelopmentExactGitBlobV1 = {
  blobSha: gitBlobSha(BASE_BYTES),
  mode: '100644',
  type: 'blob'
};

function exactBlob(ref: string, _file: string): CodexDevelopmentExactGitBlobV1 | null {
  if (ref === HEAD) return CURRENT_ENTRY;
  if (ref === BASE || ref === TESTED_HEAD) return BASE_ENTRY;
  return null;
}

function manifestSource(): string {
  return `---
schema: codex-development-work-package-v2
id: ${WORK_PACKAGE_ID}
tracking: none
base: "${BASE}"
manifestState: frozen
evidenceComposition:
  policyId: ${POLICY_ID}
tasks:
  - id: ci-v7-bootstrap
    owner: ci-v7-writer
    ownedPaths:
      - platform/shared/ci-evidence-reuse-contract.ts
forbiddenPaths:
  - platform/compiler/unowned/
acceptance:
  - exact-composition
---

# CI V7 Runner Fixture
`;
}

function fixture() {
  const runtime = `bun@${Bun.version}`;
  const changedFiles = CHANGED_RECORDS.map((record) => record.path).sort();
  const inventory = CodexDevelopmentBuildVerificationScopeInventoryV1({
    profile: 'quick',
    changedFiles,
    runtime,
    currentHead: HEAD,
    baseHead: BASE,
    changedRecords: CHANGED_RECORDS,
    gitBlob: exactBlob,
    testImpactSourceProvider: {
      testFiles: [TEST_FILE],
      readTestSource: (testFile) => testFile === TEST_FILE ? CURRENT_SOURCE : null
    }
  });
  const affectedParent = inventory.scopes.find((scope) => scope.scopeId === 'gate:affected-tests');
  if (!affectedParent || affectedParent.refinement !== 'allowed' || affectedParent.requiredGitBlobs.length === 0) {
    throw new Error('Expected one refinable canonical affected-tests parent with exact blobs.');
  }
  const siblingArgv = [
    'bun', 'test', TEST_FILE, '--test-name-pattern',
    '^(runner sibling one|runner sibling two|runner sibling three)$'
  ];
  const siblings = ['one', 'two', 'three'].map((title, index) => CodexDevelopmentVerificationScopeV1(
    `test-title:runner-fixture:sibling-${title}`,
    runtime,
    siblingArgv,
    { parentScopeId: affectedParent.scopeId, title: `runner sibling ${title}` },
    affectedParent.requiredGitBlobs,
    affectedParent.order + index
  ));
  const deltaScope = CodexDevelopmentVerificationScopeV1(
    'test-title:runner-fixture:synthetic-heavy-delta',
    runtime,
    ['bun', 'test', TEST_FILE, '--test-name-pattern', '^runner synthetic heavy delta$'],
    { parentScopeId: affectedParent.scopeId, title: 'runner synthetic heavy delta' },
    affectedParent.requiredGitBlobs,
    affectedParent.order + siblings.length,
    { SEC_RUN_SYNTHETIC_DELTA_SENTINEL: '1' }
  );
  const refinedScopes = inventory.scopes.flatMap((scope) => (
    scope.scopeId === affectedParent.scopeId ? [...siblings, deltaScope] : [scope]
  )).map((scope, order) => ({ ...scope, order }));
  const siblingIds = new Set(siblings.map((scope) => scope.scopeId));
  const policyGates: CodexDevelopmentEvidenceCompositionPolicyV1['gates'] = [];
  for (const scope of refinedScopes) {
    if (siblingIds.has(scope.scopeId)) {
      if (policyGates.some((gate) => gate.gateId === 'runner-siblings')) continue;
      policyGates.push({
        order: policyGates.length,
        gateId: 'runner-siblings',
        disposition: 'executed',
        runtime,
        argv: [...siblingArgv],
        env: {},
        coveredScopeIds: siblings.map((sibling) => sibling.scopeId)
      });
      continue;
    }
    policyGates.push({
      order: policyGates.length,
      gateId: scope.scopeId === deltaScope.scopeId
        ? 'runner-synthetic-delta'
        : `runner-canonical-${scope.order}`,
      disposition: scope.scopeId === deltaScope.scopeId ? 'delta' : 'executed',
      runtime,
      argv: [...scope.argv],
      env: { ...scope.env },
      coveredScopeIds: [scope.scopeId]
    });
  }
  const evidenceIdentity = 'runner-fixture-pass-v1';
  const evidenceSource = `${JSON.stringify({
    schemaVersion: '1',
    recordType: 'frozen-exact-production-pass-evidence',
    identity: evidenceIdentity,
    status: 'PASS',
    testedHead: TESTED_HEAD,
    testedTree: TESTED_TREE,
    runtime: { version: Bun.version },
    execution: { argv: deltaScope.argv, rerunAllowed: false }
  }, null, 2)}\n`;
  const evidenceEntry = {
    blobSha: gitBlobSha(new TextEncoder().encode(evidenceSource)),
    mode: '100644' as const,
    type: 'blob' as const
  };
  const policy: CodexDevelopmentEvidenceCompositionPolicyV1 = {
    policyRevision: 'codex-development-evidence-composition-policy-v1',
    policyId: POLICY_ID,
    workPackageId: WORK_PACKAGE_ID,
    ciRevision: 'ci-verification-v7',
    requiredProfile: 'quick',
    parentSelectionDigest: inventory.fullSelectionDigest,
    fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1(
      'quick',
      inventory.fullChangedFiles,
      refinedScopes,
      inventory.fullChangedInputDigest
    ),
    refinements: [{
      parentScopeId: affectedParent.scopeId,
      parentInventoryDigest: affectedParent.inventoryDigest,
      scopes: [...siblings, deltaScope]
    }],
    assignments: refinedScopes.map((scope) => ({
      scopeId: scope.scopeId,
      inventoryDigest: scope.inventoryDigest,
      disposition: scope.scopeId === deltaScope.scopeId ? 'delta' as const : 'executed' as const,
      evidenceIdentity: scope.scopeId === deltaScope.scopeId ? evidenceIdentity : null,
      gateId: siblingIds.has(scope.scopeId)
        ? 'runner-siblings'
        : scope.scopeId === deltaScope.scopeId
          ? 'runner-synthetic-delta'
          : `runner-canonical-${scope.order}`
    })),
    gates: policyGates,
    reusedEvidence: [{
      evidenceFormat: 'legacy-frozen-exact-production-pass-v1-env-unbound',
      evidenceIdentity,
      evidencePath: EVIDENCE_PATH,
      evidenceDigest: CodexDevelopmentEvidenceCompositionRawDigestV1(evidenceSource),
      evidenceBlobSha: evidenceEntry.blobSha,
      evidenceMode: evidenceEntry.mode,
      evidenceType: evidenceEntry.type,
      environmentBinding: 'legacy-unbound-v1',
      scopeBinding: 'base-policy-exact-v1',
      expandable: false,
      recordType: 'frozen-exact-production-pass-evidence',
      status: 'PASS',
      rerunAllowed: false,
      testedHead: TESTED_HEAD,
      testedTree: TESTED_TREE,
      runtime,
      argv: [...deltaScope.argv],
      gitBlobs: deltaScope.requiredGitBlobs.map((entry, index) => ({
        id: `runner-input-${index.toString().padStart(4, '0')}`,
        testedPath: entry.path,
        testedBlobSha: BASE_ENTRY.blobSha,
        testedMode: BASE_ENTRY.mode,
        testedType: BASE_ENTRY.type,
        currentPath: entry.path,
        currentBlobSha: entry.blobSha,
        currentMode: entry.mode,
        currentType: entry.type
      })),
      inventory: [{
        scopeId: deltaScope.scopeId,
        inventoryDigest: deltaScope.inventoryDigest,
        gitBlobIds: deltaScope.requiredGitBlobs.map((_, index) => (
          `runner-input-${index.toString().padStart(4, '0')}`
        ))
      }]
    }]
  };
  const plan = CodexDevelopmentBuildEvidenceCompositionPlanV1({
    policyId: POLICY_ID,
    workPackageId: WORK_PACKAGE_ID,
    ciRevision: 'ci-verification-v7',
    profile: 'quick',
    inventory,
    runtime,
    currentHead: HEAD,
    currentTree: TREE,
    executionEnvironment: COMPOSITION_AMBIENT_ENV,
    gitBlob: (ref, file) => ref === HEAD && file === EVIDENCE_PATH ? evidenceEntry : exactBlob(ref, file),
    gitTree: (ref) => ref === HEAD ? TREE : ref === TESTED_HEAD ? TESTED_TREE : null,
    readEvidence: () => ({
      ...evidenceEntry,
      bytes: new TextEncoder().encode(evidenceSource)
    }),
    resolvePolicy: () => structuredClone(policy)
  });
  return { evidenceEntry, evidenceSource, inventory, plan, policy };
}

test('V2 runner preserves canonical gates, replaces aggregate selectors, binds delta env, and writes V3', async () => {
  const { evidenceEntry, evidenceSource, inventory, plan, policy } = fixture();
  const runCalls: Array<{ id: string; argv: string[]; env: NodeJS.ProcessEnv }> = [];
  let written: CodexDevelopmentVerificationEvidenceV3 | undefined;
  let tick = 0;
  const result = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: 'base-ref',
      SEC_AFFECTED_TESTS_BASE: 'base-ref',
      SEC_WORK_PACKAGE_MANIFEST_PATH: MANIFEST_PATH,
      SEC_RUN_SM3_PRODUCTION_SENTINEL: 'untrusted-inherited-value',
      PATH: 'C:\\trusted-bin',
      SYSTEMROOT: 'C:\\Windows',
      HOME: 'C:\\fixture-home',
      TEMP: 'C:\\fixture-temp',
      CI: 'true',
      NODE_OPTIONS: '--require=untrusted.js',
      BUN_OPTIONS: '--preload=untrusted.ts',
      BUN_INSTALL: 'C:\\untrusted-bun',
      HTTPS_PROXY: 'http://untrusted-proxy',
      HTTP_PROXY: 'http://untrusted-proxy',
      NO_PROXY: '*',
      PLAYWRIGHT_BROWSERS_PATH: 'C:\\untrusted-browser',
      GITHUB_TOKEN: 'untrusted-secret',
      RUNNER_TEMP: 'C:\\untrusted-runner',
      FOO: 'untrusted-arbitrary'
    },
    now: () => new Date(Date.UTC(2026, 6, 18, 0, 0, 0, tick++ * 10)),
    gitRevision: (ref) => {
      if (ref === 'HEAD') return HEAD;
      if (ref === 'HEAD^{tree}') return TREE;
      if (ref === 'HEAD^1' || ref === 'base-ref') return BASE;
      if (ref === HEAD) return HEAD;
      if (ref === `${HEAD}^{tree}`) return TREE;
      if (ref === TESTED_HEAD) return TESTED_HEAD;
      if (ref === `${TESTED_HEAD}^{tree}`) return TESTED_TREE;
      return null;
    },
    trackedTreeIsClean: () => true,
    changedRecords: () => [...CHANGED_RECORDS],
    gitFiles: () => [TEST_FILE],
    gitBlob: (ref, file) => ref === HEAD && file === EVIDENCE_PATH ? evidenceEntry : exactBlob(ref, file),
    readGitBlob: (ref, file) => {
      if (ref === HEAD && file === EVIDENCE_PATH) {
        return { ...evidenceEntry, bytes: new TextEncoder().encode(evidenceSource) };
      }
      const entry = exactBlob(ref, file);
      return entry ? { ...entry, bytes: CURRENT_BYTES } : null;
    },
    readManifestBytes: () => new TextEncoder().encode(manifestSource()),
    resolvePolicy: () => structuredClone(policy),
    runGate: async (step) => {
      runCalls.push({ id: step.id, argv: [...step.argv], env: { ...step.env } });
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidenceV3: (_path, evidence) => { written = evidence; }
  });

  expect(result).toBe(0);
  expect(written?.schema).toBe('codex-development-verification-evidence-v3');
  const scopeById = new Map(inventory.scopes.map((scope) => [scope.scopeId, scope]));
  expect(scopeById.get('gate:affected-tests')).toMatchObject({
    argv: ['bun', 'run', 'test:affected'],
    refinement: 'allowed'
  });
  for (const argv of [
    ['bun', 'run', 'imports:check'],
    ['bun', 'run', 'docs:doctor'],
    ['bun', 'run', 'typecheck']
  ]) {
    expect(runCalls.some((call) => JSON.stringify(call.argv) === JSON.stringify(argv))).toBe(true);
  }
  expect(runCalls.some((call) => call.argv.includes('test:affected'))).toBe(false);
  expect(runCalls.filter((call) => call.id === 'runner-siblings')).toHaveLength(1);
  const delta = runCalls.find((call) => call.env.SEC_RUN_SYNTHETIC_DELTA_SENTINEL === '1');
  expect(delta?.id).toBe('runner-synthetic-delta');
  expect(delta?.env.SEC_TEST_WORKSPACE_NAMESPACE).toBe('verification-runner-synthetic-delta');
  expect(runCalls.every((call) => call.env.SEC_RUN_SM3_PRODUCTION_SENTINEL === undefined)).toBe(true);
  expect(runCalls.every((call) => !call.argv.some((arg) => (
    /playwright|test:slow|--suite|ci-pr-risk/iu.test(arg)
  )))).toBe(true);
  expect(runCalls.every((call) => /^verification-/u.test(call.env.SEC_TEST_WORKSPACE_NAMESPACE ?? ''))).toBe(true);
  const expectedBaseEnvironmentKeys = [
    'CI', 'HOME', 'LANG', 'LC_ALL', 'NO_COLOR', 'PATH', 'SEC_TEST_WORKSPACE_NAMESPACE',
    'SYSTEMROOT', 'TEMP', 'TZ'
  ];
  for (const call of runCalls) {
    const expectedKeys = call.id === 'runner-synthetic-delta'
      ? [...expectedBaseEnvironmentKeys, 'SEC_RUN_SYNTHETIC_DELTA_SENTINEL'].sort()
      : [...expectedBaseEnvironmentKeys].sort();
    expect(Object.keys(call.env)).toEqual(expectedKeys);
  }
  expect(() => CodexDevelopmentAssertVerificationEvidenceV3(
    written,
    { plan },
    new Date('2026-07-18T00:00:00.000Z')
  )).not.toThrow();
});

test('changed-input digest is content-addressed across rebases while retaining exact entries', () => {
  const baseRefs = new Set(['a'.repeat(40), 'b'.repeat(40)]);
  const currentRefs = new Set(['c'.repeat(40), 'd'.repeat(40)]);
  const digest = (baseHead: string, currentHead: string, currentMode: '100644' | '100755' = '100644') => (
    CodexDevelopmentBuildChangedInputDigestV1({
      records: [{ status: 'changed', path: SOURCE_FILE }],
      baseHead,
      currentHead,
      gitBlob: (ref) => baseRefs.has(ref)
        ? BASE_ENTRY
        : currentRefs.has(ref)
          ? { ...CURRENT_ENTRY, mode: currentMode }
          : null
    })
  );

  expect(digest('a'.repeat(40), 'c'.repeat(40))).toBe(digest('b'.repeat(40), 'd'.repeat(40)));
  expect(digest('a'.repeat(40), 'c'.repeat(40))).not.toBe(
    digest('a'.repeat(40), 'c'.repeat(40), '100755')
  );
});

test('V2 runner rejects a drifted base policy before the first subprocess spawn', async () => {
  const { evidenceEntry, evidenceSource, policy } = fixture();
  const drifted = structuredClone(policy);
  drifted.parentSelectionDigest = `sha256:${'0'.repeat(64)}`;
  let spawnCount = 0;
  const result = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: 'base-ref',
      SEC_AFFECTED_TESTS_BASE: 'base-ref',
      SEC_WORK_PACKAGE_MANIFEST_PATH: MANIFEST_PATH
    },
    now: () => new Date('2026-07-18T00:00:00.000Z'),
    gitRevision: (ref) => {
      if (ref === 'HEAD') return HEAD;
      if (ref === 'HEAD^{tree}') return TREE;
      if (ref === 'HEAD^1' || ref === 'base-ref') return BASE;
      if (ref === HEAD) return HEAD;
      if (ref === `${HEAD}^{tree}`) return TREE;
      if (ref === TESTED_HEAD) return TESTED_HEAD;
      if (ref === `${TESTED_HEAD}^{tree}`) return TESTED_TREE;
      return null;
    },
    trackedTreeIsClean: () => true,
    changedRecords: () => [...CHANGED_RECORDS],
    gitFiles: () => [TEST_FILE],
    gitBlob: (ref, file) => ref === HEAD && file === EVIDENCE_PATH ? evidenceEntry : exactBlob(ref, file),
    readGitBlob: (ref, file) => {
      if (ref === HEAD && file === EVIDENCE_PATH) {
        return { ...evidenceEntry, bytes: new TextEncoder().encode(evidenceSource) };
      }
      const entry = exactBlob(ref, file);
      return entry ? { ...entry, bytes: CURRENT_BYTES } : null;
    },
    readManifestBytes: () => new TextEncoder().encode(manifestSource()),
    resolvePolicy: () => drifted,
    runGate: async () => {
      spawnCount += 1;
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidenceV3: () => undefined
  });

  expect(result).toBe(1);
  expect(spawnCount).toBe(0);
});
