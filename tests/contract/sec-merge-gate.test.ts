import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { expect, test } from 'bun:test';
import { parse } from 'yaml';

import {
  CodexDevelopmentBuildVerificationInputV2,
  CodexDevelopmentBuildVerificationPlanV1
} from '../../platform/shared/ci-contract.ts';
import {
  CodexDevelopmentSm3P0EvidencePolicyIdV1,
  CodexDevelopmentSm3P0WorkPackageIdV1
} from '../../platform/shared/ci-evidence-composition-policy-registry.ts';
import {
  CodexDevelopmentFinalizeVerificationEvidenceV2,
  CodexDevelopmentFinalizeVerificationEvidenceV3,
  CodexDevelopmentVerificationDigest,
  CodexDevelopmentVerificationRawOutputDigest,
  type CodexDevelopmentVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV3
} from '../../platform/shared/ci-evidence-contract.ts';
import type {
  CodexDevelopmentExactGitBlobBytesV1,
  CodexDevelopmentExactGitBlobV1
} from '../../platform/shared/ci-evidence-reuse-contract.ts';
import {
  decodeGitPathOutput,
  parseGitChangedRecordsOutput
} from '../../platform/shared/ci-git-changed-files.ts';
import {
  TCB_APPROVED_EXTERNAL_IMPORTS,
  TCB_PROCESS_SAFE_MEMBERS,
  matchesCanonicalTrustRoot,
  runtimeRelativeImportsFromSource,
  trustedRuntimeClosure,
  verifyTcbClosureLock
} from '../../platform/shared/tcb-closure-lock.ts';
import { CodexDevelopmentCiVerificationMain } from '../../scripts/ci-verification.ts';
import {
  CodexDevelopmentBuildScopeAttestationV1,
  CodexDevelopmentEvaluateMergeGateV1,
  type CodexDevelopmentMergeGateInputV1
} from '../../scripts/codex/merge-gate.ts';
import {
  CodexDevelopmentParseWorkPackageManifestV1,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../scripts/codex/work-package-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const TREE = '3'.repeat(40);
const MANIFEST_PATH = 'docs/work-packages/example.md';
const CHECKED_AT = '2026-07-14T00:00:00.000Z';
const EXPIRES_AT = '2026-10-12T00:00:00.000Z';

type PlannerPull = {
  number: number;
  draft: boolean;
  head: { sha: string; repo: { id: number } };
  base: { ref: string; repo: { id: number } };
};

type PlannerEnv = {
  EVENT_NAME: string;
  EVENT_HEAD: string;
  EVENT_TITLE: string;
  WORKFLOW_STATUS: string;
};

async function runRevalidationPlanner(pulls: PlannerPull[], env: Partial<PlannerEnv> = {}) {
  const workflow = parse(await readCompilerFile('.github/workflows/sec-merge-gate.yml')) as {
    jobs: Record<string, { steps: Array<{ id?: string; with?: { script?: string } }> }>;
  };
  const script = workflow.jobs['plan-revalidation']?.steps.find((step) => step.id === 'plan')?.with?.script;
  if (!script) throw new Error('plan-revalidation github-script source is missing.');
  const statuses: Array<{ sha: string; state: string; description: string }> = [];
  let matrix = '';
  const execute = new Function(
    'github', 'context', 'core', 'process',
    `return (async () => { ${script}\n })();`
  ) as (github: unknown, context: unknown, core: unknown, processValue: unknown) => Promise<void>;
  await execute({
    paginate: async () => pulls,
    rest: {
      pulls: { list: () => undefined },
      repos: {
        createCommitStatus: async (status: { sha: string; state: string; description: string }) => {
          statuses.push(status);
        }
      }
    }
  }, {
    repo: { owner: 'sec-platform', repo: 'sec' },
    payload: { repository: { default_branch: 'main' } },
    serverUrl: 'https://github.com',
    runId: 123
  }, {
    setOutput: (name: string, value: string) => {
      if (name === 'matrix') matrix = value;
    }
  }, {
    env: {
      EVENT_NAME: 'push',
      EVENT_HEAD: '',
      EVENT_TITLE: '',
      WORKFLOW_STATUS: '',
      ...env
    }
  });
  return { statuses, matrix };
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

function manifestSource(
  ownedPaths = ['source/'],
  tests = ['focused-contract'],
  requiredProfile: 'quick' | 'full' = 'quick'
): string {
  return `---
schema: codex-development-work-package-v1
id: example
tracking: issue-106
base: "${BASE}"
manifestState: frozen
requiredProfile: ${requiredProfile}
ciRevision: ci-verification-v19
tasks:
  - id: implementation
    owner: implementation-writer
    ownedPaths:
${ownedPaths.map((entry) => `      - ${entry}`).join('\n')}
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact-head-gate
tests:
${tests.map((entry) => `  - ${entry}`).join('\n')}
---

# Example
`;
}

function runMetadata(overrides: Partial<CodexDevelopmentMergeGateInputV1['attestationArtifact']['run']> = {}) {
  return {
    workflowId: 10,
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    runId: 100,
    runAttempt: 1,
    event: 'repository_dispatch',
    headSha: BASE,
    headBranch: 'main',
    conclusion: 'success',
    actor: 'maintainer',
    triggeringActor: 'maintainer',
    actorPermission: 'maintain' as const,
    triggeringActorPermission: 'admin' as const,
    ...overrides
  };
}

function refinalizeEvidence(
  evidence: CodexDevelopmentVerificationEvidenceV2,
  patch: Partial<Omit<CodexDevelopmentVerificationEvidenceV2, 'schema' | 'evidenceDigest'>>
): CodexDevelopmentVerificationEvidenceV2 {
  const { schema: _schema, evidenceDigest: _evidenceDigest, ...draft } = evidence;
  return CodexDevelopmentFinalizeVerificationEvidenceV2({ ...draft, ...patch });
}

function fixture(
  manifest = manifestSource(),
  changedFiles = ['source/model/semantic-contracts.yaml']
) {
  const manifestBytes = Buffer.from(manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes);
  const manifestBlobSha = gitBlobSha(manifestBytes);
  const parsedManifest = CodexDevelopmentParseWorkPackageManifestV1(manifest, MANIFEST_PATH);
  const plan = CodexDevelopmentBuildVerificationPlanV1(parsedManifest.requiredProfile, changedFiles);
  const scopeRequest = {
    schema: 'codex-development-scope-attestation-request-v1',
    repository: 'sec-platform/sec',
    repositoryId: 1,
    pullRequest: 123,
    defaultBranch: 'main',
    currentBase: BASE,
    exactHead: HEAD,
    baseRepoId: 1,
    headRepoId: 1,
    manifestPath: MANIFEST_PATH,
    expectedManifestDigest: manifestDigest,
    expectedManifestBlobSha: manifestBlobSha,
    expectedManifestByteLength: manifestBytes.byteLength,
    eventName: 'repository_dispatch',
    eventType: 'sec-scope-attest-v1',
    workflowId: 10,
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowHeadSha: BASE,
    runId: 100,
    runAttempt: 1,
    actor: 'maintainer',
    triggeringActor: 'maintainer',
    actorPermission: 'maintain',
    triggeringActorPermission: 'admin'
  } as const;
  const attestation = CodexDevelopmentBuildScopeAttestationV1(scopeRequest, manifestBytes);
  const rawEvidence = CodexDevelopmentFinalizeVerificationEvidenceV2({
    contractRevision: 'ci-verification-v19',
    kind: 'verification',
    profile: parsedManifest.requiredProfile,
    headSha: HEAD,
    treeSha: TREE,
    prBaseSha: BASE,
    affectedBaseSha: BASE,
    manifestPath: MANIFEST_PATH,
    manifestDigest,
    inputDigest: CodexDevelopmentVerificationDigest(CodexDevelopmentBuildVerificationInputV2({
      profile: parsedManifest.requiredProfile,
      headSha: HEAD,
      treeSha: TREE,
      prBaseSha: BASE,
      affectedBaseSha: BASE,
      manifestPath: MANIFEST_PATH,
      manifestDigest,
      changedFiles: plan.changedFiles,
      selectionResolved: plan.selectionResolved,
      gates: plan.gates
    })),
    argv: [
      'bun', 'scripts/ci-verification.ts', '--profile', parsedManifest.requiredProfile, '--expected-head', HEAD
    ],
    status: 'passed',
    startedAt: CHECKED_AT,
    finishedAt: '2026-07-14T00:00:01.000Z',
    durationMs: 1_000,
    changedFiles: plan.changedFiles,
    selectionResolved: plan.selectionResolved,
    cleanState: { before: true, after: true },
    failure: null,
    gates: plan.gates.map((step) => ({
      id: step.id,
      argv: ['bun', ...step.args],
      status: 'passed',
      exitCode: 0,
      startedAt: CHECKED_AT,
      finishedAt: '2026-07-14T00:00:01.000Z',
      durationMs: 1_000,
      failureTail: null,
      rawOutputDigest: CodexDevelopmentVerificationRawOutputDigest(step.id),
      notRunReason: null
    })),
    invalidation: {
      expiresAt: EXPIRES_AT,
      rules: ['head/base/tree/manifest/artifact changes invalidate evidence']
    }
  });
  const attestationName = `sec-scope-attestation-v1-pr-123-base-${BASE}-head-${HEAD}-manifest-${manifestDigest.slice(7)}-run-100-attempt-1`;
  const verificationName = `sec-verification-v19-${parsedManifest.requiredProfile}-pr-123-base-${BASE}-head-${HEAD}-run-200-attempt-1`;
  const rawInput: CodexDevelopmentMergeGateInputV1 = {
    schema: 'codex-development-merge-gate-input-v1',
    repository: 'sec-platform/sec',
    repositoryId: 1,
    pullRequest: 123,
    body: `Summary\nWork-Package: ${MANIFEST_PATH}`,
    draft: false,
    defaultBranch: 'main',
    baseRepoId: 1,
    headRepoId: 1,
    currentBase: BASE,
    exactHead: HEAD,
    headTree: TREE,
    headParents: [BASE],
    aheadBy: 1,
    behindBy: 0,
    headOpenPullRequestCount: 1,
    manifestPath: MANIFEST_PATH,
    manifestBlobSha,
    manifestByteLength: manifestBytes.byteLength,
    changedRecords: changedFiles.map((repositoryPath) => ({ status: 'changed' as const, path: repositoryPath })),
    checkedAt: CHECKED_AT,
    attestationWorkflowId: 10,
    verificationWorkflowId: 20,
    attestationArtifact: {
      id: 1000,
      name: attestationName,
      digest: `sha256:${'4'.repeat(64)}`,
      expired: false,
      expiresAt: EXPIRES_AT,
      sizeInBytes: 2_048,
      run: runMetadata()
    },
    verificationArtifact: {
      id: 2000,
      name: verificationName,
      digest: `sha256:${'5'.repeat(64)}`,
      expired: false,
      expiresAt: EXPIRES_AT,
      sizeInBytes: 2_048,
      run: runMetadata({
        workflowId: 20,
        workflowPath: '.github/workflows/compiler-pr-validation.yml',
        runId: 200
      })
    }
  };
  return { manifestBytes, manifestBlobSha, scopeRequest, rawInput, attestation, rawEvidence, plan };
}

const P0_BASE = '01d5c45a573337bee484d6a9d2effb2a76787b86';
const P0_HEAD = 'ab5d3a839afc1d595ae5c43437eb862cde1500c1';
const P0_TESTED_HEAD = '514e6e401659f18ecffca19856a11354d66d05df';
const P0_MANIFEST_PATH = `docs/work-packages/${CodexDevelopmentSm3P0WorkPackageIdV1}.md`;
const P0_EVIDENCE_PATH =
  'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json';
const P0_RUN_RUNTIME = 'platform/compiler/verify/run-runtime-verification.ts';
const P0_RUN_RUNTIME_BLOB = '9173cd35533db0317812039eedb0ba68204846ef';
const P0_INVOCATION_CONTRACT = 'platform/compiler/verify/runtime-verification-invocation-contract.ts';
const P0_INVOCATION_CONTRACT_BLOB = '65e4f7eee2e9ac5b1c5afe8d2dfddaaa3be06661';
const P0_RUNTIME_PLAN = 'platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
const P0_RUNTIME_PLAN_BLOB = 'b2e0cef5148d9411d1000e7a6ace9b82cb0cfe34';
const P0_RUNTIME_VERIFICATION_TEST = 'tests/unit/runtime-verification.test.ts';
const P0_RUNTIME_VERIFICATION_TEST_BLOB = '8b84a253daa8fce0ae7cf770bc134e1d202fe72a';
const P0_ISOLATED_CHILD_TEST = 'tests/unit/semantic-mutation-isolated-child-fence.test.ts';
const P0_ISOLATED_CHILD_TEST_BLOB = 'a77d1d23c5b75d751ef39c0b8a0e81909486136c';
const P0_TEST_IMPACT = 'tests/contract/test-impact.test.ts';
const P0_TEST_IMPACT_BLOB = '5d7da4f7df39bd18ba4acff5263c6166557f1459';
const P0_DOCUMENTATION_AUTHORITY = 'tests/contract/documentation-authority.test.ts';
const P0_TEST_FILES = [
  P0_DOCUMENTATION_AUTHORITY,
  'tests/contract/semantic-mutation-apply-contract.test.ts',
  'tests/integration/semantic-mutation-apply.test.ts',
  'tests/integration/semantic-mutation-production-sentinel.test.ts',
  P0_RUNTIME_VERIFICATION_TEST,
  P0_ISOLATED_CHILD_TEST,
  'tests/e2e/end-to-end.test.ts',
  'tests/e2e/graph.test.ts',
  'tests/e2e/local-views.test.ts',
  'tests/e2e/pipeline.test.ts',
  'tests/e2e/registry.test.ts',
  'tests/e2e/semantic-runtime-contract.test.ts',
  'tests/e2e/verification.test.ts'
];

function p0ManifestSource(schema: 'v1' | 'v2'): string {
  const revision = schema === 'v1'
    ? 'requiredProfile: quick\nciRevision: ci-verification-v19\n'
    : `evidenceComposition:\n  policyId: ${CodexDevelopmentSm3P0EvidencePolicyIdV1}\n`;
  return `---
schema: codex-development-work-package-${schema}
id: ${CodexDevelopmentSm3P0WorkPackageIdV1}
tracking: issue-106
base: "${P0_BASE}"
manifestState: frozen
${revision}tasks:
  - id: sm3-p0
    owner: sm3-writer
    ownedPaths:
      - docs/
      - platform/
      - tests/
forbiddenPaths:
  - .github/workflows/
acceptance:
  - exact-policy
${schema === 'v1' ? 'tests:\n  - bun run typecheck\n' : ''}---

# SM3 P0 merge reconciliation fixture
`;
}

async function p0MergeFixture() {
  const git = (args: string[], encoding: 'utf8' | 'buffer' = 'utf8') => {
    const result = spawnSync('git', args, { encoding });
    if (result.status !== 0) throw new Error(String(result.stderr));
    return encoding === 'utf8' ? String(result.stdout) : new Uint8Array(result.stdout as Buffer);
  };
  const tree = (ref: string): Map<string, CodexDevelopmentExactGitBlobV1> => {
    const output = decodeGitPathOutput(
      git(['ls-tree', '-r', '-z', '--full-tree', ref], 'buffer') as Uint8Array,
      'tree-path'
    );
    const entries = output.split('\0').filter(Boolean);
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
  };
  const trees = new Map([
    [P0_BASE, tree(P0_BASE)],
    [P0_HEAD, tree(P0_HEAD)],
    [P0_TESTED_HEAD, tree(P0_TESTED_HEAD)]
  ]);
  const anticipatedHeadTree = trees.get(P0_HEAD)!;
  for (const [repositoryPath, blobSha] of [
    [P0_RUN_RUNTIME, P0_RUN_RUNTIME_BLOB],
    [P0_INVOCATION_CONTRACT, P0_INVOCATION_CONTRACT_BLOB],
    [P0_RUNTIME_PLAN, P0_RUNTIME_PLAN_BLOB],
    [P0_RUNTIME_VERIFICATION_TEST, P0_RUNTIME_VERIFICATION_TEST_BLOB],
    [P0_ISOLATED_CHILD_TEST, P0_ISOLATED_CHILD_TEST_BLOB],
    [P0_TEST_IMPACT, P0_TEST_IMPACT_BLOB],
    [P0_DOCUMENTATION_AUTHORITY, P0_TEST_IMPACT_BLOB]
  ] as const) {
    anticipatedHeadTree.set(repositoryPath, { blobSha, mode: '100644', type: 'blob' });
  }
  const treeIds = new Map([P0_BASE, P0_HEAD, P0_TESTED_HEAD].map((ref) => [
    ref,
    String(git(['rev-parse', `${ref}^{tree}`])).trim()
  ]));
  const gitBlob = (ref: string, repositoryPath: string): CodexDevelopmentExactGitBlobV1 | null => (
    trees.get(ref)?.get(repositoryPath) ?? null
  );
  const exactBytes = (ref: string, repositoryPath: string): CodexDevelopmentExactGitBlobBytesV1 | null => {
    const entry = gitBlob(ref, repositoryPath);
    if (!entry) return null;
    return {
      ...entry,
      bytes: git(['cat-file', 'blob', `${ref}:${repositoryPath}`], 'buffer') as Uint8Array
    };
  };
  const changedRecords = [
    ...parseGitChangedRecordsOutput(git([
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames', '--find-copies',
    '--diff-filter=ACDMRTUXB', P0_BASE, P0_HEAD
    ], 'buffer') as Uint8Array),
    { status: 'changed' as const, path: P0_RUN_RUNTIME },
    { status: 'added' as const, path: P0_INVOCATION_CONTRACT },
    { status: 'changed' as const, path: P0_RUNTIME_PLAN },
    { status: 'changed' as const, path: P0_RUNTIME_VERIFICATION_TEST }
  ];
  const syntheticSource = new TextEncoder().encode(changedRecords.flatMap((record) => {
    if (record.path.startsWith('platform/') && record.path.endsWith('.ts')) {
      return [`import '../../${record.path}';`];
    }
    if (record.path.startsWith('tests/helpers/') && record.path.endsWith('.ts')) {
      return [`import '../helpers/${record.path.slice('tests/helpers/'.length)}';`];
    }
    return [];
  }).join('\n'));
  const readGitBlob = (ref: string, repositoryPath: string): CodexDevelopmentExactGitBlobBytesV1 | null => {
    if (ref === P0_HEAD && P0_TEST_FILES.includes(repositoryPath)) {
      const entry = gitBlob(ref, repositoryPath);
      return entry ? { ...entry, bytes: syntheticSource } : null;
    }
    return repositoryPath === P0_EVIDENCE_PATH ? exactBytes(ref, repositoryPath) : null;
  };
  const manifestBytes = new TextEncoder().encode(p0ManifestSource('v2'));
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes);
  const manifestBlobSha = gitBlobSha(manifestBytes);
  let rawEvidence: CodexDevelopmentVerificationEvidenceV3 | undefined;
  let tick = 0;
  const runnerResult = await CodexDevelopmentCiVerificationMain({
    argv: ['--profile', 'quick', '--expected-head', P0_HEAD],
    env: {
      SEC_CHANGED_BASE: 'base-ref',
      SEC_AFFECTED_TESTS_BASE: 'base-ref',
      SEC_WORK_PACKAGE_MANIFEST_PATH: P0_MANIFEST_PATH,
      PATH: 'C:\\trusted-bin',
      SYSTEMROOT: 'C:\\Windows',
      CI: 'true'
    },
    now: () => new Date(Date.UTC(2026, 6, 18, 0, 0, 0, tick++ * 10)),
    gitRevision: (ref) => {
      if (ref === 'HEAD') return P0_HEAD;
      if (ref === 'HEAD^{tree}') return treeIds.get(P0_HEAD)!;
      if (ref === 'HEAD^1' || ref === 'base-ref') return P0_BASE;
      if (treeIds.has(ref)) return ref;
      const treeRef = /^(?<commit>[0-9a-f]{40})\^\{tree\}$/u.exec(ref)?.groups?.commit;
      return treeRef ? treeIds.get(treeRef) ?? null : null;
    },
    trackedTreeIsClean: () => true,
    changedRecords: () => [...changedRecords],
    gitFiles: (ref) => ref === P0_HEAD ? [...P0_TEST_FILES] : null,
    gitBlob,
    readGitBlob,
    readExactGitBlob: () => ({
      blobSha: manifestBlobSha,
      bytes: manifestBytes,
      mode: '100644',
      type: 'blob'
    }),
    runGate: async () => ({
      code: 0,
      rawOutputDigest: `sha256:${'0'.repeat(64)}`,
      failureTail: ''
    }),
    writeEvidenceV3: (_file, evidence) => { rawEvidence = evidence; }
  });
  if (runnerResult !== 0 || !rawEvidence) throw new Error('P0 V3 fixture runner did not produce passed evidence.');
  const scopeRequest = {
    schema: 'codex-development-scope-attestation-request-v1',
    repository: 'sec-platform/sec',
    repositoryId: 1,
    pullRequest: 113,
    defaultBranch: 'main',
    currentBase: P0_BASE,
    exactHead: P0_HEAD,
    baseRepoId: 1,
    headRepoId: 1,
    manifestPath: P0_MANIFEST_PATH,
    expectedManifestDigest: manifestDigest,
    expectedManifestBlobSha: manifestBlobSha,
    expectedManifestByteLength: manifestBytes.byteLength,
    eventName: 'repository_dispatch',
    eventType: 'sec-scope-attest-v1',
    workflowId: 10,
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    workflowHeadSha: P0_BASE,
    runId: 100,
    runAttempt: 1,
    actor: 'maintainer',
    triggeringActor: 'maintainer',
    actorPermission: 'maintain',
    triggeringActorPermission: 'admin'
  };
  const attestation = CodexDevelopmentBuildScopeAttestationV1(scopeRequest, manifestBytes);
  const rawInput: CodexDevelopmentMergeGateInputV1 = {
    schema: 'codex-development-merge-gate-input-v1',
    repository: 'sec-platform/sec',
    repositoryId: 1,
    pullRequest: 113,
    body: `Summary\nWork-Package: ${P0_MANIFEST_PATH}`,
    draft: false,
    defaultBranch: 'main',
    baseRepoId: 1,
    headRepoId: 1,
    currentBase: P0_BASE,
    exactHead: P0_HEAD,
    headTree: treeIds.get(P0_HEAD)!,
    headParents: [P0_BASE],
    aheadBy: 1,
    behindBy: 0,
    headOpenPullRequestCount: 1,
    manifestPath: P0_MANIFEST_PATH,
    manifestBlobSha,
    manifestByteLength: manifestBytes.byteLength,
    changedRecords: [...changedRecords],
    checkedAt: '2026-07-18T00:01:00.000Z',
    attestationWorkflowId: 10,
    verificationWorkflowId: 20,
    attestationArtifact: {
      id: 1000,
      name: `sec-scope-attestation-v1-pr-113-base-${P0_BASE}-head-${P0_HEAD}-manifest-${manifestDigest.slice(7)}-run-100-attempt-1`,
      digest: `sha256:${'4'.repeat(64)}`,
      expired: false,
      expiresAt: EXPIRES_AT,
      sizeInBytes: 2_048,
      run: runMetadata({ headSha: P0_BASE })
    },
    verificationArtifact: {
      id: 2000,
      name: `sec-verification-v19-quick-pr-113-base-${P0_BASE}-head-${P0_HEAD}-run-200-attempt-1`,
      digest: `sha256:${'5'.repeat(64)}`,
      expired: false,
      expiresAt: EXPIRES_AT,
      sizeInBytes: 2_048,
      run: runMetadata({
        workflowId: 20,
        workflowPath: '.github/workflows/compiler-pr-validation.yml',
        runId: 200,
        headSha: P0_BASE
      })
    }
  };
  return {
    manifestBytes,
    manifestDigest,
    manifestBlobSha,
    rawEvidence,
    rawInput,
    attestation,
    changedRecords,
    gitBlob,
    readGitBlob,
    gitFiles: (ref: string) => ref === P0_HEAD ? [...P0_TEST_FILES] : null,
    gitTree: (ref: string) => treeIds.get(ref) ?? null
  };
}

test('base-side merge gate binds same-repo single-parent head, frozen scope, attestation, and Evidence V2', () => {
  const value = fixture();
  expect(CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).toMatchObject({
    status: 'passed',
    context: 'sec/merge-gate',
    exactHead: HEAD,
    currentBase: BASE,
    requiredProfile: 'quick'
  });
});

test('base-side merge gate compares changed-record value identity instead of insertion order', () => {
  const previousPath = 'source/model/semantic-contracts-before.yaml';
  const currentPath = 'source/model/semantic-contracts.yaml';
  const value = fixture(manifestSource(), [previousPath, currentPath]);
  const apiRecord = {
    status: 'renamed' as const,
    path: currentPath,
    previousPath
  };
  const exactGitRecord = {
    status: 'renamed' as const,
    previousPath,
    path: currentPath
  };
  const copiedApiRecord = {
    status: 'copied' as const,
    path: currentPath,
    previousPath
  };
  const copiedExactGitRecord = {
    status: 'copied' as const,
    previousPath,
    path: currentPath
  };
  const evaluate = (
    apiChangedRecords: typeof value.rawInput.changedRecords,
    exactGitChangedRecords: typeof value.rawInput.changedRecords
  ) => (
    CodexDevelopmentEvaluateMergeGateV1({
      rawInput: {
        ...value.rawInput,
        changedRecords: apiChangedRecords
      },
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence: value.rawEvidence,
      changedRecords: () => exactGitChangedRecords
    })
  );

  expect(evaluate([apiRecord], [exactGitRecord])).toMatchObject({
    status: 'passed',
    exactHead: HEAD,
    currentBase: BASE
  });
  expect(evaluate([copiedApiRecord], [copiedExactGitRecord])).toMatchObject({
    status: 'passed',
    exactHead: HEAD,
    currentBase: BASE
  });

  for (const changedRecords of [
    [{ ...exactGitRecord, status: 'copied' as const }],
    [{ ...exactGitRecord, path: 'source/model/semantic-contracts-drifted.yaml' }],
    [{ ...exactGitRecord, previousPath: 'source/model/semantic-contracts-drifted-before.yaml' }],
    [{ status: 'renamed' as const, path: currentPath }],
    [],
    [exactGitRecord, { status: 'added' as const, path: 'source/model/extra.yaml' }]
  ]) {
    expect(() => evaluate([apiRecord], changedRecords)).toThrow(
      'Merge gate API and exact Git changed records disagree.'
    );
  }
});

test('base-side merge gate accepts the real canonical full plan', () => {
  const value = fixture(manifestSource(['source/'], ['focused-contract'], 'full'));
  expect(value.plan.gates.length).toBeGreaterThan(0);
  expect(CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).toMatchObject({ status: 'passed', requiredProfile: 'full' });
});

test('base-side v8 merge gate reconstructs active documentation without impact-risk', () => {
  const changedFiles = [
    'README.md',
    'docs/03-MVP实施计划与路线图.md',
    'docs/work/current-state.yaml',
    'docs/governance/nexus-absorption-and-conformance.md'
  ];
  const value = fixture(manifestSource(changedFiles), changedFiles);

  expect(value.plan).toMatchObject({
    selectionResolved: true,
    selectionReasons: ['ownership-impact'],
    affectedOwners: ['documentation-authority']
  });
  expect(value.plan.gates.map(({ id }) => id)).toEqual([
    'docs-doctor',
    'typecheck',
    'affected-tests'
  ]);
  expect(CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).toMatchObject({ status: 'passed', requiredProfile: 'quick' });
});

test('base-side V8 merge gate independently reconstructs the real P0 plan and rejects self-signed drift', async () => {
  const value = await p0MergeFixture();
  expect(value.rawEvidence.gates.map(({ id }) => id)).toEqual([
    'sm3-p0-gate-00',
    'sm3-p0-gate-01',
    'sm3-p0-gate-02',
    'sm3-p0-gate-03',
    'sm3-p0-siblings',
    'sm3-p0-production-delta',
    'sm3-p0-gate-08'
  ]);
  expect(value.rawEvidence.gates.filter(({ id }) => id === 'sm3-p0-production-delta'))
    .toEqual([expect.objectContaining({ disposition: 'delta' })]);
  expect(value.rawEvidence.reusedEvidence).toEqual([
    expect.objectContaining({ environmentBinding: 'legacy-unbound-v1' })
  ]);
  const evaluate = (rawEvidence: unknown, manifestBytes = value.manifestBytes) => (
    CodexDevelopmentEvaluateMergeGateV1({
      rawInput: value.rawInput,
      manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence,
      runtime: `bun@${Bun.version}`,
      changedRecords: () => [...value.changedRecords],
      gitBlob: value.gitBlob,
      readGitBlob: value.readGitBlob,
      gitFiles: value.gitFiles,
      gitTree: value.gitTree
    })
  );
  expect(evaluate(value.rawEvidence)).toMatchObject({
    status: 'passed',
    requiredProfile: 'quick',
    evidenceDigest: value.rawEvidence.evidenceDigest
  });

  const { schema: _schema, evidenceDigest: _digest, ...draft } = value.rawEvidence;
  const driftedEvidence = CodexDevelopmentFinalizeVerificationEvidenceV3({
    ...draft,
    gates: draft.gates.map((gate, index) => index === 0
      ? { ...gate, argv: [...gate.argv, '--self-signed-drift'] }
      : gate)
  });
  expect(() => evaluate(driftedEvidence)).toThrow('base-recomputed composition plan');

  const legacyManifestBytes = new TextEncoder().encode(p0ManifestSource('v1'));
  const downgradedInput = {
    ...value.rawInput,
    manifestBlobSha: gitBlobSha(legacyManifestBytes),
    manifestByteLength: legacyManifestBytes.byteLength
  };
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: downgradedInput,
    manifestBytes: legacyManifestBytes,
    rawAttestation: {},
    rawEvidence: {},
    changedRecords: () => [...value.changedRecords],
    gitBlob: value.gitBlob
  })).toThrow(`require Work Package V2 policy ${CodexDevelopmentSm3P0EvidencePolicyIdV1}`);
});

test('scope attestation and merge gate bind the raw Git blob SHA and exact byte length', () => {
  const value = fixture();
  expect(value.attestation).toMatchObject({
    manifestBlobSha: value.manifestBlobSha,
    manifestByteLength: value.manifestBytes.byteLength
  });

  for (const patch of [
    { expectedManifestBlobSha: '9'.repeat(40) },
    { expectedManifestByteLength: value.manifestBytes.byteLength + 1 }
  ]) {
    expect(() => CodexDevelopmentBuildScopeAttestationV1({
      ...value.scopeRequest,
      ...patch
    }, value.manifestBytes)).toThrow('manifest/base expectation mismatch');
  }

  for (const patch of [
    { manifestBlobSha: '9'.repeat(40) },
    { manifestByteLength: value.manifestBytes.byteLength + 1 }
  ]) {
    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: { ...value.rawInput, ...patch },
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence: value.rawEvidence
    })).toThrow('blob identity or byte length mismatch');
  }

  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: { ...value.attestation, manifestBlobSha: '9'.repeat(40) },
    rawEvidence: value.rawEvidence
  })).toThrow('does not match live PR/base/head/manifest/run data');
});

test('base-side merge gate rejects self-signed incomplete or drifted passed plans', () => {
  const mutations: Array<(evidence: CodexDevelopmentVerificationEvidenceV2) => CodexDevelopmentVerificationEvidenceV2> = [
    (evidence) => refinalizeEvidence(evidence, { gates: [] }),
    (evidence) => refinalizeEvidence(evidence, {
      gates: [{ ...evidence.gates[0]!, id: 'focused', argv: ['bun', 'test'] }]
    }),
    (evidence) => refinalizeEvidence(evidence, { gates: evidence.gates.slice(0, -1) }),
    (evidence) => refinalizeEvidence(evidence, { gates: [...evidence.gates].reverse() }),
    (evidence) => refinalizeEvidence(evidence, {
      gates: [...evidence.gates, { ...evidence.gates[0]!, id: 'extra', argv: ['bun', 'test', 'extra'] }]
    }),
    (evidence) => refinalizeEvidence(evidence, {
      gates: evidence.gates.map((gate, index) => index === 0
        ? { ...gate, argv: [...gate.argv, '--drift'] }
        : gate)
    }),
    (evidence) => refinalizeEvidence(evidence, { changedFiles: ['src/other.ts'] }),
    (evidence) => refinalizeEvidence(evidence, {
      inputDigest: CodexDevelopmentVerificationDigest('self-signed-input-drift')
    }),
    (evidence) => refinalizeEvidence(evidence, {
      gates: [evidence.gates[0]!, { ...evidence.gates[0]! }]
    }),
    (evidence) => refinalizeEvidence(evidence, {
      gates: evidence.gates.map((gate, index) => index === 0
        ? {
          ...gate,
          status: 'not-run',
          exitCode: null,
          startedAt: null,
          finishedAt: null,
          durationMs: null,
          failureTail: null,
          rawOutputDigest: null,
          notRunReason: 'self-signed skip'
        }
        : gate)
    })
  ];

  for (const mutate of mutations) {
    const value = fixture();
    const rawEvidence = mutate(value.rawEvidence);
    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: value.rawInput,
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence
    })).toThrow();
  }
});

test('fork, duplicate-head, stale-parent, and expiring artifacts fail closed', () => {
  for (const patch of [
    { headRepoId: 2 },
    { headOpenPullRequestCount: 2 },
    { headParents: ['9'.repeat(40)] },
    { behindBy: 1 }
  ]) {
    const value = fixture();
    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: { ...value.rawInput, ...patch },
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence: value.rawEvidence
    })).toThrow();
  }
  const expiring = fixture();
  expiring.rawInput.verificationArtifact.expiresAt = '2026-07-14T12:00:00.000Z';
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: expiring.rawInput,
    manifestBytes: expiring.manifestBytes,
    rawAttestation: expiring.attestation,
    rawEvidence: expiring.rawEvidence
  })).toThrow('24-hour safety window');
});

test('trusted workflows consume the trusted-base registry instead of embedding path facts', async () => {
  for (const workflowPath of [
    '.github/workflows/compiler-pr-validation.yml',
    '.github/workflows/compiler-release-validation.yml'
  ]) {
    const source = await readCompilerFile(workflowPath);
    expect(source).toContain("const registryPath = 'platform/shared/ci-trust-root-registry.json';");
    expect(source).toContain('const registryEntry = baseTree.data.tree.find');
    expect(source).toContain('registry.staticExactPaths');
    expect(source).toContain('registry.staticDirectoryPaths');
    expect(source).toContain('registry.staticPrefixes');
    expect(source).toContain('registry.causalRuntimePaths');
    expect(source).not.toContain("'scripts/codex/',");
    expect(source).not.toMatch(/const trustDirectories = \[/u);
    expect(source).not.toMatch(/const trustPrefixes = \[/u);
  }
});

test('verifier runtime import closure matches the generated TCB closure lock', () => {
  const {
    closure,
    reviewedEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers
  } = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock({
    closure,
    reviewedEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers
  });
  expect(verification.status).toBe('passed');
  expect(verification.failures).toEqual([]);
});

test('merge-gate runtime closure requires no node_modules package', () => {
  const {
    closure,
    observedExternalImports
  } = trustedRuntimeClosure(['scripts/codex/merge-gate.ts']);
  expect([...closure]).toContain('scripts/codex/work-package-contract.ts');
  expect([...observedExternalImports].filter((specifier) => (
    !specifier.startsWith('node:') && !specifier.startsWith('bun:')
  )).sort()).toEqual([]);
});

test('relative ESM closure accepts only direct literal dynamic imports', () => {
  expect(runtimeRelativeImportsFromSource(
    'virtual/direct.ts',
    "async function load() { await import('./direct.ts'); }"
  )).toEqual(['./direct.ts']);
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/nonliteral.ts',
    "const target = './hidden.ts'; async function load() { await import(target); }"
  )).toThrow('TCB runtime dynamic import is not statically resolvable: virtual/nonliteral.ts.');
  expect(runtimeRelativeImportsFromSource(
    'virtual/approved-external.ts',
    "import ts from 'typescript'; import { readFileSync } from 'node:fs';"
  )).toEqual([]);
});

test('relative ESM closure rejects non-approved absolute, URL, package, and import-map specifiers', () => {
  for (const specifier of [
    '/absolute/hidden.ts',
    'C:/absolute/hidden.ts',
    'data:text/javascript,export default 1',
    'file:///absolute/hidden.ts',
    'https://example.invalid/hidden.ts',
    '#internal-loader',
    '.hidden',
    'unapproved-package'
  ]) {
    expect(() => runtimeRelativeImportsFromSource(
      'virtual/non-approved.ts',
      `async function load() { await import(${JSON.stringify(specifier)}); }`
    )).toThrow(`virtual/non-approved.ts -> ${specifier}.`);
  }
});

test('relative ESM closure fails closed on direct and import-bound unmodeled loaders', () => {
  expect([
    'bun',
    'node:child_process',
    'node:module',
    'node:worker_threads'
  ].filter((specifier) => TCB_APPROVED_EXTERNAL_IMPORTS.has(specifier))).toEqual([]);
  expect([...TCB_PROCESS_SAFE_MEMBERS].sort()).toEqual([
    'arch',
    'argv',
    'cwd',
    'env',
    'execPath',
    'exit',
    'exitCode',
    'kill',
    'pid',
    'platform',
    'stderr',
    'stdout',
    'versions'
  ]);

  const sources = [
    ["const hidden = require('./hidden.ts');", 'require'],
    ["import { createRequire as makeRequire } from 'node:module'; makeRequire(import.meta.url);", 'runtime node:module import'],
    ["import hidden = require('./hidden.ts');", 'import = require'],
    ["import { Worker as W } from 'node:worker_threads'; new W('./hidden.ts');", 'runtime node:worker_threads import'],
    ["new Worker('./hidden.ts');", 'Worker'],
    ["importScripts('./hidden.ts');", 'importScripts'],
    ["eval(\"import('./hidden.ts')\");", 'eval'],
    ["Function(\"return import('./hidden.ts')\");", 'Function']
  ] as const;

  for (const [source, loader] of sources) {
    expect(() => runtimeRelativeImportsFromSource(`virtual/${loader}.ts`, source)).toThrow(
      `(${loader}).`
    );
  }
  for (const [fixtureName, source, loader] of [
    ['aliased-require', "const load = require; load('./hidden.ts');", 'require'],
    ['aliased-eval', "const execute = eval; execute('1');", 'eval'],
    ['aliased-function', "const Build = Function; Build('return 1')();", 'Function'],
    ['aliased-worker', "const BuildWorker = Worker; new BuildWorker('./hidden.ts');", 'Worker'],
    ['aliased-import-scripts', "const load = importScripts; load('./hidden.ts');", 'importScripts'],
    ['member-eval', "eval.call(undefined, '1');", 'eval'],
    ['member-function', "Function.bind(undefined, 'return 1')();", 'Function']
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow(`(indirect global loader ${loader}).`);
  }
  for (const [fixtureName, source] of [
    ['import-meta-require', "const load = import.meta.require; load('./hidden.ts');"],
    ['bound-module-require', "module.require.bind(module)('./hidden.ts');"],
    ['aliased-module-require', "const load = module.require; load('./hidden.ts');"]
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow('(indirect require member');
  }
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/computed-require-member.ts',
    "module['require']('./hidden.ts');"
  )).toThrow('(computed module loader member).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/destructured-module-require.ts',
    "const { require: load } = module; load('./hidden.ts');"
  )).toThrow('(escaped module loader namespace).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/dynamic-module-member.ts',
    "const key = 'require'; module[key]('./hidden.ts');"
  )).toThrow('(computed module loader member).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/destructured-import-meta-require.ts',
    "const { require: load } = import.meta; load('./hidden.ts');"
  )).toThrow('(escaped or unclassified import.meta namespace).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/dynamic-import-meta-member.ts',
    "const key = 'require'; import.meta[key]('./hidden.ts');"
  )).toThrow('(computed import.meta member).');

  const unreviewedDispatchers = [
    [
      'aliased-process',
      "import { spawn as launch } from 'node:child_process'; const entrypoint = './hidden.ts'; function candidate() { launch(process.execPath, [entrypoint]); }",
      'spawn'
    ],
    [
      'aliased-exec-process',
      "import { exec as run } from 'node:child_process'; function candidate() { run('git'); }",
      'exec'
    ],
    [
      'aliased-exec-sync-process',
      "import { execSync as run } from 'node:child_process'; function candidate() { run('git'); }",
      'execSync'
    ],
    [
      'namespace-exec-process',
      "import * as childProcess from 'node:child_process'; function candidate() { childProcess.exec('git'); }",
      'exec'
    ],
    [
      'namespace-exec-sync-process',
      "import * as childProcess from 'node:child_process'; function candidate() { childProcess.execSync('git'); }",
      'execSync'
    ],
    [
      'default-plus-namespace-exec-process',
      "import childProcess, * as childProcessNamespace from 'node:child_process'; function candidate() { childProcess.exec('git'); }",
      'exec'
    ],
    [
      'bun-process',
      "const entrypoint = './hidden.ts'; function candidate() { Bun.spawn([process.execPath, entrypoint]); }",
      'Bun.spawn'
    ],
    [
      'bun-sync-process',
      "function candidate() { Bun.spawnSync('git'); }",
      'Bun.spawnSync'
    ],
    [
      'global-bun-sync-process',
      "function candidate() { globalThis.Bun.spawnSync('git'); }",
      'Bun.spawnSync'
    ],
    [
      'imported-bun-sync-process',
      "import { spawnSync as run } from 'bun'; function candidate() { run('git'); }",
      'Bun.spawnSync'
    ],
    [
      'git-config-alias-process',
      "import { spawn } from 'node:child_process'; function candidate() { spawn('git', ['-c', 'alias.x=!program', 'x']); }",
      'spawn'
    ]
  ] as const;
  for (const [fixtureName, source, loader] of unreviewedDispatchers) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow(
      `unreviewed process dispatcher virtual/${fixtureName}.ts::function-declaration:candidate::${loader}#1`
    );
  }

  expect(runtimeRelativeImportsFromSource(
    'platform/dev-runner/import-organizer.ts',
    "import { spawnSync } from 'node:child_process'; function gitBytes() { [0].forEach(() => spawnSync(process.execPath, [])); }"
  )).toEqual([]);
  for (const member of [
    'constructor() { spawnSync(process.execPath, []); }',
    'get value() { spawnSync(process.execPath, []); return 1; }',
    'set value(value: number) { spawnSync(process.execPath, []); void value; }'
  ]) {
    expect(() => runtimeRelativeImportsFromSource(
      'platform/dev-runner/import-organizer.ts',
      `import { spawnSync } from 'node:child_process'; function gitBytes() { class Candidate { ${member} } }`
    )).toThrow('(process dispatcher without a canonical named lexical owner).');
  }
  expect(() => runtimeRelativeImportsFromSource(
    'platform/dev-runner/import-organizer.ts',
    "import { spawnSync } from 'node:child_process'; function gitBytes() { spawnSync(process.execPath, []); spawnSync(process.execPath, []); }"
  )).toThrow(
    'unreviewed process dispatcher platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#2'
  );
  for (const [fixtureName, source, ownerChain] of [
    [
      'nested-function-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { function nestedDispatcher() { spawnSync(process.execPath, []); } }",
      'function-declaration:unexpectedOwner>function-declaration:nestedDispatcher'
    ],
    [
      'nested-arrow-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { const nestedDispatcher = () => spawnSync(process.execPath, []); }",
      'function-declaration:unexpectedOwner>const-arrow:nestedDispatcher'
    ],
    [
      'nested-method-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { class Candidate { nestedDispatcher() { spawnSync(process.execPath, []); } } }",
      'function-declaration:unexpectedOwner>method-declaration:nestedDispatcher'
    ]
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow(
      `unreviewed process dispatcher virtual/${fixtureName}.ts::${ownerChain}::spawnSync#1`
    );
  }
  expect(() => runtimeRelativeImportsFromSource(
    'platform/dev-runner/import-organizer.ts',
    "import { spawnSync } from 'node:child_process'; function gitBytes() { spawnSync(process.execPath, []); } function gitBytes() {}"
  )).toThrow('(ambiguous process dispatcher owner function-declaration:gitBytes).');
  expect(() => runtimeRelativeImportsFromSource(
    'scripts/codex/merge-gate.ts',
    "import { spawnSync } from 'node:child_process'; function mergeGateGitResolvers() { { const run = () => spawnSync('git'); run(); } { const run = () => undefined; run(); } }"
  )).toThrow(
    '(ambiguous process dispatcher owner function-declaration:mergeGateGitResolvers>const-arrow:run).'
  );

  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unclassified-process-binding.ts',
    "import { ChildProcess as Process } from 'node:child_process'; void Process;"
  )).toThrow('(unclassified node:child_process binding ChildProcess).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unclassified-process-member.ts',
    "import * as childProcess from 'node:child_process'; void childProcess.ChildProcess;"
  )).toThrow('(unclassified node:child_process member childProcess.ChildProcess).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/indirect-default-process-member.ts',
    "import childProcess from 'node:child_process'; const run = childProcess.exec; run('git');"
  )).toThrow('(indirect node:child_process member childProcess.exec).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/aliased-bun-namespace.ts',
    "const B = Bun; B.spawnSync('git');"
  )).toThrow('(indirect Bun namespace Bun).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/computed-bun-member.ts',
    "const name = 'spawnSync'; Bun[name]('git');"
  )).toThrow('(computed Bun namespace member Bun[...]).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/indirect-global-bun-member.ts',
    "const run = globalThis.Bun.spawnSync; run('git');"
  )).toThrow('(indirect Bun process loader globalThis.Bun.spawnSync).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unclassified-bun-member.ts',
    "void Bun.file;"
  )).toThrow('(unclassified Bun namespace member Bun.file).');
  expect(runtimeRelativeImportsFromSource(
    'virtual/direct-bun-yaml-parse.ts',
    "const value = Bun.YAML.parse('owner: agent'); void value;"
  )).toEqual([]);
  for (const [fixtureName, source] of [
    ['escaped-bun-yaml', 'const yaml = Bun.YAML; void yaml;'],
    ['other-bun-yaml-member', "Bun.YAML.stringify({ owner: 'agent' });"],
    ['computed-bun-yaml-parse', "Bun.YAML['parse']('owner: agent');"],
    ['escaped-bun-yaml-parse', 'const parse = Bun.YAML.parse; void parse;'],
    ['global-bun-yaml-parse', "globalThis.Bun.YAML.parse('owner: agent');"]
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow('(unclassified Bun namespace member');
  }
  expect(runtimeRelativeImportsFromSource(
    'virtual/direct-bun-semver-satisfies.ts',
    "const valid = Bun.semver.satisfies('1.2.3', '^1.0.0'); void valid;"
  )).toEqual([]);
  for (const [fixtureName, source] of [
    ['escaped-bun-semver', 'const semver = Bun.semver; void semver;'],
    ['escaped-bun-semver-satisfies', 'const satisfies = Bun.semver.satisfies; void satisfies;'],
    ['non-call-bun-semver-satisfies', 'void Bun.semver.satisfies;'],
    ['other-bun-semver-member', "Bun.semver.order('1.2.3', '1.2.4');"],
    ['computed-bun-semver-satisfies', "Bun.semver['satisfies']('1.2.3', '^1.0.0');"],
    ['global-bun-semver-satisfies', "globalThis.Bun.semver.satisfies('1.2.3', '^1.0.0');"]
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow('(unclassified Bun namespace member');
  }
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/computed-bun-semver.ts',
    "Bun['semver'].satisfies('1.2.3', '^1.0.0');"
  )).toThrow('(computed Bun namespace member Bun[...]).');
  expect(runtimeRelativeImportsFromSource(
    'virtual/direct-bun-transpiler.ts',
    "const parser = new Bun.Transpiler({ loader: 'tsx' }); void parser;"
  )).toEqual([]);
  for (const [fixtureName, source] of [
    ['escaped-bun-transpiler', 'const Transpiler = Bun.Transpiler; void Transpiler;'],
    ['called-bun-transpiler', "Bun.Transpiler({ loader: 'tsx' });"],
    ['global-bun-transpiler', "new globalThis.Bun.Transpiler({ loader: 'tsx' });"]
  ] as const) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${fixtureName}.ts`,
      source
    )).toThrow('(unclassified Bun namespace member');
  }
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unclassified-global-member.ts',
    "void globalThis.crypto;"
  )).toThrow('(unclassified globalThis member crypto).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/computed-global-bun-member.ts',
    "globalThis['Bun'].spawnSync('git');"
  )).toThrow('(computed globalThis member).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/dynamic-global-member.ts',
    "const key = 'Bun'; globalThis[key];"
  )).toThrow('(computed globalThis member).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/reflective-global-bun.ts',
    "Reflect.get(globalThis, 'Bun');"
  )).toThrow('(escaped globalThis namespace).');
  for (const alias of ['global', 'self']) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${alias}-bun-process.ts`,
      `${alias}.Bun.spawnSync('git');`
    )).toThrow(`(unapproved global namespace ${alias}).`);
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/${alias}-process-acquisition.ts`,
      `${alias}.process.getBuiltinModule('node:child_process');`
    )).toThrow(`(unapproved global namespace ${alias}).`);
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/reflective-${alias}-acquisition.ts`,
      `Reflect.get(${alias}, 'Bun');`
    )).toThrow(`(unapproved global namespace ${alias}).`);
  }
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/direct-process-acquisition.ts',
    "process.getBuiltinModule('node:child_process');"
  )).toThrow('(unclassified process member getBuiltinModule).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/computed-process-acquisition.ts',
    "process['getBuiltinModule']('node:child_process');"
  )).toThrow('(computed process member).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/aliased-process-acquisition.ts',
    "const runtimeProcess = process; runtimeProcess.getBuiltinModule('node:child_process');"
  )).toThrow('(escaped process namespace).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/reflective-process-acquisition.ts',
    "Reflect.get(process, 'getBuiltinModule')('node:child_process');"
  )).toThrow('(escaped process namespace).');
  for (const member of ['binding', '_linkedBinding', 'mainModule']) {
    expect(() => runtimeRelativeImportsFromSource(
      `virtual/process-${member}.ts`,
      `void process.${member};`
    )).toThrow(`(unclassified process member ${member}).`);
  }
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unused-process-member.ts',
    'process.hrtime();'
  )).toThrow('(unclassified process member hrtime).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/unclassified-bun-import.ts',
    "import { $ as shell } from 'bun'; void shell;"
  )).toThrow('(unclassified bun binding $).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/bun-namespace-import.ts',
    "import * as bunRuntime from 'bun'; void bunRuntime;"
  )).toThrow('(bun default/namespace import).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/dynamic-bun-module.ts',
    "async function load() { return import('bun'); }"
  )).toThrow('(dynamic bun import).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/reexported-bun-binding.ts',
    "export { spawnSync } from 'bun';"
  )).toThrow('(runtime bun re-export).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/dynamic-process-module.ts',
    "async function load() { return import('node:child_process'); }"
  )).toThrow('(dynamic node:child_process import).');
  expect(() => runtimeRelativeImportsFromSource(
    'virtual/reexported-process-binding.ts',
    "export { exec } from 'node:child_process';"
  )).toThrow('(runtime node:child_process re-export).');
  expect(runtimeRelativeImportsFromSource(
    'virtual/type-only-process.ts',
    "import type { ChildProcess } from 'node:child_process'; type Process = ChildProcess;"
  )).toEqual([]);
  expect(runtimeRelativeImportsFromSource(
    'virtual/inline-type-only-process.ts',
    "import { type ChildProcess } from 'node:child_process'; type Process = ChildProcess;"
  )).toEqual([]);
  expect(runtimeRelativeImportsFromSource(
    'virtual/safe-bun-and-process.ts',
    "import { Glob } from 'bun'; new Glob('*.ts'); void Bun.version; void globalThis.Bun.version; process.cwd(); void process.env.PATH; void process.execPath; void import.meta.url; void import.meta.dir; void import.meta.main;"
  )).toEqual([]);
  expect(runtimeRelativeImportsFromSource(
    'virtual/type-only-restricted-modules.ts',
    "import type { Glob } from 'bun'; import type { Module } from 'node:module'; import type { Worker } from 'node:worker_threads'; type RuntimeTypes = Glob | Module | Worker;"
  )).toEqual([]);
});

test('causal trust classification excludes ordinary codex tooling but protects authority-changing surfaces', () => {
  expect(matchesCanonicalTrustRoot('scripts/codex/repository-audit.ts')).toBe(false);
  const ordinary = fixture(
    manifestSource(['scripts/codex/repository-audit.ts']),
    ['scripts/codex/repository-audit.ts']
  );
  expect(CodexDevelopmentEvaluateMergeGateV1({
    rawInput: ordinary.rawInput,
    manifestBytes: ordinary.manifestBytes,
    rawAttestation: ordinary.attestation,
    rawEvidence: ordinary.rawEvidence
  })).toMatchObject({ status: 'passed' });

  for (const repositoryPath of [
    'scripts/codex/merge-gate.ts',
    'scripts/codex/sec-merge-bootstrap.ts',
    'platform/shared/tcb-closure-lock.ts',
    'platform/shared/tcb-trust-root-contract.ts',
    'platform/shared/ci-trust-root-registry.json',
    '.github/workflows/compiler-pr-validation.yml',
    '.github/workflows/sec-trusted-bootstrap.yml'
  ]) {
    expect(matchesCanonicalTrustRoot(repositoryPath)).toBe(true);
    const value = fixture(manifestSource([repositoryPath]), [repositoryPath]);
    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: value.rawInput,
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence: value.rawEvidence
    })).toThrow('manual-bootstrap-required');
  }
});

test('manifest tests remain inert data in pull_request_target merge gate', async () => {
  const malicious = 'node -e "throw new Error(\'must never execute\')"';
  const value = fixture(manifestSource(['source/'], [malicious]));
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).not.toThrow();
  const source = await readCompilerFile('scripts/codex/merge-gate.ts');
  expect(source).not.toContain('manifest.tests');
});

test('scope attestation binds the manifest profile and CI revision', () => {
  const profile = fixture();
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: profile.rawInput,
    manifestBytes: profile.manifestBytes,
    rawAttestation: { ...profile.attestation, requiredProfile: 'full' },
    rawEvidence: profile.rawEvidence
  })).toThrow('does not match');

  const revision = fixture();
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: revision.rawInput,
    manifestBytes: revision.manifestBytes,
    rawAttestation: { ...revision.attestation, ciRevision: 'ci-verification-v3' },
    rawEvidence: revision.rawEvidence
  })).toThrow('CI revision mismatch');

  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: revision.rawInput,
    manifestBytes: revision.manifestBytes,
    rawAttestation: revision.attestation,
    rawEvidence: { ...revision.rawEvidence, contractRevision: 'ci-verification-v7' }
  })).toThrow('Verification evidence CI revision mismatch');
});

test('active merge-gate composition diagnostics stay revision-neutral', async () => {
  const source = await readCompilerFile('scripts/codex/merge-gate.ts');
  expect(source).not.toMatch(/\bMerge gate V\d+\b/u);
  expect(source).toContain('Composition contract requires independent exact candidate Git resolvers.');
});

test('historical Work Package revisions remain parseable but cannot satisfy the current gate', () => {
  const current = fixture();
  for (const legacyRevision of ['ci-verification-v18', 'ci-verification-v17', 'ci-verification-v16', 'ci-verification-v15', 'ci-verification-v14', 'ci-verification-v13', 'ci-verification-v12', 'ci-verification-v11', 'ci-verification-v10', 'ci-verification-v9', 'ci-verification-v8', 'ci-verification-v6'] as const) {
    const legacyBytes = Buffer.from(manifestSource().replace('ci-verification-v19', legacyRevision));
    const legacyManifest = CodexDevelopmentParseWorkPackageManifestV1(legacyBytes.toString('utf8'), MANIFEST_PATH);
    expect(legacyManifest.ciRevision).toBe(legacyRevision);

    expect(() => CodexDevelopmentBuildScopeAttestationV1({
      ...current.scopeRequest,
      expectedManifestDigest: CodexDevelopmentWorkPackageManifestDigest(legacyBytes),
      expectedManifestBlobSha: gitBlobSha(legacyBytes),
      expectedManifestByteLength: legacyBytes.byteLength
    }, legacyBytes)).toThrow('CI revision is not current');

    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: {
        ...current.rawInput,
        manifestBlobSha: gitBlobSha(legacyBytes),
        manifestByteLength: legacyBytes.byteLength
      },
      manifestBytes: legacyBytes,
      rawAttestation: current.attestation,
      rawEvidence: current.rawEvidence
    })).toThrow('CI revision is not current');
  }
});

test('artifact metadata and repository_dispatch run identity fail closed', () => {
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    (value) => { value.rawInput.attestationArtifact.digest = null; },
    (value) => {
      value.rawInput.verificationArtifact.name = value.rawInput.verificationArtifact.name.replace(
        'sec-verification-v19-',
        'sec-verification-v18-'
      );
    },
    (value) => { value.rawInput.verificationArtifact.expired = true; },
    (value) => { value.rawInput.verificationArtifact.expiresAt = 'not-an-iso-time'; },
    (value) => { value.rawInput.verificationArtifact.sizeInBytes = 0; },
    (value) => { value.rawInput.verificationArtifact.sizeInBytes = 5_242_881; },
    (value) => { value.rawInput.attestationArtifact.run.workflowId = 99; },
    (value) => { value.rawInput.attestationArtifact.run.workflowPath = '.github/workflows/other.yml'; },
    (value) => { value.rawInput.verificationArtifact.run.event = 'push'; },
    (value) => { value.rawInput.verificationArtifact.run.headSha = HEAD; },
    (value) => { value.rawInput.verificationArtifact.run.headBranch = 'other'; },
    (value) => { value.rawInput.verificationArtifact.run.runAttempt = 2; },
    (value) => { value.rawInput.verificationArtifact.run.actorPermission = 'read'; }
  ];

  for (const mutate of mutations) {
    const value = fixture();
    mutate(value);
    expect(() => CodexDevelopmentEvaluateMergeGateV1({
      rawInput: value.rawInput,
      manifestBytes: value.manifestBytes,
      rawAttestation: value.attestation,
      rawEvidence: value.rawEvidence
    })).toThrow();
  }
});

test('manifest and artifact JSON decoding use fatal UTF-8', async () => {
  const value = fixture();
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: Uint8Array.from([0xc3, 0x28]),
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).toThrow('strict UTF-8');
  const source = await readCompilerFile('scripts/codex/merge-gate.ts');
  expect(source).toContain("new TextDecoder('utf-8', { fatal: true })");
  expect(source).toContain('Artifact directory must contain exactly one entry');
  expect(source).toContain('stat.size > 1_048_576');
});

test('revalidation planner records Draft failure without scheduling a Draft matrix runner', async () => {
  const draft: PlannerPull = {
    number: 107,
    draft: true,
    head: { sha: '7'.repeat(40), repo: { id: 1 } },
    base: { ref: 'main', repo: { id: 1 } }
  };
  const ready: PlannerPull = {
    number: 108,
    draft: false,
    head: { sha: '8'.repeat(40), repo: { id: 1 } },
    base: { ref: 'main', repo: { id: 1 } }
  };

  for (const env of [
    { EVENT_NAME: 'push' },
    { EVENT_NAME: 'schedule' },
    { EVENT_NAME: 'pull_request_target', EVENT_HEAD: draft.head.sha }
  ]) {
    const draftOnly = await runRevalidationPlanner([draft], env);
    expect(JSON.parse(draftOnly.matrix)).toEqual({ include: [] });
    expect(draftOnly.statuses).toEqual([expect.objectContaining({
      sha: draft.head.sha,
      state: 'failure',
      description: 'Draft PR is not eligible for merge-gate execution'
    })]);
  }

  const mixed = await runRevalidationPlanner([draft, ready]);
  expect(JSON.parse(mixed.matrix)).toEqual({ include: [{ pull_request: 108, head: ready.head.sha }] });
  expect(mixed.statuses).toEqual([
    expect.objectContaining({ sha: draft.head.sha, state: 'failure' }),
    expect.objectContaining({ sha: ready.head.sha, state: 'pending' })
  ]);

  const sharedHeadReady = { ...ready, head: draft.head };
  const duplicateHead = await runRevalidationPlanner([draft, sharedHeadReady]);
  expect(JSON.parse(duplicateHead.matrix)).toEqual({ include: [] });
  expect(duplicateHead.statuses).toEqual([expect.objectContaining({
    sha: draft.head.sha,
    state: 'failure',
    description: 'Multiple open pull requests share one exact head'
  })]);
});

test('workflow_run planner invalidates early attempts and executes one completed ready head', async () => {
  const ready: PlannerPull = {
    number: 108,
    draft: false,
    head: { sha: '8'.repeat(40), repo: { id: 1 } },
    base: { ref: 'main', repo: { id: 1 } }
  };
  const event = {
    EVENT_NAME: 'workflow_run',
    EVENT_TITLE: `verify frozen PR #108 quick @ ${ready.head.sha} base ${'9'.repeat(40)}`
  };

  for (const WORKFLOW_STATUS of ['requested', 'in_progress']) {
    const early = await runRevalidationPlanner([ready], { ...event, WORKFLOW_STATUS });
    expect(JSON.parse(early.matrix)).toEqual({ include: [] });
    expect(early.statuses).toEqual([expect.objectContaining({ sha: ready.head.sha, state: 'pending' })]);
  }

  const completed = await runRevalidationPlanner([ready], { ...event, WORKFLOW_STATUS: 'completed' });
  expect(JSON.parse(completed.matrix)).toEqual({ include: [{ pull_request: 108, head: ready.head.sha }] });
  expect(completed.statuses).toEqual([expect.objectContaining({ sha: ready.head.sha, state: 'pending' })]);
});

test('workflow run names preserve complete canonical producer and lookup identities after YAML parsing', async () => {
  const verificationTemplate = 'verify frozen PR #${{ github.event.client_payload.pull_request }} ${{ github.event.client_payload.profile }} @ ${{ github.event.client_payload.expected_head }} base ${{ github.event.client_payload.expected_base }}';
  const attestationTemplate = '${{ github.event.action || github.event_name }} PR #${{ github.event.client_payload.pull_request }} head ${{ github.event.client_payload.expected_head }} base ${{ github.event.client_payload.expected_base }} manifest ${{ github.event.client_payload.manifest_digest }}';
  const verificationWorkflow = parse(await readCompilerFile('.github/workflows/compiler-pr-validation.yml')) as {
    'run-name'?: unknown;
  };
  const mergeWorkflow = parse(await readCompilerFile('.github/workflows/sec-merge-gate.yml')) as {
    'run-name'?: unknown;
  };
  expect(verificationWorkflow['run-name']).toBe(verificationTemplate);
  expect(mergeWorkflow['run-name']).toBe(attestationTemplate);

  const ready: PlannerPull = {
    number: 117,
    draft: false,
    head: { sha: '8'.repeat(40), repo: { id: 1 } },
    base: { ref: 'main', repo: { id: 1 } }
  };
  const currentBase = '9'.repeat(40);
  const renderedVerificationTitle = verificationTemplate
    .replace('${{ github.event.client_payload.pull_request }}', String(ready.number))
    .replace('${{ github.event.client_payload.profile }}', 'quick')
    .replace('${{ github.event.client_payload.expected_head }}', ready.head.sha)
    .replace('${{ github.event.client_payload.expected_base }}', currentBase);
  expect(renderedVerificationTitle).toBe(
    `verify frozen PR #117 quick @ ${ready.head.sha} base ${currentBase}`
  );
  const manifestDigest = `sha256:${'a'.repeat(64)}`;
  const renderedAttestationTitle = attestationTemplate
    .replace('${{ github.event.action || github.event_name }}', 'sec-scope-attest-v1')
    .replace('${{ github.event.client_payload.pull_request }}', String(ready.number))
    .replace('${{ github.event.client_payload.expected_head }}', ready.head.sha)
    .replace('${{ github.event.client_payload.expected_base }}', currentBase)
    .replace('${{ github.event.client_payload.manifest_digest }}', manifestDigest);
  expect(renderedAttestationTitle).toBe(
    `sec-scope-attest-v1 PR #117 head ${ready.head.sha} base ${currentBase} manifest ${manifestDigest}`
  );
  const accepted = await runRevalidationPlanner([ready], {
    EVENT_NAME: 'workflow_run',
    EVENT_TITLE: renderedVerificationTitle,
    WORKFLOW_STATUS: 'completed'
  });
  expect(JSON.parse(accepted.matrix)).toEqual({ include: [{ pull_request: 117, head: ready.head.sha }] });
  await expect(runRevalidationPlanner([ready], {
    EVENT_NAME: 'workflow_run',
    EVENT_TITLE: 'verify frozen PR',
    WORKFLOW_STATUS: 'completed'
  })).rejects.toThrow('does not carry one canonical PR/head key');

  const mergeSource = await readCompilerFile('.github/workflows/sec-merge-gate.yml');
  expect(mergeSource).toContain(
    'const attestationTitle = `sec-scope-attest-v1 PR #${pullNumber} head ${process.env.EXACT_HEAD} base ${currentBase} manifest ${digest}`;'
  );
  expect(mergeSource).toContain(
    'const verificationTitle = `verify frozen PR #${pullNumber} ${process.env.VERIFICATION_PROFILE} @ ${process.env.EXACT_HEAD} base ${currentBase}`;'
  );
  expect(mergeSource).toContain(
    'new RegExp(`^verify frozen PR #${pullNumber} (quick|full) @ ${exactHead} base ${currentBase}$`)'
  );
});

test('trusted workflows pin actions, revalidate drift, and only materialize candidate Git objects as data', async () => {
  const mergeWorkflow = (await readCompilerFile('.github/workflows/sec-merge-gate.yml')).replaceAll(
    '\r\n',
    '\n',
  );
  const prWorkflow = (await readCompilerFile('.github/workflows/compiler-pr-validation.yml')).replaceAll(
    '\r\n',
    '\n',
  );
  const releaseWorkflow = (await readCompilerFile('.github/workflows/compiler-release-validation.yml')).replaceAll(
    '\r\n',
    '\n',
  );
  const attestationJob = mergeWorkflow.slice(
    mergeWorkflow.indexOf('  attest-scope:'),
    mergeWorkflow.indexOf('  merge-gate:'),
  );
  expect(attestationJob.indexOf('- name: Checkout trusted current base')).toBeLessThan(
    attestationJob.indexOf('- name: Resolve trusted scope attestation request'),
  );
  expect(attestationJob).toContain('ref: ${{ github.sha }}');
  expect(attestationJob).not.toContain('ref: ${{ steps.attest.outputs.base }}');
  expect(attestationJob).toContain('- name: Setup Bun');
  expect(attestationJob).not.toContain('Install trusted dependencies');
  expect(attestationJob).not.toContain('bun install');
  const mergeGateJob = mergeWorkflow.slice(mergeWorkflow.indexOf('  merge-gate:'));
  expect(mergeGateJob.indexOf('- name: Checkout trusted current base')).toBeLessThan(
    mergeGateJob.indexOf('- name: Resolve live PR and exact trusted artifacts'),
  );
  expect(mergeGateJob).toContain('ref: ${{ github.sha }}');
  expect(mergeGateJob).not.toContain('ref: ${{ steps.resolve.outputs.base }}');
  expect(mergeGateJob).toContain('- name: Setup Bun');
  expect(mergeGateJob).not.toContain('Install trusted dependencies');
  expect(mergeGateJob).not.toContain('bun install');
  expect(mergeWorkflow).toContain("cron: '17 */6 * * *'");
  expect(mergeWorkflow).toContain('push:');
  expect(mergeWorkflow).toContain('pull_request_target:');
  expect(mergeWorkflow).toContain('workflow_run:');
  expect(mergeWorkflow).toContain('sec-scope-attest-v1');
  expect(mergeWorkflow).toContain('merge-multiple: true');
  expect(mergeWorkflow).toContain('statuses: write');
  expect(mergeWorkflow).toContain('group: sec-merge-gate-head-${{ matrix.head }}');
  expect(mergeWorkflow).toContain('cancel-in-progress: true');
  expect(mergeWorkflow).toContain('if: always() && !cancelled()');
  expect(mergeWorkflow).toContain('WORKFLOW_HEAD: ${{ github.sha }}');
  expect(mergeWorkflow).toContain('EXPECTED_MATRIX_HEAD: ${{ matrix.head }}');
  expect(mergeWorkflow).toContain('process.env.WORKFLOW_HEAD !== currentBase');
  expect(mergeWorkflow).toContain('livePull.head.sha !== exactHead');
  expect(mergeWorkflow).toContain("state: 'pending'");
  expect(mergeWorkflow).toContain('headOpenPullRequestCount: sameHead.length');
  expect(mergeWorkflow).toContain('sameHeadCount !== 1');
  expect(mergeWorkflow).toContain('changedFiles.length >= 3000');
  expect(mergeWorkflow).toContain('manifestBlobSha !== manifestEntry.sha');
  expect(mergeWorkflow).toContain('expectedManifestBlobSha: manifestBlobSha');
  expect(mergeWorkflow).toContain('expectedManifestByteLength: manifestBytes.byteLength');
  expect(mergeWorkflow).toContain('manifestBlobSha,');
  expect(mergeWorkflow).toContain('manifestByteLength: manifestBytes.byteLength');
  expect(mergeWorkflow).toContain('context: \'sec/merge-gate\'');
  expect(mergeWorkflow).toContain('scripts/codex/github-artifact-metadata.cjs');
  expect((mergeWorkflow.match(/canonicalizeGitHubArtifactMetadataV1/gu) ?? []).length).toBe(4);
  expect(mergeWorkflow).toContain("workflow_id: 'sec-merge-gate.yml'");
  expect(mergeWorkflow).toContain("workflow_id: 'compiler-pr-validation.yml'");
  expect(mergeWorkflow).toContain("attestationWorkflow.data.path !== '.github/workflows/sec-merge-gate.yml'");
  expect(mergeWorkflow).toContain('right.run_number - left.run_number || right.run_attempt - left.run_attempt');
  expect(mergeWorkflow).toContain('Latest exact-key scope attestation run is not successful.');
  expect(mergeWorkflow).toContain('Latest exact frozen-request verification attempt is not successful.');
  expect(mergeWorkflow).toContain('A newer or non-successful exact-key workflow attempt superseded validated evidence.');
  expect(mergeWorkflow).toContain('Validated workflow actor no longer has maintain/admin permission.');
  expect(mergeWorkflow).toContain("- requested\n      - in_progress\n      - completed");
  expect(mergeWorkflow).toContain("process.env.EVENT_NAME === 'workflow_run'");
  expect(mergeWorkflow).toContain("pull.number === Number(match[1]) && pull.head.sha === match[2]");
  expect(mergeWorkflow).toContain('const selectedHeads = [...new Set(selected.map((pull) => pull.head.sha))].sort();');
  expect(mergeWorkflow).toContain("description: 'Multiple open pull requests share one exact head'");
  expect(mergeWorkflow).toContain("description: 'Draft PR is not eligible for merge-gate execution'");
  expect(mergeWorkflow).toContain(': executableSelection;');
  expect(mergeWorkflow).toContain("process.env.EVENT_NAME === 'workflow_run' && process.env.WORKFLOW_STATUS !== 'completed'");
  expect(mergeWorkflow).toContain('? []\n              : executableSelection;');
  expect(mergeWorkflow).toContain('checkedAtMs: checkedAt.getTime()');
  expect(mergeWorkflow).toContain('checkedAtMs: Date.now()');
  expect(mergeWorkflow).not.toContain('expiresAt.toISOString() !== artifact.expiresAt');
  expect(mergeWorkflow).toContain('artifact.expiresAt !== expectedExpiry');
  expect(mergeWorkflow).toContain('93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5');
  expect(mergeWorkflow).toContain('d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4');
  expect(mergeWorkflow).toContain('path: .tmp/codex/candidate');
  expect(mergeWorkflow).toContain('fetch-depth: 2');
  expect(mergeWorkflow).toContain('ref: 514e6e401659f18ecffca19856a11354d66d05df');
  expect(mergeWorkflow).toContain('--candidate-git-dir .tmp/codex/candidate/.git');
  expect(mergeWorkflow).toContain('--legacy-git-dir .tmp/codex/legacy/.git');
  expect((mergeWorkflow.match(/sec-verification-v19-/gu) ?? []).length).toBe(2);
  expect(mergeWorkflow).not.toContain('sec-verification-v18-');
  expect(mergeWorkflow).not.toContain('sec-verification-v17-');
  expect(mergeWorkflow).not.toContain('sec-verification-v16-');
  expect(mergeWorkflow).not.toContain('sec-verification-v15-');
  expect(mergeWorkflow).not.toContain('sec-verification-v14-');
  expect(mergeWorkflow).not.toContain('sec-verification-v13-');
  expect(mergeWorkflow).not.toContain('sec-verification-v11-');
  expect(mergeWorkflow).not.toContain('sec-verification-v10-');
  expect(mergeWorkflow).not.toContain('sec-verification-v9-');
  expect(mergeWorkflow).not.toContain('sec-verification-v8-');
  expect(mergeWorkflow).not.toContain('sec-verification-v7-');
  expect(mergeWorkflow).not.toContain('sec-verification-v4-');
  expect(prWorkflow).toContain('repository_dispatch:');
  expect(prWorkflow).toContain('sec-verify-frozen-v1');
  expect(prWorkflow).toContain('pull-requests: read');
  expect(prWorkflow).not.toContain('pull_request:');
  expect(prWorkflow).not.toContain('statuses: write');
  expect(prWorkflow).not.toContain('run-quick');
  expect(prWorkflow).not.toContain('run-full');
  expect(prWorkflow).toContain('persist-credentials: false');
  expect((prWorkflow.match(/run: bun install --frozen-lockfile/gu) ?? []).length).toBe(1);
  expect(prWorkflow).toContain('`${entry.mode}:${entry.type}:${entry.sha}`');
  expect(releaseWorkflow).toContain('`${entry.mode}:${entry.type}:${entry.sha}`');
  expect((releaseWorkflow.match(/run: bun install --frozen-lockfile/gu) ?? []).length).toBe(1);
});
