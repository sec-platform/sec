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
import { parseGitChangedRecordsOutput } from '../../platform/shared/ci-git-changed-files.ts';
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
ciRevision: ci-verification-v6
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

function fixture(manifest = manifestSource()) {
  const manifestBytes = Buffer.from(manifest);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes);
  const manifestBlobSha = gitBlobSha(manifestBytes);
  const parsedManifest = CodexDevelopmentParseWorkPackageManifestV1(manifest, MANIFEST_PATH);
  const changedFiles = ['source/model/semantic-contracts.yaml'];
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
    contractRevision: 'ci-verification-v6',
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
  const verificationName = `sec-verification-v7-${parsedManifest.requiredProfile}-pr-123-base-${BASE}-head-${HEAD}-run-200-attempt-1`;
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
    changedRecords: [{ status: 'changed', path: 'source/model/semantic-contracts.yaml' }],
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
const P0_TEST_FILES = [
  'tests/contract/semantic-mutation-apply-contract.test.ts',
  'tests/integration/semantic-mutation-apply.test.ts',
  'tests/integration/semantic-mutation-production-sentinel.test.ts',
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
    ? 'requiredProfile: quick\nciRevision: ci-verification-v6\n'
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
    const entries = String(git(['ls-tree', '-r', '-z', '--full-tree', ref])).split('\0').filter(Boolean);
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
  const changedRecords = parseGitChangedRecordsOutput(String(git([
    '-c', 'core.quotepath=false', 'diff', '--name-status', '-z', '--find-renames', '--find-copies',
    '--diff-filter=ACDMRTUXB', P0_BASE, P0_HEAD
  ])));
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
      name: `sec-verification-v7-quick-pr-113-base-${P0_BASE}-head-${P0_HEAD}-run-200-attempt-1`,
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

function runtimeRelativeImports(repositoryPath: string): string[] {
  const absolutePath = path.join(compilerRoot, ...repositoryPath.split('/'));
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
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
      specifiers.push(statement.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers.filter((specifier) => specifier.startsWith('.'));
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

function trustedRuntimeClosure(): { closure: Set<string>; reviewedEdges: Set<string> } {
  const closure = new Set<string>();
  const reviewedEdges = new Set<string>();
  const queue: string[] = [...TCB_RUNTIME_ENTRYPOINTS];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const specifier of runtimeRelativeImports(current)) {
      const resolved = resolveRepositoryImport(current, specifier);
      const edge = `${current} -> ${resolved}`;
      if (TCB_REVIEWED_SUT_EDGES.has(edge)) {
        reviewedEdges.add(edge);
        continue;
      }
      queue.push(resolved);
    }
  }
  return { closure, reviewedEdges };
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

test('base-side V7 merge gate independently reconstructs the real P0 plan and rejects self-signed drift', async () => {
  const value = await p0MergeFixture();
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
  const { closure, reviewedEdges } = trustedRuntimeClosure();
  expect([...reviewedEdges].sort()).toEqual([...TCB_REVIEWED_SUT_EDGES].sort());
  expect([...closure].filter((entry) => !matchesCanonicalTrustRoot(entry)).sort()).toEqual([]);
  expect([...closure]).toEqual(expect.arrayContaining([
    'platform/dev-runner/command-runner.ts',
    'platform/dev-runner/typecheck-runner.ts',
    'platform/shared/collections.ts',
    'platform/shared/contract-freeze-contract.ts',
    'platform/shared/paths.ts',
    'platform/shared/process.ts',
    'platform/shared/project-runtime.ts',
    'platform/shared/runtime-dependency-spec.ts'
  ]));
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
});

test('historical Work Package revisions remain parseable but cannot satisfy the current gate', () => {
  const current = fixture();
  const legacyBytes = Buffer.from(manifestSource().replace('ci-verification-v6', 'ci-verification-v5'));
  const legacyManifest = CodexDevelopmentParseWorkPackageManifestV1(legacyBytes.toString('utf8'), MANIFEST_PATH);
  expect(legacyManifest.ciRevision).toBe('ci-verification-v5');

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
  expect(mergeWorkflow).toContain('artifact digest, expiry, or bounded size metadata is invalid');
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
  expect(mergeWorkflow).toContain('digest: artifact.digest ?? null');
  expect(mergeWorkflow).toContain('expiresAt.toISOString() !== artifact.expiresAt');
  expect(mergeWorkflow).toContain('!Number.isSafeInteger(artifact.sizeInBytes)');
  expect(mergeWorkflow).toContain('93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5');
  expect(mergeWorkflow).toContain('d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4');
  expect(mergeWorkflow).toContain('path: .tmp/codex/candidate');
  expect(mergeWorkflow).toContain('fetch-depth: 2');
  expect(mergeWorkflow).toContain('ref: 514e6e401659f18ecffca19856a11354d66d05df');
  expect(mergeWorkflow).toContain('--candidate-git-dir .tmp/codex/candidate/.git');
  expect(mergeWorkflow).toContain('--legacy-git-dir .tmp/codex/legacy/.git');
  expect((mergeWorkflow.match(/sec-verification-v7-/gu) ?? []).length).toBe(2);
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
