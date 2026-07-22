import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'bun:test';
import ts from 'typescript';
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
import { compilerRoot } from '../../platform/shared/paths.ts';
import { CodexDevelopmentCiVerificationMain } from '../../scripts/ci-verification.ts';
import {
  CodexDevelopmentBuildScopeAttestationV1,
  CodexDevelopmentEvaluateMergeGateV1,
  CodexDevelopmentTrustRootPathPrefixesV1,
  CodexDevelopmentTrustRootPathsV1,
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
ciRevision: ci-verification-v8
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
    contractRevision: 'ci-verification-v8',
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
  const verificationName = `sec-verification-v8-${parsedManifest.requiredProfile}-pr-123-base-${BASE}-head-${HEAD}-run-200-attempt-1`;
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
const P0_TEST_FILES = [
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
    ? 'requiredProfile: quick\nciRevision: ci-verification-v8\n'
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
    [P0_TEST_IMPACT, P0_TEST_IMPACT_BLOB]
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
    readManifestBytes: () => manifestBytes,
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
      name: `sec-verification-v8-quick-pr-113-base-${P0_BASE}-head-${P0_HEAD}-run-200-attempt-1`,
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

function workflowTrustArray(
  source: string,
  name: 'trustFiles' | 'trustDirectories' | 'trustPrefixes'
): string[] {
  const pattern = name === 'trustFiles'
    ? /const trustFiles = new Set\(\[([\s\S]*?)\]\);/u
    : new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`, 'u');
  const body = pattern.exec(source)?.[1];
  if (body === undefined) throw new Error(`Missing ${name} declaration in trusted workflow.`);
  return [...body.matchAll(/'([^']+)'/gu)].map((match) => match[1]!);
}

const TCB_RUNTIME_ENTRYPOINTS = [
  'docs/scripts/docs-doctor.ts',
  'platform/dev-runner.ts',
  'platform/shared/ci-contract.ts',
  'platform/shared/ci-evidence-contract.ts',
  'platform/shared/ci-git-changed-files.ts',
  'platform/shared/ci-pr-risk-selection.ts',
  'platform/shared/ci-verification-plan.ts',
  'platform/shared/test-budget-contract.ts',
  'platform/shared/test-impact-contract.ts',
  'platform/shared/test-ownership-contract.ts',
  'scripts/ci-pr-risk.ts',
  'scripts/ci-verification.ts',
  'scripts/ci-workspace-fast.ts',
  'scripts/codex/merge-gate.ts',
  'scripts/codex/work-package-contract.ts',
  'tests/setup/runtime-deps.setup.ts'
] as const;

const TCB_REVIEWED_SUT_EDGES = new Set([
  // ci-workspace-fast is trusted orchestration, while the orchestrator is the product under test.
  // Traversing past this edge would freeze ordinary product/runtime work behind manual bootstrap.
  'scripts/ci-workspace-fast.ts -> platform/orchestrator.ts'
]);

const TCB_APPROVED_EXTERNAL_IMPORTS = new Set([
  'globby',
  'lodash-es',
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:path',
  'node:url',
  'ts-morph',
  'typescript',
  'yaml'
]);

const TCB_CLASSIFIED_EXTERNAL_IMPORTS = new Set([
  'bun',
  'node:child_process',
  'node:module',
  'node:worker_threads'
]);

const TCB_BUN_SAFE_IMPORTS = new Set([
  'Glob'
]);

const TCB_REVIEWED_PROCESS_DISPATCHERS = new Set([
  'platform/dev-runner.ts::function-declaration:reenterWithResolvedDependencies::spawnSync#1',
  'platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
  'platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1',
  'platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
  'scripts/ci-pr-risk.ts::function-declaration:defaultChangedFiles::spawnSync#1',
  'scripts/ci-pr-risk.ts::function-declaration:defaultGitRevision::spawnSync#1',
  'scripts/ci-pr-risk.ts::function-declaration:defaultRunGate::spawn#1',
  'scripts/ci-pr-risk.ts::function-declaration:defaultTrackedTreeIsClean::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultChangedFiles::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultChangedRecords::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultGitBlob::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultGitRevision::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultReadGitBlob::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultRunGate::spawn#1',
  'scripts/ci-verification.ts::function-declaration:defaultTrackedTreeIsClean::spawnSync#1',
  'scripts/codex/merge-gate.ts::function-declaration:mergeGateGitResolvers>const-arrow:run::spawnSync#1',
  'scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1'
]);

const TCB_CHILD_PROCESS_LOADERS = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync'
]);

const TCB_BUN_PROCESS_LOADERS = new Set([
  'Bun.spawn',
  'Bun.spawnSync'
]);

const TCB_BUN_SAFE_GLOBAL_MEMBERS = new Set([
  'version'
]);

const TCB_GLOBAL_THIS_RUNTIME_LOADERS = new Set([
  'eval',
  'Function',
  'importScripts',
  'require',
  'Worker'
]);

const TCB_IMPORT_META_SAFE_MEMBERS = new Set([
  'dir',
  'main',
  'url'
]);

const TCB_FORBIDDEN_GLOBAL_ALIASES = new Set([
  'global',
  'self'
]);

const TCB_PROCESS_SAFE_MEMBERS = new Set([
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

function runtimeRelativeImportsFromSource(
  repositoryPath: string,
  source: string,
  reviewedProcessDispatchers: Set<string> = new Set()
): string[] {
  const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const bunProcessBindings = new Map<string, string>();
  const childProcessBindings = new Map<string, string>();
  const childProcessNamespaces = new Set<string>();
  const rejectUnmodeledLoader = (loader: string): never => {
    throw new Error(
      `TCB runtime loader is outside the relative ESM closure model: ${repositoryPath} (${loader}).`
    );
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause?.namedBindings
        && ts.isNamedImports(clause.namedBindings)
        && clause.name === undefined
        && clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      const namedBindings = clause?.namedBindings;
      const namespaceBindings = [
        clause?.name?.text,
        namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name.text : undefined
      ].filter((binding): binding is string => binding !== undefined);
      const runtimeNamedImports = namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.filter((element) => !element.isTypeOnly)
        : [];
      if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(moduleSpecifier)) {
        const runtimeClause = clause ?? rejectUnmodeledLoader(`side-effect ${moduleSpecifier} import`);
        if (moduleSpecifier === 'bun') {
          if (runtimeClause.name || (namedBindings && ts.isNamespaceImport(namedBindings))) {
            rejectUnmodeledLoader('bun default/namespace import');
          }
          if (runtimeNamedImports.length === 0) {
            rejectUnmodeledLoader('bun import without a classified runtime binding');
          }
          for (const element of runtimeNamedImports) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (TCB_BUN_SAFE_IMPORTS.has(importedName)) continue;
            const loader = `Bun.${importedName}`;
            if (!TCB_BUN_PROCESS_LOADERS.has(loader)) {
              rejectUnmodeledLoader(`unclassified bun binding ${importedName}`);
            }
            bunProcessBindings.set(element.name.text, loader);
          }
          continue;
        }
        if (moduleSpecifier === 'node:child_process') {
          if (namespaceBindings.length === 0 && runtimeNamedImports.length === 0) {
            rejectUnmodeledLoader('node:child_process import without a classified runtime binding');
          }
          for (const binding of namespaceBindings) childProcessNamespaces.add(binding);
          for (const element of runtimeNamedImports) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (!TCB_CHILD_PROCESS_LOADERS.has(importedName)) {
              rejectUnmodeledLoader(`unclassified node:child_process binding ${importedName}`);
            }
            childProcessBindings.set(element.name.text, importedName);
          }
          continue;
        }
        rejectUnmodeledLoader(`runtime ${moduleSpecifier} import`);
      }
      specifiers.push(moduleSpecifier);
    }
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const hasRuntimeExport = !statement.exportClause
        || !ts.isNamedExports(statement.exportClause)
        || statement.exportClause.elements.some((element) => !element.isTypeOnly);
      if (hasRuntimeExport) {
        if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(statement.moduleSpecifier.text)) {
          rejectUnmodeledLoader(`runtime ${statement.moduleSpecifier.text} re-export`);
        }
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  const bunNamespaceName = (expression: ts.Expression): 'Bun' | 'globalThis.Bun' | null => {
    if (ts.isIdentifier(expression) && expression.text === 'Bun') return 'Bun';
    if (
      ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === 'globalThis'
      && expression.name.text === 'Bun'
    ) return 'globalThis.Bun';
    return null;
  };
  const isImportMeta = (node: ts.Node): node is ts.MetaProperty => (
    ts.isMetaProperty(node)
    && node.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.name.text === 'meta'
  );
  const loaderName = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) {
      if (expression.text === 'require') return 'require';
      if (expression.text === 'importScripts') return 'importScripts';
      if (expression.text === 'eval') return 'eval';
      if (expression.text === 'Function') return 'Function';
      if (expression.text === 'Worker') return 'Worker';
      return bunProcessBindings.get(expression.text) ?? childProcessBindings.get(expression.text) ?? null;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const bunNamespace = bunNamespaceName(expression.expression);
      const member = expression.name.text;
      if (bunNamespace && TCB_BUN_PROCESS_LOADERS.has(`Bun.${member}`)) return `Bun.${member}`;
      if (!ts.isIdentifier(expression.expression)) return null;
      const owner = expression.expression.text;
      if (childProcessNamespaces.has(owner) && TCB_CHILD_PROCESS_LOADERS.has(member)) return member;
      if (owner === 'globalThis' && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(member)) {
        return member;
      }
      if (member === 'require') return 'require';
    }
    return null;
  };
  type LexicalOwnerChunk = {
    node: ts.FunctionLikeDeclaration;
    segments: string[];
  };
  const variableDeclarationKind = (declaration: ts.VariableDeclaration): 'const' | 'let' | 'var' | null => {
    if (!ts.isVariableDeclarationList(declaration.parent)) return null;
    if ((declaration.parent.flags & ts.NodeFlags.Const) !== 0) return 'const';
    if ((declaration.parent.flags & ts.NodeFlags.Let) !== 0) return 'let';
    return 'var';
  };
  const lexicalOwnerSegments = (node: ts.FunctionLikeDeclaration): string[] | null => {
    if (ts.isFunctionDeclaration(node)) {
      if (!node.body) return [];
      return node.name ? [`function-declaration:${node.name.text}`] : null;
    }
    if (ts.isMethodDeclaration(node)) {
      return ts.isIdentifier(node.name) ? [`method-declaration:${node.name.text}`] : null;
    }
    if (ts.isArrowFunction(node)) {
      if (!ts.isVariableDeclaration(node.parent) || node.parent.initializer !== node) return [];
      if (!ts.isIdentifier(node.parent.name)) return null;
      const declarationKind = variableDeclarationKind(node.parent);
      return declarationKind ? [`${declarationKind}-arrow:${node.parent.name.text}`] : null;
    }
    if (ts.isFunctionExpression(node)) {
      if (ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) {
        if (!ts.isIdentifier(node.parent.name)) return null;
        const declarationKind = variableDeclarationKind(node.parent);
        if (!declarationKind) return null;
        return [
          `${declarationKind}-function-expression:${node.parent.name.text}`,
          ...(node.name ? [`function-expression:${node.name.text}`] : [])
        ];
      }
      return node.name ? [`function-expression:${node.name.text}`] : [];
    }
    return null;
  };
  const isLexicalFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration => (
    ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
  );
  const lexicalOwnerChunks = (node: ts.Node, includeSelf = false): LexicalOwnerChunk[] | null => {
    const reversedChunks: LexicalOwnerChunk[] = [];
    for (
      let current: ts.Node | undefined = includeSelf ? node : node.parent;
      current && current !== sourceFile;
      current = current.parent
    ) {
      if (!isLexicalFunctionLike(current)) continue;
      const segments = lexicalOwnerSegments(current);
      if (segments === null) return null;
      if (segments.length > 0) reversedChunks.push({ node: current, segments });
    }
    return reversedChunks.reverse();
  };
  const isCanonicalRootOwner = (node: ts.FunctionLikeDeclaration): boolean => {
    if (ts.isFunctionDeclaration(node)) return node.parent === sourceFile;
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && ts.isVariableDeclaration(node.parent)
      && ts.isVariableDeclarationList(node.parent.parent)
      && ts.isVariableStatement(node.parent.parent.parent)
    ) return node.parent.parent.parent.parent === sourceFile;
    return false;
  };
  const ownerChainCounts = new Map<string, number>();
  const countNamedOwnerChains = (node: ts.Node): void => {
    if (isLexicalFunctionLike(node)) {
      const ownSegments = lexicalOwnerSegments(node);
      const chunks = ownSegments && ownSegments.length > 0 ? lexicalOwnerChunks(node, true) : null;
      if (chunks && chunks.length > 0 && isCanonicalRootOwner(chunks[0]!.node)) {
        const chain = chunks.flatMap((chunk) => chunk.segments).join('>');
        ownerChainCounts.set(chain, (ownerChainCounts.get(chain) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, countNamedOwnerChains);
  };
  ts.forEachChild(sourceFile, countNamedOwnerChains);
  const processDispatchOrdinals = new Map<string, number>();
  const reviewProcessDispatch = (node: ts.CallExpression, loader: string): void => {
    const chunks = lexicalOwnerChunks(node)
      ?? rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    const rootChunk = chunks[0]
      ?? rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    if (!isCanonicalRootOwner(rootChunk.node)) {
      rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    }
    const segments: string[] = [];
    for (const chunk of chunks) {
      segments.push(...chunk.segments);
      const chainPrefix = segments.join('>');
      if (ownerChainCounts.get(chainPrefix) !== 1) {
        rejectUnmodeledLoader(`ambiguous process dispatcher owner ${chainPrefix}`);
      }
    }
    const chain = segments.join('>');
    const ordinalKey = `${repositoryPath}::${chain}::${loader}`;
    const ordinal = (processDispatchOrdinals.get(ordinalKey) ?? 0) + 1;
    processDispatchOrdinals.set(ordinalKey, ordinal);
    const identity = `${ordinalKey}#${ordinal}`;
    if (!TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)) {
      rejectUnmodeledLoader(`unreviewed process dispatcher ${identity}`);
    }
    reviewedProcessDispatchers.add(identity);
  };

  const isImportBindingDeclaration = (identifier: ts.Identifier): boolean => (
    (ts.isImportClause(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isImportSpecifier(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isNamespaceImport(identifier.parent) && identifier.parent.name === identifier)
  );
  const isPropertyName = (identifier: ts.Identifier): boolean => (
    (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertyAssignment(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isMethodDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertyDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertySignature(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isGetAccessorDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isSetAccessorDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isBindingElement(identifier.parent) && identifier.parent.propertyName === identifier)
  );
  const isTypeOnlyIdentifier = (identifier: ts.Identifier): boolean => {
    for (let current: ts.Node | undefined = identifier.parent; current; current = current.parent) {
      if (ts.isTypeNode(current)) return true;
      if (ts.isImportClause(current) && current.isTypeOnly) return true;
      if (ts.isImportSpecifier(current) && current.isTypeOnly) return true;
      if (ts.isExportSpecifier(current) && current.isTypeOnly) return true;
      if (ts.isStatement(current)) return false;
    }
    return false;
  };

  function visitRuntimeLoaders(node: ts.Node): void {
    if (
      ts.isIdentifier(node)
      && TCB_FORBIDDEN_GLOBAL_ALIASES.has(node.text)
      && !isPropertyName(node)
    ) rejectUnmodeledLoader(`unapproved global namespace ${node.text}`);
    if (
      ts.isIdentifier(node)
      && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(node.text)
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
    ) {
      const isDirectInvocation = (
        (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectInvocation) rejectUnmodeledLoader(`indirect global loader ${node.text}`);
    }
    if (
      ts.isIdentifier(node)
      && node.text === 'module'
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
    ) {
      const isDirectRequireOwner = (
        ts.isPropertyAccessExpression(node.parent)
        && node.parent.expression === node
        && node.parent.name.text === 'require'
      );
      if (!isDirectRequireOwner) rejectUnmodeledLoader('escaped module loader namespace');
    }
    if (isImportMeta(node)) {
      if (ts.isElementAccessExpression(node.parent) && node.parent.expression === node) {
        rejectUnmodeledLoader('computed import.meta member');
      }
      if (
        !ts.isPropertyAccessExpression(node.parent)
        || node.parent.expression !== node
        || !TCB_IMPORT_META_SAFE_MEMBERS.has(node.parent.name.text)
      ) rejectUnmodeledLoader('escaped or unclassified import.meta namespace');
    }
    if (ts.isIdentifier(node) && node.text === 'Bun' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('indirect Bun namespace Bun');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'globalThis' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('escaped globalThis namespace');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'process' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('escaped process namespace');
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (
        node.name.text === 'require'
        && !(
          (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
          && node.parent.expression === node
        )
      ) rejectUnmodeledLoader(`indirect require member ${node.getText(sourceFile)}`);
      const bunNamespace = bunNamespaceName(node.expression);
      if (bunNamespace) {
        const member = node.name.text;
        if (TCB_BUN_PROCESS_LOADERS.has(`Bun.${member}`)) {
          if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) {
            rejectUnmodeledLoader(`indirect Bun process loader ${bunNamespace}.${member}`);
          }
        } else if (!TCB_BUN_SAFE_GLOBAL_MEMBERS.has(member)) {
          rejectUnmodeledLoader(`unclassified Bun namespace member ${bunNamespace}.${member}`);
        }
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'globalThis') {
        const member = node.name.text;
        if (member !== 'Bun') {
          if (!TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(member)) {
            rejectUnmodeledLoader(`unclassified globalThis member ${member}`);
          }
          const isDirectInvocation = (
            (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
            && node.parent.expression === node
          );
          if (!isDirectInvocation) rejectUnmodeledLoader(`indirect globalThis loader ${member}`);
        }
      }
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'process'
        && !TCB_PROCESS_SAFE_MEMBERS.has(node.name.text)
      ) rejectUnmodeledLoader(`unclassified process member ${node.name.text}`);
    }
    if (
      ts.isPropertyAccessExpression(node)
      && bunNamespaceName(node) === 'globalThis.Bun'
      && !(
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      )
      && !ts.isTypeOfExpression(node.parent)
    ) rejectUnmodeledLoader('indirect Bun namespace globalThis.Bun');
    if (
      ts.isIdentifier(node)
      && bunProcessBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect bun process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect node:child_process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessNamespaces.has(node.text)
      && !isImportBindingDeclaration(node)
    ) {
      const namespaceAccess = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node
        ? node.parent
        : rejectUnmodeledLoader(`indirect node:child_process namespace ${node.text}`);
      const member = namespaceAccess.name.text;
      if (!TCB_CHILD_PROCESS_LOADERS.has(member)) {
        rejectUnmodeledLoader(`unclassified node:child_process member ${node.text}.${member}`);
      }
      if (!ts.isCallExpression(namespaceAccess.parent) || namespaceAccess.parent.expression !== namespaceAccess) {
        rejectUnmodeledLoader(`indirect node:child_process member ${node.text}.${member}`);
      }
    }
    if (
      ts.isElementAccessExpression(node)
      && bunNamespaceName(node.expression) !== null
    ) rejectUnmodeledLoader(`computed Bun namespace member ${bunNamespaceName(node.expression)}[...]`);
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'globalThis'
    ) rejectUnmodeledLoader('computed globalThis member');
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'process'
    ) rejectUnmodeledLoader('computed process member');
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'module'
    ) rejectUnmodeledLoader('computed module loader member');
    if (
      ts.isElementAccessExpression(node)
      && isImportMeta(node.expression)
    ) rejectUnmodeledLoader('computed import.meta member');
    if (
      ts.isElementAccessExpression(node)
      && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
      && node.argumentExpression.text === 'require'
    ) rejectUnmodeledLoader('computed require member');
    if (ts.isImportEqualsDeclaration(node)) rejectUnmodeledLoader('import = require');
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (node.arguments.length !== 1 || argument === undefined) {
        throw new Error(`TCB runtime dynamic import is not statically resolvable: ${repositoryPath}.`);
      }
      if (!ts.isStringLiteral(argument)) {
        throw new Error(`TCB runtime dynamic import is not statically resolvable: ${repositoryPath}.`);
      }
      if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(argument.text)) {
        rejectUnmodeledLoader(`dynamic ${argument.text} import`);
      }
      specifiers.push(argument.text);
    }
    if (ts.isCallExpression(node)) {
      const name = loaderName(node.expression);
      if (name === 'require') rejectUnmodeledLoader('require');
      if (name === 'createRequire') rejectUnmodeledLoader('createRequire');
      if (name === 'importScripts') rejectUnmodeledLoader('importScripts');
      if (name === 'eval') rejectUnmodeledLoader('eval');
      if (name === 'Function') rejectUnmodeledLoader('Function');
      if (name === 'Worker') rejectUnmodeledLoader('Worker');
      if (name !== null && (TCB_CHILD_PROCESS_LOADERS.has(name) || TCB_BUN_PROCESS_LOADERS.has(name))) {
        reviewProcessDispatch(node, name);
      }
    }
    if (ts.isNewExpression(node)) {
      const name = loaderName(node.expression);
      if (name !== null && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(name)) rejectUnmodeledLoader(name);
    }
    ts.forEachChild(node, visitRuntimeLoaders);
  }
  ts.forEachChild(sourceFile, visitRuntimeLoaders);

  return specifiers.filter((specifier) => {
    if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
    if (TCB_APPROVED_EXTERNAL_IMPORTS.has(specifier)) return false;
    throw new Error(
      `TCB runtime import is outside the approved relative/external policy: ${repositoryPath} -> ${specifier}.`
    );
  });
}

function runtimeRelativeImports(repositoryPath: string, reviewedProcessDispatchers: Set<string>): string[] {
  const absolutePath = path.join(compilerRoot, ...repositoryPath.split('/'));
  return runtimeRelativeImportsFromSource(
    repositoryPath,
    readFileSync(absolutePath, 'utf8'),
    reviewedProcessDispatchers
  );
}

function resolveRepositoryImport(from: string, specifier: string): string {
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (resolved.endsWith('.js')) resolved = `${resolved.slice(0, -3)}.ts`;
  if (!path.posix.extname(resolved)) resolved = `${resolved}.ts`;
  if (!existsSync(path.join(compilerRoot, ...resolved.split('/')))) {
    throw new Error(`TCB runtime import does not resolve: ${from} -> ${specifier} (${resolved}).`);
  }
  return resolved;
}

function trustedRuntimeClosure(): {
  closure: Set<string>;
  reviewedEdges: Set<string>;
  reviewedProcessDispatchers: Set<string>;
} {
  const closure = new Set<string>();
  const reviewedEdges = new Set<string>();
  const reviewedProcessDispatchers = new Set<string>();
  const queue: string[] = [...TCB_RUNTIME_ENTRYPOINTS];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const specifier of runtimeRelativeImports(current, reviewedProcessDispatchers)) {
      const resolved = resolveRepositoryImport(current, specifier);
      const edge = `${current} -> ${resolved}`;
      if (TCB_REVIEWED_SUT_EDGES.has(edge)) {
        reviewedEdges.add(edge);
        continue;
      }
      queue.push(resolved);
    }
  }
  return { closure, reviewedEdges, reviewedProcessDispatchers };
}

function matchesCanonicalTrustRoot(repositoryPath: string): boolean {
  return CodexDevelopmentTrustRootPathsV1.some((trustedPath) => (
    trustedPath.endsWith('/') ? repositoryPath.startsWith(trustedPath) : repositoryPath === trustedPath
  )) || CodexDevelopmentTrustRootPathPrefixesV1.some((prefix) => repositoryPath.startsWith(prefix));
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
    'docs/governance/nexus-absorption-ledger.yml'
  ];
  const value = fixture(manifestSource(changedFiles), changedFiles);

  expect(value.plan).toMatchObject({
    selectionResolved: true,
    selectionReasons: ['ownership-impact'],
    affectedOwners: ['roadmap-authority']
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

test('base-side V7 merge gate independently reconstructs the real P0 plan and rejects self-signed drift', async () => {
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

test('trusted workflow TCB declarations exactly equal the canonical base-side trust root', async () => {
  const canonicalFiles = CodexDevelopmentTrustRootPathsV1.filter((entry) => !entry.endsWith('/'));
  const canonicalDirectories = CodexDevelopmentTrustRootPathsV1.filter((entry) => entry.endsWith('/'));
  for (const workflowPath of [
    '.github/workflows/compiler-pr-validation.yml',
    '.github/workflows/compiler-release-validation.yml'
  ]) {
    const source = await readCompilerFile(workflowPath);
    expect(workflowTrustArray(source, 'trustFiles')).toEqual(canonicalFiles);
    expect(workflowTrustArray(source, 'trustDirectories')).toEqual(canonicalDirectories);
    expect(workflowTrustArray(source, 'trustPrefixes')).toEqual([...CodexDevelopmentTrustRootPathPrefixesV1]);
  }
});

test('verifier runtime import closure stays inside the TCB except for the reviewed product seam', () => {
  const { closure, reviewedEdges, reviewedProcessDispatchers } = trustedRuntimeClosure();
  expect(closure.size).toBe(49);
  expect(reviewedProcessDispatchers.size).toBe(22);
  expect([...reviewedEdges].sort()).toEqual([...TCB_REVIEWED_SUT_EDGES].sort());
  expect([...reviewedProcessDispatchers].sort()).toEqual([...TCB_REVIEWED_PROCESS_DISPATCHERS].sort());
  expect([...closure].filter((entry) => !matchesCanonicalTrustRoot(entry)).sort()).toEqual([]);
  expect([...closure]).toEqual(expect.arrayContaining([
    'platform/dev-runner/command-runner.ts',
    'platform/dev-runner/dependency-bootstrap.ts',
    'platform/dev-runner/env-manager.ts',
    'platform/dev-runner/import-organizer.ts',
    'platform/dev-runner/test-runner.ts',
    'platform/dev-runner/typecheck-runner.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/bun-runtime-version.ts',
    'platform/shared/collections.ts',
    'platform/shared/contract-freeze-contract.ts',
    'platform/shared/paths.ts',
    'platform/shared/process.ts',
    'platform/shared/project-runtime.ts',
    'platform/shared/repository-path-contract.ts',
    'platform/shared/runtime-dependency-spec.ts',
    'scripts/install-git-hooks.ts'
  ]));
});

test('dev-runner captures one immutable bootstrap path before executable work', async () => {
  const source = await readCompilerFile('platform/dev-runner.ts');
  const sourceFile = ts.createSourceFile('platform/dev-runner.ts', source, ts.ScriptTarget.Latest, true);
  const firstExecutableIndex = sourceFile.statements.findIndex((statement) => !ts.isImportDeclaration(statement));
  const firstExecutable = sourceFile.statements[firstExecutableIndex];
  expect(firstExecutableIndex).toBeGreaterThan(-1);
  expect(sourceFile.statements.slice(0, firstExecutableIndex).every(ts.isImportDeclaration)).toBe(true);
  if (!firstExecutable || !ts.isVariableStatement(firstExecutable)) {
    throw new Error('dev-runner bootstrap path must be the first executable top-level statement.');
  }
  const declarationList = firstExecutable.declarationList;
  const [declaration] = declarationList.declarations;
  expect(firstExecutable.modifiers).toBeUndefined();
  expect(declarationList.flags & ts.NodeFlags.Const).not.toBe(0);
  expect(declarationList.declarations).toHaveLength(1);
  if (
    !declaration
    || !ts.isIdentifier(declaration.name)
    || declaration.name.text !== 'devRunnerFilePath'
    || declaration.type !== undefined
    || declaration.exclamationToken !== undefined
    || !declaration.initializer
    || !ts.isCallExpression(declaration.initializer)
  ) throw new Error('dev-runner bootstrap path must be a single inferred top-level const.');

  const initializer = declaration.initializer;
  const [moduleUrl] = initializer.arguments;
  expect(initializer.questionDotToken).toBeUndefined();
  expect(initializer.arguments).toHaveLength(1);
  expect(ts.isIdentifier(initializer.expression) && initializer.expression.text === 'fileURLToPath').toBe(true);
  if (
    !moduleUrl
    || !ts.isPropertyAccessExpression(moduleUrl)
    || moduleUrl.name.text !== 'url'
    || !ts.isMetaProperty(moduleUrl.expression)
    || moduleUrl.expression.keywordToken !== ts.SyntaxKind.ImportKeyword
    || moduleUrl.expression.name.text !== 'meta'
  ) throw new Error('dev-runner bootstrap path must capture fileURLToPath(import.meta.url).');

  const nodeUrlImports = sourceFile.statements.filter((statement): statement is ts.ImportDeclaration => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === 'node:url'
  ));
  expect(nodeUrlImports).toHaveLength(1);
  const importClause = nodeUrlImports[0]?.importClause;
  expect(importClause?.isTypeOnly).toBe(false);
  expect(importClause?.name).toBeUndefined();
  expect(
    importClause?.namedBindings
    && ts.isNamedImports(importClause.namedBindings)
    && importClause.namedBindings.elements.length === 1
    && importClause.namedBindings.elements[0]?.propertyName === undefined
    && importClause.namedBindings.elements[0]?.name.text === 'fileURLToPath'
  ).toBe(true);

  const importMetaNodes: ts.MetaProperty[] = [];
  const pathIdentifiers: ts.Identifier[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isMetaProperty(node)
      && node.keywordToken === ts.SyntaxKind.ImportKeyword
      && node.name.text === 'meta'
    ) importMetaNodes.push(node);
    if (ts.isIdentifier(node) && node.text === 'devRunnerFilePath') pathIdentifiers.push(node);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  expect(importMetaNodes).toHaveLength(1);
  expect(importMetaNodes[0]).toBe(moduleUrl.expression);
  expect(pathIdentifiers).toHaveLength(2);
  const runtimeReference = pathIdentifiers.find((identifier) => identifier !== declaration.name);
  if (!runtimeReference || !ts.isArrayLiteralExpression(runtimeReference.parent)) {
    throw new Error('reenterWithResolvedDependencies must use the captured dev-runner path.');
  }
  const spawnArguments = runtimeReference.parent;
  const spawnCall = spawnArguments.parent;
  expect(spawnArguments.elements[0]).toBe(runtimeReference);
  expect(
    ts.isCallExpression(spawnCall)
    && ts.isIdentifier(spawnCall.expression)
    && spawnCall.expression.text === 'spawnSync'
    && spawnCall.arguments[1] === spawnArguments
  ).toBe(true);
  let owner: ts.Node = runtimeReference;
  while (owner.parent !== sourceFile) owner = owner.parent;
  expect(
    ts.isFunctionDeclaration(owner)
    && owner.name?.text === 'reenterWithResolvedDependencies'
  ).toBe(true);
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
    'platform/dev-runner.ts',
    "import { spawnSync } from 'node:child_process'; function reenterWithResolvedDependencies() { [0].forEach(() => spawnSync(process.execPath, [])); }"
  )).toEqual([]);
  for (const member of [
    'constructor() { spawnSync(process.execPath, []); }',
    'get value() { spawnSync(process.execPath, []); return 1; }',
    'set value(value: number) { spawnSync(process.execPath, []); void value; }'
  ]) {
    expect(() => runtimeRelativeImportsFromSource(
      'platform/dev-runner.ts',
      `import { spawnSync } from 'node:child_process'; function reenterWithResolvedDependencies() { class Candidate { ${member} } }`
    )).toThrow('(process dispatcher without a canonical named lexical owner).');
  }
  expect(() => runtimeRelativeImportsFromSource(
    'platform/dev-runner.ts',
    "import { spawnSync } from 'node:child_process'; function reenterWithResolvedDependencies() { spawnSync(process.execPath, []); spawnSync(process.execPath, []); }"
  )).toThrow(
    'unreviewed process dispatcher platform/dev-runner.ts::function-declaration:reenterWithResolvedDependencies::spawnSync#2'
  );
  for (const [fixtureName, source, ownerChain] of [
    [
      'nested-function-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { function reenterWithResolvedDependencies() { spawnSync(process.execPath, []); } }",
      'function-declaration:unexpectedOwner>function-declaration:reenterWithResolvedDependencies'
    ],
    [
      'nested-arrow-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { const reenterWithResolvedDependencies = () => spawnSync(process.execPath, []); }",
      'function-declaration:unexpectedOwner>const-arrow:reenterWithResolvedDependencies'
    ],
    [
      'nested-method-owner',
      "import { spawnSync } from 'node:child_process'; function unexpectedOwner() { class Candidate { reenterWithResolvedDependencies() { spawnSync(process.execPath, []); } } }",
      'function-declaration:unexpectedOwner>method-declaration:reenterWithResolvedDependencies'
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
    'platform/dev-runner.ts',
    "import { spawnSync } from 'node:child_process'; function reenterWithResolvedDependencies() { spawnSync(process.execPath, []); } function reenterWithResolvedDependencies() {}"
  )).toThrow('(ambiguous process dispatcher owner function-declaration:reenterWithResolvedDependencies).');
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

test('head manifest cannot authorize edits to the canonical verifier trust root', () => {
  expect(matchesCanonicalTrustRoot('scripts/codex/merge-gate.ts')).toBe(true);
  const value = fixture(manifestSource(['source/', 'scripts/codex/merge-gate.ts']));
  value.rawInput.changedRecords = [{ status: 'changed', path: 'scripts/codex/merge-gate.ts' }];
  expect(() => CodexDevelopmentEvaluateMergeGateV1({
    rawInput: value.rawInput,
    manifestBytes: value.manifestBytes,
    rawAttestation: value.attestation,
    rawEvidence: value.rawEvidence
  })).toThrow('manual-bootstrap-required');
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
    rawEvidence: { ...revision.rawEvidence, contractRevision: 'ci-verification-v6' }
  })).toThrow('Verification evidence CI revision mismatch');
});

test('historical Work Package revisions remain parseable but cannot satisfy the current gate', () => {
  const current = fixture();
  const legacyBytes = Buffer.from(manifestSource().replace('ci-verification-v8', 'ci-verification-v6'));
  const legacyManifest = CodexDevelopmentParseWorkPackageManifestV1(legacyBytes.toString('utf8'), MANIFEST_PATH);
  expect(legacyManifest.ciRevision).toBe('ci-verification-v6');

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
});

test('artifact metadata and repository_dispatch run identity fail closed', () => {
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    (value) => { value.rawInput.attestationArtifact.digest = null; },
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
  const mergeGateJob = mergeWorkflow.slice(mergeWorkflow.indexOf('  merge-gate:'));
  expect(mergeGateJob.indexOf('- name: Checkout trusted current base')).toBeLessThan(
    mergeGateJob.indexOf('- name: Resolve live PR and exact trusted artifacts'),
  );
  expect(mergeGateJob).toContain('ref: ${{ github.sha }}');
  expect(mergeGateJob).not.toContain('ref: ${{ steps.resolve.outputs.base }}');
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
  expect((mergeWorkflow.match(/sec-verification-v8-/gu) ?? []).length).toBe(2);
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
  expect(prWorkflow).toContain('`${entry.mode}:${entry.type}:${entry.sha}`');
  expect(releaseWorkflow).toContain('`${entry.mode}:${entry.type}:${entry.sha}`');
});
