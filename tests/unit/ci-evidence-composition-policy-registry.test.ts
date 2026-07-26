import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentRegisteredEvidenceCompositionPolicyV1,
  CodexDevelopmentRequiredEvidenceCompositionPolicyV1,
  CodexDevelopmentSm3P0EvidencePolicyIdV1,
  CodexDevelopmentSm3P0WorkPackageIdV1
} from '../../platform/shared/ci-evidence-composition-policy-registry.ts';
import type { CodexDevelopmentVerificationEvidenceV3 } from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentBuildEvidenceCompositionPlanV1,
  CodexDevelopmentEvidenceCompositionDigestV1,
  CodexDevelopmentVerificationScopeV1,
  CodexDevelopmentVerificationSelectionDigestV1,
  type CodexDevelopmentExactGitBlobBytesV1,
  type CodexDevelopmentExactGitBlobV1,
  type CodexDevelopmentVerificationScopeInventoryV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import { parseGitChangedRecordsOutput } from '../../platform/shared/ci-git-changed-files.ts';
import { CodexDevelopmentCiVerificationMain } from '../../scripts/ci-verification.ts';

const BASE = '01d5c45a573337bee484d6a9d2effb2a76787b86';
const CURRENT = 'ab5d3a839afc1d595ae5c43437eb862cde1500c1';
const TESTED = '514e6e401659f18ecffca19856a11354d66d05df';
const EVIDENCE_PATH =
  'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json';
const APPLY_TEST = 'tests/integration/semantic-mutation-apply.test.ts';
const WRAPPER_TEST = 'tests/integration/semantic-mutation-production-sentinel.test.ts';
const RUN_RUNTIME = 'platform/compiler/verify/run-runtime-verification.ts';
const INVOCATION_CONTRACT = 'platform/compiler/verify/runtime-verification-invocation-contract.ts';
const RUNTIME_PLAN = 'platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
const RUNTIME_VERIFICATION_TEST = 'tests/unit/runtime-verification.test.ts';
const ISOLATED_CHILD_TEST = 'tests/unit/semantic-mutation-isolated-child-fence.test.ts';
const BASE_RUN_RUNTIME_BLOB = 'd9c8bf6e3d361146873eb54122c02873f5e8f762';
const ANTICIPATED_RUN_RUNTIME_BLOB = '9173cd35533db0317812039eedb0ba68204846ef';
const ANTICIPATED_INVOCATION_CONTRACT_BLOB = '65e4f7eee2e9ac5b1c5afe8d2dfddaaa3be06661';
const BASE_RUNTIME_PLAN_BLOB = '9b84e7da441bd95dcaef171ea1cf4cd4c1e2ee58';
const ANTICIPATED_RUNTIME_PLAN_BLOB = 'b2e0cef5148d9411d1000e7a6ace9b82cb0cfe34';
const BASE_RUNTIME_VERIFICATION_TEST_BLOB = 'ad902e8d14f15f6886b147e588c6febdbea4fe6b';
const ANTICIPATED_RUNTIME_VERIFICATION_TEST_BLOB = '8b84a253daa8fce0ae7cf770bc134e1d202fe72a';
const BASE_ISOLATED_CHILD_TEST_BLOB = '56c89b78f7a51ceb84eaf59630f4cbae163b8681';
const ANTICIPATED_ISOLATED_CHILD_TEST_BLOB = 'a77d1d23c5b75d751ef39c0b8a0e81909486136c';
const TEST_IMPACT_TEST = 'tests/contract/test-impact.test.ts';
const PREVIOUS_TEST_IMPACT_BLOB = 'c7fe5d1e90a9ca31884cb39b873c2f564b789ea6';
const ANTICIPATED_TEST_IMPACT_BLOB = '5d7da4f7df39bd18ba4acff5263c6166557f1459';
const RISK_FILES = [
  'tests/e2e/end-to-end.test.ts',
  'tests/e2e/graph.test.ts',
  'tests/e2e/local-views.test.ts',
  'tests/e2e/pipeline.test.ts',
  'tests/e2e/registry.test.ts',
  'tests/e2e/semantic-runtime-contract.test.ts',
  'tests/e2e/verification.test.ts'
];

function git(args: string[], encoding: 'utf8'): string;
function git(args: string[], encoding: 'buffer'): Uint8Array;
function git(args: string[], encoding: 'utf8' | 'buffer'): string | Uint8Array {
  const result = spawnSync('git', args, { encoding });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return encoding === 'utf8'
    ? String(result.stdout)
    : new Uint8Array(result.stdout as Buffer);
}

function tree(ref: string): Map<string, CodexDevelopmentExactGitBlobV1> {
  const entries = git(['ls-tree', '-r', '-z', '--full-tree', ref], 'utf8').split('\0').filter(Boolean);
  const result = new Map<string, CodexDevelopmentExactGitBlobV1>();
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(entry);
    if (match) result.set(match[3]!, {
      mode: match[1] as '100644' | '100755',
      type: 'blob',
      blobSha: match[2]!
    });
  }
  return result;
}

const TREES = new Map([
  [BASE, tree(BASE)],
  [CURRENT, tree(CURRENT)],
  [TESTED, tree(TESTED)]
]);
const TREE_IDS = new Map([
  [BASE, git(['rev-parse', `${BASE}^{tree}`], 'utf8').trim()],
  [CURRENT, git(['rev-parse', `${CURRENT}^{tree}`], 'utf8').trim()],
  [TESTED, git(['rev-parse', `${TESTED}^{tree}`], 'utf8').trim()]
]);

function gitBlob(ref: string, path: string): CodexDevelopmentExactGitBlobV1 | null {
  if (ref === CURRENT && path === RUN_RUNTIME) {
    return { blobSha: ANTICIPATED_RUN_RUNTIME_BLOB, mode: '100644', type: 'blob' };
  }
  if (ref === CURRENT && path === INVOCATION_CONTRACT) {
    return { blobSha: ANTICIPATED_INVOCATION_CONTRACT_BLOB, mode: '100644', type: 'blob' };
  }
  if (ref === CURRENT && path === RUNTIME_PLAN) {
    return { blobSha: ANTICIPATED_RUNTIME_PLAN_BLOB, mode: '100644', type: 'blob' };
  }
  if (ref === CURRENT && path === RUNTIME_VERIFICATION_TEST) {
    return { blobSha: ANTICIPATED_RUNTIME_VERIFICATION_TEST_BLOB, mode: '100644', type: 'blob' };
  }
  if (ref === CURRENT && path === ISOLATED_CHILD_TEST) {
    return { blobSha: ANTICIPATED_ISOLATED_CHILD_TEST_BLOB, mode: '100644', type: 'blob' };
  }
  if (ref === CURRENT && path === TEST_IMPACT_TEST) {
    return { blobSha: ANTICIPATED_TEST_IMPACT_BLOB, mode: '100644', type: 'blob' };
  }
  return TREES.get(ref)?.get(path) ?? null;
}

function gitBlobDigest(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

function exactBytes(ref: string, path: string): CodexDevelopmentExactGitBlobBytesV1 | null {
  const entry = gitBlob(ref, path);
  if (!entry) return null;
  return {
    ...entry,
    bytes: git(['cat-file', 'blob', `${ref}:${path}`], 'buffer')
  };
}

const RECORDS = [
  ...parseGitChangedRecordsOutput(git([
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames', '--find-copies',
    '--diff-filter=ACDMRTUXB', BASE, CURRENT
  ], 'buffer') as Uint8Array),
  { status: 'changed' as const, path: RUN_RUNTIME },
  { status: 'added' as const, path: INVOCATION_CONTRACT },
  { status: 'changed' as const, path: RUNTIME_PLAN },
  { status: 'changed' as const, path: RUNTIME_VERIFICATION_TEST }
];
const CHANGED_FILES = [...new Set(RECORDS.flatMap((record) => (
  record.previousPath === undefined ? [record.path] : [record.previousPath, record.path]
)))].sort();

function required(paths: string[]) {
  return [...paths].sort().map((path) => {
    const entry = gitBlob(CURRENT, path);
    if (!entry) throw new Error(`Missing fixture blob ${path}`);
    return { path, ...entry };
  });
}

function inventory(changedInput = 'fixture-a'): CodexDevelopmentVerificationScopeInventoryV1 {
  const fullChangedInputDigest = CodexDevelopmentEvidenceCompositionDigestV1({ changedInput });
  const scopes = [
    CodexDevelopmentVerificationScopeV1('gate:imports', 'bun@1.3.14', ['bun', 'run', 'imports:check'], {}, [], 0),
    CodexDevelopmentVerificationScopeV1('gate:docs-doctor', 'bun@1.3.14', ['bun', 'run', 'docs:doctor'], {}, [], 1),
    CodexDevelopmentVerificationScopeV1('gate:typecheck', 'bun@1.3.14', ['bun', 'run', 'typecheck'], {}, [], 2),
    CodexDevelopmentVerificationScopeV1(
      'gate:affected-tests',
      'bun@1.3.14',
      ['bun', 'run', 'test:affected'],
      { kind: 'fixture-affected' },
      required([
        'tests/contract/semantic-mutation-apply-contract.test.ts',
        APPLY_TEST,
        WRAPPER_TEST,
        RUNTIME_VERIFICATION_TEST,
        ISOLATED_CHILD_TEST
      ]),
      3,
      {},
      'allowed'
    ),
    CodexDevelopmentVerificationScopeV1(
      'gate:impact-risk',
      'bun@1.3.14',
      ['bun', 'scripts/ci-pr-risk.ts'],
      { kind: 'fixture-risk', files: RISK_FILES },
      required(RISK_FILES),
      4,
      {},
      'allowed'
    )
  ];
  return {
    profile: 'quick',
    fullChangedFiles: [...CHANGED_FILES],
    fullChangedInputDigest,
    fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1(
      'quick', CHANGED_FILES, scopes, fullChangedInputDigest
    ),
    scopes
  };
}

test('protected P0 product transition requires its exact V2 base policy and rejects drift', () => {
  expect(CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
    records: RECORDS,
    baseHead: BASE,
    currentHead: CURRENT,
    gitBlob
  })).toBe(CodexDevelopmentSm3P0EvidencePolicyIdV1);

  expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
    records: RECORDS,
    baseHead: BASE,
    currentHead: CURRENT,
    gitBlob: (ref, path) => ref === CURRENT && path.endsWith('run-semantic-mutation-isolated-child.ts')
      ? { blobSha: 'f'.repeat(40), mode: '100644', type: 'blob' }
      : gitBlob(ref, path)
  })).toThrow('Git identity mismatch');

  for (const [path, blobSha] of [
    [RUN_RUNTIME, BASE_RUN_RUNTIME_BLOB],
    [INVOCATION_CONTRACT, 'f'.repeat(40)],
    [RUNTIME_PLAN, BASE_RUNTIME_PLAN_BLOB],
    [RUNTIME_VERIFICATION_TEST, BASE_RUNTIME_VERIFICATION_TEST_BLOB],
    [ISOLATED_CHILD_TEST, BASE_ISOLATED_CHILD_TEST_BLOB]
  ] as const) {
    expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
      records: RECORDS,
      baseHead: BASE,
      currentHead: CURRENT,
      gitBlob: (ref, candidatePath) => ref === CURRENT && candidatePath === path
        ? { blobSha, mode: '100644', type: 'blob' }
        : gitBlob(ref, candidatePath)
    })).toThrow('Git identity mismatch');
  }

  for (const [path, blobSha] of [
    [RUN_RUNTIME, ANTICIPATED_RUN_RUNTIME_BLOB],
    [INVOCATION_CONTRACT, ANTICIPATED_INVOCATION_CONTRACT_BLOB],
    [RUNTIME_PLAN, ANTICIPATED_RUNTIME_PLAN_BLOB],
    [RUNTIME_VERIFICATION_TEST, ANTICIPATED_RUNTIME_VERIFICATION_TEST_BLOB],
    [ISOLATED_CHILD_TEST, ANTICIPATED_ISOLATED_CHILD_TEST_BLOB]
  ] as const) {
    for (const entry of [
      { blobSha, mode: '100755' as const, type: 'blob' as const },
      { blobSha, mode: '100644' as const, type: 'tree' as 'blob' }
    ]) {
      expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
        records: RECORDS,
        baseHead: BASE,
        currentHead: CURRENT,
        gitBlob: (ref, candidatePath) => ref === CURRENT && candidatePath === path
          ? entry
          : gitBlob(ref, candidatePath)
      })).toThrow('Git identity mismatch');
    }
  }

  for (const path of [
    RUN_RUNTIME,
    INVOCATION_CONTRACT,
    RUNTIME_PLAN,
    RUNTIME_VERIFICATION_TEST,
    ISOLATED_CHILD_TEST
  ]) {
    expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
      records: RECORDS.filter((record) => record.path !== path),
      baseHead: BASE,
      currentHead: CURRENT,
      gitBlob
    })).toThrow('record mismatch');

    expect(CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
      records: RECORDS,
      baseHead: BASE,
      currentHead: CURRENT,
      gitBlob: (ref, candidatePath) => ref === BASE && candidatePath === path
        ? { blobSha: 'f'.repeat(40), mode: '100644', type: 'blob' }
        : gitBlob(ref, candidatePath)
    })).toBeNull();
  }

  expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
    records: RECORDS,
    baseHead: BASE,
    currentHead: CURRENT,
    gitBlob: (ref, path) => ref === CURRENT && path === TEST_IMPACT_TEST
      ? { blobSha: PREVIOUS_TEST_IMPACT_BLOB, mode: '100644', type: 'blob' }
      : gitBlob(ref, path)
  })).toThrow('Git identity mismatch');

  for (const entry of [
    { blobSha: ANTICIPATED_TEST_IMPACT_BLOB, mode: '100755' as const, type: 'blob' as const },
    { blobSha: ANTICIPATED_TEST_IMPACT_BLOB, mode: '100644' as const, type: 'tree' as 'blob' }
  ]) {
    expect(() => CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
      records: RECORDS,
      baseHead: BASE,
      currentHead: CURRENT,
      gitBlob: (ref, path) => ref === CURRENT && path === TEST_IMPACT_TEST
        ? entry
        : gitBlob(ref, path)
    })).toThrow('Git identity mismatch');
  }

  expect(CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
    records: RECORDS,
    baseHead: BASE,
    currentHead: CURRENT,
    gitBlob: (ref, path) => ref === BASE && path === TEST_IMPACT_TEST
      ? { blobSha: 'f'.repeat(40), mode: '100644', type: 'blob' }
      : gitBlob(ref, path)
  })).toBeNull();

  expect(CodexDevelopmentRequiredEvidenceCompositionPolicyV1({
    records: RECORDS,
    baseHead: CURRENT,
    currentHead: CURRENT,
    gitBlob
  })).toBeNull();
});

test('protected P0 transition pins the one tombstone-owner correction and preserves every other byte', () => {
  const previous = git(['cat-file', 'blob', PREVIOUS_TEST_IMPACT_BLOB], 'buffer');
  const previousText = new TextDecoder('utf-8', { fatal: true }).decode(previous);
  const oldAssertion = "expect(selection.owners).toEqual(['auto-reference', 'semantic-mutation']);";
  const newAssertion = "expect(selection.owners).toEqual(['semantic-mutation']);";
  expect(previousText.split(oldAssertion)).toHaveLength(2);

  const anticipatedText = previousText.replace(oldAssertion, newAssertion);
  const anticipated = new TextEncoder().encode(anticipatedText);
  expect(gitBlobDigest(anticipated)).toBe(ANTICIPATED_TEST_IMPACT_BLOB);
  expect(anticipatedText.replace(newAssertion, oldAssertion)).toBe(previousText);
  expect(anticipatedText).toContain("expect(selection.owners).toEqual(['auto-reference', 'windows-appcontainer-hardening']);");
});

test('live P0 policy derives candidate digests and emits only explicit direct gates', () => {
  const firstInventory = inventory('rebase-a');
  const first = CodexDevelopmentRegisteredEvidenceCompositionPolicyV1({
    policyId: CodexDevelopmentSm3P0EvidencePolicyIdV1,
    workPackageId: CodexDevelopmentSm3P0WorkPackageIdV1,
    inventory: firstInventory,
    runtime: 'bun@1.3.14',
    currentHead: CURRENT,
    gitBlob
  });
  const secondInventory = inventory('rebase-b');
  const second = CodexDevelopmentRegisteredEvidenceCompositionPolicyV1({
    policyId: CodexDevelopmentSm3P0EvidencePolicyIdV1,
    workPackageId: CodexDevelopmentSm3P0WorkPackageIdV1,
    inventory: secondInventory,
    runtime: 'bun@1.3.14',
    currentHead: CURRENT,
    gitBlob
  });
  expect(first.parentSelectionDigest).toBe(firstInventory.fullSelectionDigest);
  expect(second.parentSelectionDigest).toBe(secondInventory.fullSelectionDigest);
  expect(second.parentSelectionDigest).not.toBe(first.parentSelectionDigest);
  expect(first.gates.some((gate) => gate.argv.includes('scripts/ci-pr-risk.ts'))).toBe(false);
  expect(first.gates.some((gate) => gate.argv.includes('test:affected'))).toBe(false);
  expect(first.gates.some((gate) => gate.argv.some((part) => /playwright/iu.test(part)))).toBe(false);
  expect(first.gates.find((gate) => gate.gateId === 'sm3-p0-production-delta')?.env).toEqual({
    SEC_RUN_SM3_PRODUCTION_SENTINEL: '1'
  });
  expect(first.refinements.flatMap(({ scopes }) => scopes)
    .find(({ scopeId }) => scopeId === 'sm3-p0:production-delta')?.requiredGitBlobs)
    .toEqual(expect.arrayContaining([
      { path: RUN_RUNTIME, blobSha: ANTICIPATED_RUN_RUNTIME_BLOB, mode: '100644', type: 'blob' },
      {
        path: INVOCATION_CONTRACT,
        blobSha: ANTICIPATED_INVOCATION_CONTRACT_BLOB,
        mode: '100644',
        type: 'blob'
      },
      { path: RUNTIME_PLAN, blobSha: ANTICIPATED_RUNTIME_PLAN_BLOB, mode: '100644', type: 'blob' },
      {
        path: RUNTIME_VERIFICATION_TEST,
        blobSha: ANTICIPATED_RUNTIME_VERIFICATION_TEST_BLOB,
        mode: '100644',
        type: 'blob'
      },
      {
        path: ISOLATED_CHILD_TEST,
        blobSha: ANTICIPATED_ISOLATED_CHILD_TEST_BLOB,
        mode: '100644',
        type: 'blob'
      }
    ]));

  const plan = CodexDevelopmentBuildEvidenceCompositionPlanV1({
    policyId: CodexDevelopmentSm3P0EvidencePolicyIdV1,
    workPackageId: CodexDevelopmentSm3P0WorkPackageIdV1,
    ciRevision: 'ci-verification-v7',
    profile: 'quick',
    inventory: firstInventory,
    runtime: 'bun@1.3.14',
    currentHead: CURRENT,
    currentTree: TREE_IDS.get(CURRENT)!,
    gitBlob,
    gitTree: (ref) => TREE_IDS.get(ref) ?? null,
    readEvidence: (ref, path) => path === EVIDENCE_PATH ? exactBytes(ref, path) : null,
    executionEnvironment: { PATH: 'C:\\trusted-bin', SYSTEMROOT: 'C:\\Windows', CI: 'true' },
    resolvePolicy: () => first
  });
  expect(plan.uncoveredScopes).toEqual([]);
  expect(plan.coverageLedger.filter(({ disposition }) => disposition === 'delta')).toHaveLength(1);
  expect(plan.gates.map(({ gateId }) => gateId)).toEqual(first.gates.map(({ gateId }) => gateId));
  expect(plan.reusedEvidence).toEqual([
    expect.objectContaining({
      evidenceIdentity: 'sm3-p0-exact-production-seam-single-job-owner-durable-v4',
      environmentBinding: 'legacy-unbound-v1',
      expandable: false,
      testedHead: TESTED
    })
  ]);
});

function manifest(
  schema: 'v1' | 'v2',
  policyId: string = CodexDevelopmentSm3P0EvidencePolicyIdV1
): string {
  const versionFields = schema === 'v1'
    ? 'requiredProfile: quick\nciRevision: ci-verification-v14\n'
    : `evidenceComposition:\n  policyId: ${policyId}\n`;
  return `---
schema: codex-development-work-package-${schema}
id: ${CodexDevelopmentSm3P0WorkPackageIdV1}
tracking: issue-106
base: "${BASE}"
manifestState: frozen
${versionFields}tasks:
  - id: sm3-p0
    owner: sm3-writer
    ownedPaths:
      - platform/compiler/verify/
forbiddenPaths:
  - .github/workflows/
acceptance:
  - exact-policy
${schema === 'v1' ? 'tests:\n  - bun run typecheck\n' : ''}---

# SM3 P0 fixture
`;
}

test('runner rejects V1 and wrong-policy V2 downgrade before the first gate', async () => {
  for (const source of [manifest('v1'), manifest('v2', 'wrong-policy')]) {
    let spawnCount = 0;
    const result = await CodexDevelopmentCiVerificationMain({
      argv: ['--profile', 'quick', '--expected-head', CURRENT],
      env: {
        SEC_CHANGED_BASE: 'base-ref',
        SEC_AFFECTED_TESTS_BASE: 'base-ref',
        SEC_WORK_PACKAGE_MANIFEST_PATH: `docs/work-packages/${CodexDevelopmentSm3P0WorkPackageIdV1}.md`
      },
      gitRevision: (ref) => {
        if (ref === 'HEAD') return CURRENT;
        if (ref === 'HEAD^{tree}') return TREE_IDS.get(CURRENT)!;
        if (ref === 'HEAD^1' || ref === 'base-ref') return BASE;
        if (TREE_IDS.has(ref)) return ref;
        const treeRef = /^(?<commit>[0-9a-f]{40})\^\{tree\}$/u.exec(ref)?.groups?.commit;
        return treeRef ? TREE_IDS.get(treeRef) ?? null : null;
      },
      trackedTreeIsClean: () => true,
      changedRecords: () => [...RECORDS],
      gitBlob,
      readManifestBytes: () => new TextEncoder().encode(source),
      runGate: async () => {
        spawnCount += 1;
        return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
      },
      writeEvidence: () => undefined,
      writeEvidenceV3: () => undefined
    });
    expect(result).toBe(1);
    expect(spawnCount).toBe(0);
  }
});

test('runner resolves the real P0 registry and executes its exact direct gate plan once', async () => {
  const calls: Array<{ id: string; argv: string[]; env: NodeJS.ProcessEnv }> = [];
  let written: CodexDevelopmentVerificationEvidenceV3 | undefined;
  const runnerTestFiles = [
    'tests/contract/semantic-mutation-apply-contract.test.ts',
    APPLY_TEST,
    WRAPPER_TEST,
    RUNTIME_VERIFICATION_TEST,
    ISOLATED_CHILD_TEST,
    ...RISK_FILES
  ];
  const syntheticTestSource = new TextEncoder().encode(RECORDS
    .flatMap((record) => {
      if (record.path.startsWith('platform/') && record.path.endsWith('.ts')) {
        return [`import '../../${record.path}';`];
      }
      if (record.path.startsWith('tests/helpers/') && record.path.endsWith('.ts')) {
        return [`import '../helpers/${record.path.slice('tests/helpers/'.length)}';`];
      }
      return [];
    })
    .join('\n'));
  const result = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', CURRENT],
    env: {
      SEC_CHANGED_BASE: 'base-ref',
      SEC_AFFECTED_TESTS_BASE: 'base-ref',
      SEC_WORK_PACKAGE_MANIFEST_PATH: `docs/work-packages/${CodexDevelopmentSm3P0WorkPackageIdV1}.md`,
      PATH: 'C:\\trusted-bin',
      SYSTEMROOT: 'C:\\Windows',
      CI: 'true'
    },
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 6, 18, 0, 0, 0, tick++ * 10));
    })(),
    gitRevision: (ref) => {
      if (ref === 'HEAD') return CURRENT;
      if (ref === 'HEAD^{tree}') return TREE_IDS.get(CURRENT)!;
      if (ref === 'HEAD^1' || ref === 'base-ref') return BASE;
      if (TREE_IDS.has(ref)) return ref;
      const treeRef = /^(?<commit>[0-9a-f]{40})\^\{tree\}$/u.exec(ref)?.groups?.commit;
      return treeRef ? TREE_IDS.get(treeRef) ?? null : null;
    },
    trackedTreeIsClean: () => true,
    changedRecords: () => [...RECORDS],
    gitFiles: (ref) => ref === CURRENT ? runnerTestFiles : null,
    gitBlob,
    readGitBlob: (ref, path) => {
      if (ref === CURRENT && runnerTestFiles.includes(path)) {
        const entry = gitBlob(ref, path);
        return entry ? { ...entry, bytes: syntheticTestSource } : null;
      }
      return path === EVIDENCE_PATH ? exactBytes(ref, path) : null;
    },
    readManifestBytes: () => new TextEncoder().encode(manifest('v2')),
    runGate: async (step) => {
      calls.push({ id: step.id, argv: [...step.argv], env: { ...step.env } });
      return { code: 0, rawOutputDigest: `sha256:${'0'.repeat(64)}`, failureTail: '' };
    },
    writeEvidenceV3: (_path, evidence) => { written = evidence; }
  });

  expect(result).toBe(0);
  expect(written).toBeDefined();
  expect(written?.schema).toBe('codex-development-verification-evidence-v3');
  expect(written?.policyId).toBe(CodexDevelopmentSm3P0EvidencePolicyIdV1);
  expect(calls.map(({ id }) => id)).toEqual(
    written!.gates.map(({ id }) => id)
  );
  expect(calls.filter(({ id }) => id === 'sm3-p0-siblings')).toHaveLength(1);
  expect(calls.filter(({ id }) => id === 'sm3-p0-production-delta')).toHaveLength(1);
  expect(calls.some(({ argv }) => argv.includes('test:affected'))).toBe(false);
  expect(calls.some(({ argv }) => argv.includes('scripts/ci-pr-risk.ts'))).toBe(false);
  expect(calls.some(({ argv }) => argv.some((part) => /playwright/iu.test(part)))).toBe(false);
  expect(calls.every(({ env }) => env.SEC_CHANGED_BASE === BASE)).toBe(true);
  expect(calls.every(({ env }) => env.SEC_IMPORTS_CHANGED_ONLY === '1')).toBe(true);
  expect(calls.find(({ id }) => id === 'sm3-p0-production-delta')?.env).toMatchObject({
    SEC_RUN_SM3_PRODUCTION_SENTINEL: '1'
  });
});
