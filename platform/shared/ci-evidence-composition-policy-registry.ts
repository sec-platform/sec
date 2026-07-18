import {
  CodexDevelopmentEvidenceCompositionDigestV1,
  CodexDevelopmentEvidenceCompositionPolicyRevisionV1,
  CodexDevelopmentReusableEvidenceFormatV1,
  CodexDevelopmentVerificationScopeV1,
  CodexDevelopmentVerificationSelectionDigestV1,
  type CodexDevelopmentEvidenceCompositionAssignmentV1,
  type CodexDevelopmentEvidenceCompositionPolicyGateV1,
  type CodexDevelopmentEvidenceCompositionPolicyV1,
  type CodexDevelopmentEvidenceCompositionRefinementV1,
  type CodexDevelopmentEvidenceReuseBindingV1,
  type CodexDevelopmentExactGitBlobV1,
  type CodexDevelopmentRequiredGitBlobV1,
  type CodexDevelopmentVerificationScopeInventoryV1
} from './ci-evidence-reuse-contract.ts';
import type { CodexDevelopmentGitChangedRecordV1 } from './ci-git-changed-files.ts';
import { CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION } from './ci-verification-revision.ts';

export const CodexDevelopmentSm3P0EvidencePolicyIdV1 =
  'sm3-p0-local-isolated-runner-v1' as const;
export const CodexDevelopmentSm3P0WorkPackageIdV1 =
  'sm3-p0-local-isolated-runner-v1' as const;

export const CodexDevelopmentSm3P0LegacyTestedHeadV1 =
  '514e6e401659f18ecffca19856a11354d66d05df' as const;
const LEGACY_TESTED_HEAD = CodexDevelopmentSm3P0LegacyTestedHeadV1;
const LEGACY_TESTED_TREE = '74e94777fe0be825121723a48b5aa41cd9bb43a8';
const LEGACY_EVIDENCE_IDENTITY = 'sm3-p0-exact-production-seam-single-job-owner-durable-v4';
const LEGACY_EVIDENCE_PATH =
  'docs/evidence/v0-4-semantic-mutation-single-job-owner-production-pass-2026-07-18.json';
const LEGACY_EVIDENCE_BLOB = '3fbfa041119f70429b5f6cc4440816b50ab3a0ef';
const LEGACY_EVIDENCE_DIGEST =
  'sha256:d932974c6b30eff01dce86de37cbd4c8eac4d358185fd9b655c2751d8559ddb4';
const LEGACY_TITLE =
  'SM-3 dry-run/apply share one plan revision, publish atomically, rebuild live derivatives, and replay exactly once';
const APPLY_TEST = 'tests/integration/semantic-mutation-apply.test.ts';
const PRODUCTION_HELPER = 'tests/helpers/semantic-mutation-production-sentinel.ts';
const PRODUCTION_WRAPPER = 'tests/integration/semantic-mutation-production-sentinel.test.ts';

type ProtectedTransition = {
  path: string;
  status: 'added' | 'changed' | 'removed';
  baseBlob: string | null;
  currentBlob: string | null;
};

const PROTECTED_PRODUCT_TRANSITIONS: readonly ProtectedTransition[] = [
  ['platform/compiler/semantic-mutation/isolated-verification-child-progress.ts', 'changed', 'ea1050fca78a570926f6f229d8ef384d00ca17fb', '7e3b7c93531b8b6efc9cc632be9325db08f0d59b'],
  ['platform/compiler/semantic-mutation/mutation-terminal-record.ts', 'changed', '336598e0d1bd70e125f4917e2f35c488e7353b5c', '84ab7da46680cc45777848715f7858767193371c'],
  ['platform/compiler/semantic-mutation/windows-file-attributes.ts', 'changed', 'abec8eca787299ceed093622010020678a9f1b83', '7b6ce13ea6a4bb5569ac9d86337bd96d1184991c'],
  ['platform/compiler/verify/assert-isolated-staging-tree.ts', 'changed', '14469d6be88e51712483f3b8601b11b75608e3f2', '44342eb143a1bf8d92165e5774a53e25b4d0f11f'],
  ['platform/compiler/verify/run-semantic-mutation-isolated-child.ts', 'changed', 'b6bd055c7bc17c9c6fd82bf6ea597bb8786a8843', '8b84e7c6eaecf97256eee127783bb6f5e5290c7b'],
  ['platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts', 'added', null, 'dbb3272aff0600697dc387dcd419f9012e26cbf3'],
  ['platform/compiler/verify/semantic-mutation-isolated-verification-failure.ts', 'added', null, '8598b077a1804384924d3df21eda67273feb9e85'],
  ['platform/compiler/verify/semantic-mutation-runner-build-child.ts', 'removed', '7457da0016d9814948447c701cd7a240edffa418', null],
  ['platform/compiler/verify/semantic-mutation-runner-build-protocol.ts', 'removed', '099676c416de4af0adc6b90ce40084886b6ba367', null],
  ['platform/compiler/verify/semantic-mutation-runner-build-settlement.ts', 'removed', '68f13842746cf951dde8bb698b059933aa98bc1f', null],
  ['platform/compiler/verify/semantic-mutation-staged-project-input.ts', 'added', null, '132085a3beb6f3f667258c0c6d116665460abf27'],
  ['platform/compiler/verify/staged-verification-proof.ts', 'added', null, 'b22d520cdf0f52b1a235dff021d1ab75cf712d49'],
  ['platform/compiler/verify/typecheck-project.ts', 'changed', '0b0aa6d253532ab02de71e7814d83da6acf7c83d', '7c4558a6512070b6368146a889d7635dfdf4598c'],
  ['platform/compiler/verify/validate-resolved-templates.ts', 'changed', '73f0897354d9be9e3416facea306bd5990bb1866', '73e7e7715d227963d44a3d629a9876d2586cf17d'],
  ['platform/compiler/verify/verify-project.ts', 'changed', '127da94a83de0ce0f7876972c56d683e8ec39451', 'b5d914560210edb85f0653c4989943a262405afb'],
  ['platform/orchestrator/pipeline-orchestrator.ts', 'changed', '3031b7c18b4a87ad6cc3a7169e5f63ebc81b2a05', '4f0f394a280fd57c1c886d4b474037c1fcaa7988'],
  ['platform/orchestrator/semantic-mutation-isolated-verification-runner.ts', 'changed', '0cc6ff557c1313d0ffaa8bc4d43a49fe563a559e', '8a58b7abfc378f9e4ea54f540ec23c155e1231b8'],
  ['platform/orchestrator/semantic-mutation-orchestrator.ts', 'changed', 'd7a25177511d89a2b0e257c33838d18ebd43318d', '6314b2d8d017e8286027588b36fd185a6f796d2a'],
  ['platform/orchestrator/verify-orchestrator.ts', 'changed', 'bea57f8a5691c62f757478a8e3878cc209431aa0', '89b79f0b33c7634561dc4e4f53215be3d3ca2997'],
  ['platform/shared/observed-process.ts', 'changed', '227e8ff87c4c331bcd169be29dc7fa9cf3093aab', '11ae78c5ae3a5a0bccc7e7d7846fad14d9750153'],
  ['platform/shared/verification-types.ts', 'changed', 'd31af07c7928f8bb42f4e0250795709cf33e6423', '45fd1a765c9d555f5c7df052e97e2b2ca34fe4cc'],
  ['platform/shared/workspace-write-lease.ts', 'changed', '63ed67cd0c0a0d9fdf3aa73b81e3f9a82aa3468f', '57a651b0693fde3cd465d13e7d77ae7cd2a40746'],
  ['tests/contract/semantic-mutation-apply-contract.test.ts', 'changed', 'af7188a3caaa2d926391efacb6ff039b356e3c0a', 'dbdb66ae661b79b604ffc6e79dfaca2ebeaf8239'],
  ['tests/contract/test-architecture.test.ts', 'changed', '7ed7004fb996c5dd09fa4610acfb960600ca3d35', '6aebefe3fec6f0f18eda103fe04a364124729452'],
  ['tests/contract/test-impact.test.ts', 'changed', '6e9d931a32f8e5e1e0247d1fc74a0bbda5d219fc', '5d7da4f7df39bd18ba4acff5263c6166557f1459'],
  [PRODUCTION_HELPER, 'added', null, '3b7bef28eef8c1279ed4f5d523a001e53429f47f'],
  [APPLY_TEST, 'changed', '524a994a2b02ec2e09eab0b0331e5bdbd8367892', '0d21dbf6839572d9e3e840ee9cb411ae909c9777'],
  [PRODUCTION_WRAPPER, 'added', null, 'ef528bfb6cd55287b4fd101d8841cf33d8391920'],
  ['tests/integration/semantic-mutation-recovery-lifecycle.test.ts', 'changed', 'c4b8c5c12843c5d6b263324b98c896de64ea2678', '67af18a132b5a506bb41c3c50d77ea082ded8327'],
  ['tests/unit/canonical-ir-identity-revision.test.ts', 'changed', '133c4061a8cc22fab9ed53c8c98afe07891d9917', 'b632b8f2be8f7b4b4dde4767fa085f62916d862f'],
  ['tests/unit/observed-process-lifecycle.test.ts', 'changed', '22f02ce94cd641b5c0060990107b183ea099b618', '19de88b52449d780e234b9443fe678e9140b6200'],
  ['tests/unit/semantic-mutation-isolated-child-fence.test.ts', 'changed', '56c89b78f7a51ceb84eaf59630f4cbae163b8681', '86a48a04a5289d130fc406ef650eece4c2893be7']
].map(([path, status, baseBlob, currentBlob]) => ({ path, status, baseBlob, currentBlob })) as readonly ProtectedTransition[];

const ALLOWED_TRANSITION_PATHS = new Set([
  ...PROTECTED_PRODUCT_TRANSITIONS.map(({ path }) => path),
  'docs/03-MVP实施计划与路线图.md',
  'docs/08-Verification、Provenance与Graph规范.md',
  'docs/14-Engineering IR与语义事实规范.md',
  'docs/evidence/v0-4-semantic-mutation-bounded-isolation-scan-exact-stop-record-2026-07-17.json',
  'docs/evidence/v0-4-semantic-mutation-browser-closure-exact-timeout-stop-record-2026-07-17.json',
  'docs/evidence/v0-4-semantic-mutation-local-child-exact-public-verification-2026-07-17.json',
  'docs/evidence/v0-4-semantic-mutation-local-child-host-alias-exact-public-stop-record-2026-07-17.json',
  'docs/evidence/v0-4-semantic-mutation-proof-reuse-exact-timeout-stop-record-2026-07-17.json',
  'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-durable-exact-stop-record-2026-07-18.json',
  'docs/evidence/v0-4-semantic-mutation-restored-runtime-input-exact-result-loss-record-2026-07-18.json',
  LEGACY_EVIDENCE_PATH,
  'docs/test-feedback-and-ci-lanes.md',
  'docs/work-packages/sm3-p0-local-isolated-runner-v1.md'
]);

const EXPECTED_RISK_FILES = [
  'tests/e2e/end-to-end.test.ts',
  'tests/e2e/graph.test.ts',
  'tests/e2e/local-views.test.ts',
  'tests/e2e/pipeline.test.ts',
  'tests/e2e/registry.test.ts',
  'tests/e2e/semantic-runtime-contract.test.ts',
  'tests/e2e/verification.test.ts'
] as const;

function exactEntry(blobSha: string): CodexDevelopmentExactGitBlobV1 {
  return { blobSha, mode: '100644', type: 'blob' };
}

function sameEntry(
  actual: CodexDevelopmentExactGitBlobV1 | null,
  blobSha: string | null
): boolean {
  return blobSha === null
    ? actual === null
    : actual?.blobSha === blobSha && actual.mode === '100644' && actual.type === 'blob';
}

function changedRecordPathSet(records: readonly CodexDevelopmentGitChangedRecordV1[]): Set<string> {
  return new Set(records.flatMap((record) => record.previousPath === undefined
    ? [record.path]
    : [record.previousPath, record.path]));
}

export function CodexDevelopmentRequiredEvidenceCompositionPolicyV1(options: {
  records: readonly CodexDevelopmentGitChangedRecordV1[];
  baseHead: string;
  currentHead: string;
  gitBlob: (ref: string, path: string) => CodexDevelopmentExactGitBlobV1 | null;
}): typeof CodexDevelopmentSm3P0EvidencePolicyIdV1 | null {
  const baselineStillActive = PROTECTED_PRODUCT_TRANSITIONS.every((transition) => (
    sameEntry(options.gitBlob(options.baseHead, transition.path), transition.baseBlob)
  ));
  if (!baselineStillActive) return null;

  const changedPaths = changedRecordPathSet(options.records);
  if (!PROTECTED_PRODUCT_TRANSITIONS.some(({ path }) => changedPaths.has(path))) return null;
  const unexpected = [...changedPaths].filter((path) => !ALLOWED_TRANSITION_PATHS.has(path));
  if (unexpected.length > 0) {
    throw new Error(`Protected SM3 P0 transition contains unregistered paths: ${unexpected.sort().join(', ')}.`);
  }
  const recordsByPath = new Map(options.records.map((record) => [record.path, record]));
  for (const transition of PROTECTED_PRODUCT_TRANSITIONS) {
    const record = recordsByPath.get(transition.path);
    if (!record || record.status !== transition.status || record.previousPath !== undefined) {
      throw new Error(`Protected SM3 P0 transition record mismatch: ${transition.path}.`);
    }
    if (
      !sameEntry(options.gitBlob(options.baseHead, transition.path), transition.baseBlob)
      || !sameEntry(options.gitBlob(options.currentHead, transition.path), transition.currentBlob)
    ) throw new Error(`Protected SM3 P0 transition Git identity mismatch: ${transition.path}.`);
  }
  return CodexDevelopmentSm3P0EvidencePolicyIdV1;
}

function uniqueRequiredBlobs(
  blobs: readonly CodexDevelopmentRequiredGitBlobV1[]
): CodexDevelopmentRequiredGitBlobV1[] {
  const byPath = new Map(blobs.map((blob) => [blob.path, { ...blob }]));
  return [...byPath.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const SIBLING_TITLES = [
  'SM-3 public dry-run blocks on unfinished recovery authority without publishing live source',
  'SM-3 coordinator pre-publish failure matrix preserves every live byte and stops later producers',
  'SM-3 coordinator post-publish restore and journal failures become durable recovery-required'
] as const;

export type CodexDevelopmentEvidenceCompositionPolicyFactoryContextV1 = {
  policyId: string;
  workPackageId: string;
  inventory: CodexDevelopmentVerificationScopeInventoryV1;
  runtime: string;
  currentHead: string;
  gitBlob: (ref: string, path: string) => CodexDevelopmentExactGitBlobV1 | null;
};

function sm3P0Policy(
  context: CodexDevelopmentEvidenceCompositionPolicyFactoryContextV1
): CodexDevelopmentEvidenceCompositionPolicyV1 {
  if (context.workPackageId !== CodexDevelopmentSm3P0WorkPackageIdV1) {
    throw new Error('SM3 P0 evidence policy is registered for a different Work Package.');
  }
  for (const transition of PROTECTED_PRODUCT_TRANSITIONS) {
    if (!sameEntry(context.gitBlob(context.currentHead, transition.path), transition.currentBlob)) {
      throw new Error(`SM3 P0 policy current product identity mismatch: ${transition.path}.`);
    }
  }
  const affectedParent = context.inventory.scopes.find(({ scopeId }) => scopeId === 'gate:affected-tests');
  const riskParent = context.inventory.scopes.find(({ scopeId }) => scopeId === 'gate:impact-risk');
  if (!affectedParent || !riskParent || affectedParent.refinement !== 'allowed' || riskParent.refinement !== 'allowed') {
    throw new Error('SM3 P0 policy requires both canonical aggregate parents.');
  }
  const affectedByPath = new Map(affectedParent.requiredGitBlobs.map((blob) => [blob.path, blob]));
  const applyBlob = affectedByPath.get(APPLY_TEST);
  const wrapperBlob = affectedByPath.get(PRODUCTION_WRAPPER)
    ?? (() => {
      const entry = context.gitBlob(context.currentHead, PRODUCTION_WRAPPER);
      return entry ? { path: PRODUCTION_WRAPPER, ...entry } : undefined;
    })();
  if (!applyBlob || !wrapperBlob) throw new Error('SM3 P0 affected inventory omits the production title or wrapper.');
  const riskPaths = riskParent.requiredGitBlobs.map(({ path }) => path);
  if (JSON.stringify(riskPaths) !== JSON.stringify(EXPECTED_RISK_FILES)) {
    throw new Error(
      `SM3 P0 risk inventory does not match the seven registered suites: ${JSON.stringify(riskPaths)}.`
    );
  }

  const protectedCurrentBlobs = PROTECTED_PRODUCT_TRANSITIONS.flatMap((transition) => {
    if (transition.currentBlob === null) return [];
    return [{ path: transition.path, ...exactEntry(transition.currentBlob) }];
  });
  const heavyBlobs = uniqueRequiredBlobs([
    ...protectedCurrentBlobs,
    applyBlob,
    wrapperBlob,
    ...[PRODUCTION_HELPER].flatMap((path) => {
      const entry = context.gitBlob(context.currentHead, path);
      return entry ? [{ path, ...entry }] : [];
    })
  ]);
  const residualBlobs = affectedParent.requiredGitBlobs.filter(({ path }) => (
    path !== APPLY_TEST && path !== PRODUCTION_WRAPPER
  ));
  if (residualBlobs.length === 0) throw new Error('SM3 P0 affected inventory has no residual current-runtime tests.');

  const refinements: CodexDevelopmentEvidenceCompositionRefinementV1[] = [];
  const refinedScopes: CodexDevelopmentVerificationScopeV1[] = [];
  for (const parent of context.inventory.scopes) {
    if (parent.scopeId === affectedParent.scopeId) {
      const children: CodexDevelopmentVerificationScopeV1[] = [];
      children.push(CodexDevelopmentVerificationScopeV1(
        'sm3-p0:affected-residual',
        context.runtime,
        ['bun', 'test', ...residualBlobs.map(({ path }) => path), '--timeout', '180000'],
        { kind: 'sm3-p0-residual-fast', parentScopeId: parent.scopeId },
        residualBlobs,
        refinedScopes.length + children.length
      ));
      const siblingArgv = [
        'bun', 'test', APPLY_TEST, '--test-name-pattern',
        `^(?:${SIBLING_TITLES.map(regexEscape).join('|')})$`, '--timeout', '180000'
      ];
      for (const [index, title] of SIBLING_TITLES.entries()) {
        children.push(CodexDevelopmentVerificationScopeV1(
          `sm3-p0:sibling:${index + 1}`,
          context.runtime,
          siblingArgv,
          { kind: 'sm3-p0-sibling-title', title },
          [applyBlob],
          refinedScopes.length + children.length
        ));
      }
      children.push(CodexDevelopmentVerificationScopeV1(
        'sm3-p0:production-delta',
        context.runtime,
        ['bun', 'test', PRODUCTION_WRAPPER, '--timeout', '300000'],
        { kind: 'sm3-p0-production-delta', legacyTitle: LEGACY_TITLE },
        heavyBlobs,
        refinedScopes.length + children.length,
        { SEC_RUN_SM3_PRODUCTION_SENTINEL: '1' }
      ));
      refinements.push({
        parentScopeId: parent.scopeId,
        parentInventoryDigest: parent.inventoryDigest,
        scopes: children
      });
      refinedScopes.push(...children);
      continue;
    }
    if (parent.scopeId === riskParent.scopeId) {
      const child = CodexDevelopmentVerificationScopeV1(
        'sm3-p0:risk-exact-files',
        context.runtime,
        ['bun', 'test', ...riskPaths, '--timeout', '180000'],
        { kind: 'sm3-p0-exact-risk-files', files: riskPaths },
        riskParent.requiredGitBlobs,
        refinedScopes.length
      );
      refinements.push({
        parentScopeId: parent.scopeId,
        parentInventoryDigest: parent.inventoryDigest,
        scopes: [child]
      });
      refinedScopes.push(child);
      continue;
    }
    refinedScopes.push({
      ...parent,
      order: refinedScopes.length,
      argv: [...parent.argv],
      env: { ...parent.env },
      requiredGitBlobs: parent.requiredGitBlobs.map((blob) => ({ ...blob }))
    });
  }

  const legacyMappings = protectedCurrentBlobs.flatMap((current, index) => {
    const tested = context.gitBlob(LEGACY_TESTED_HEAD, current.path);
    if (!tested) return [];
    return [{
      id: `sm3-input-${index.toString().padStart(3, '0')}`,
      testedPath: current.path,
      testedBlobSha: tested.blobSha,
      testedMode: tested.mode,
      testedType: tested.type,
      currentPath: current.path,
      currentBlobSha: current.blobSha,
      currentMode: current.mode,
      currentType: current.type
    }];
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (!legacyMappings.some(({ currentPath }) => currentPath === APPLY_TEST)) {
    throw new Error('SM3 P0 legacy evidence closure omits its exact tested title source.');
  }
  const productionScope = refinedScopes.find(({ scopeId }) => scopeId === 'sm3-p0:production-delta')!;
  const reuse: CodexDevelopmentEvidenceReuseBindingV1 = {
    evidenceFormat: CodexDevelopmentReusableEvidenceFormatV1,
    evidenceIdentity: LEGACY_EVIDENCE_IDENTITY,
    evidencePath: LEGACY_EVIDENCE_PATH,
    evidenceDigest: LEGACY_EVIDENCE_DIGEST,
    evidenceBlobSha: LEGACY_EVIDENCE_BLOB,
    evidenceMode: '100644',
    evidenceType: 'blob',
    environmentBinding: 'legacy-unbound-v1',
    scopeBinding: 'base-policy-exact-v1',
    expandable: false,
    recordType: 'frozen-exact-production-pass-evidence',
    status: 'PASS',
    rerunAllowed: false,
    testedHead: LEGACY_TESTED_HEAD,
    testedTree: LEGACY_TESTED_TREE,
    runtime: 'bun@1.3.6',
    argv: [
      'bun', 'test', APPLY_TEST, '--test-name-pattern', `^${LEGACY_TITLE}$`, '--timeout', '300000'
    ],
    gitBlobs: legacyMappings,
    inventory: [{
      scopeId: productionScope.scopeId,
      inventoryDigest: productionScope.inventoryDigest,
      gitBlobIds: legacyMappings.map(({ id }) => id)
    }]
  };

  const assignments: CodexDevelopmentEvidenceCompositionAssignmentV1[] = [];
  const gates: CodexDevelopmentEvidenceCompositionPolicyGateV1[] = [];
  const siblingIds = new Set(SIBLING_TITLES.map((_, index) => `sm3-p0:sibling:${index + 1}`));
  for (const scope of refinedScopes) {
    const isProduction = scope.scopeId === productionScope.scopeId;
    const gateId = siblingIds.has(scope.scopeId)
      ? 'sm3-p0-siblings'
      : isProduction
        ? 'sm3-p0-production-delta'
        : `sm3-p0-gate-${scope.order.toString().padStart(2, '0')}`;
    assignments.push({
      scopeId: scope.scopeId,
      inventoryDigest: scope.inventoryDigest,
      disposition: isProduction ? 'delta' : 'executed',
      evidenceIdentity: isProduction ? LEGACY_EVIDENCE_IDENTITY : null,
      gateId
    });
    if (siblingIds.has(scope.scopeId) && gates.some((gate) => gate.gateId === gateId)) continue;
    const coveredScopeIds = siblingIds.has(scope.scopeId)
      ? refinedScopes.filter((candidate) => siblingIds.has(candidate.scopeId)).map(({ scopeId }) => scopeId)
      : [scope.scopeId];
    gates.push({
      order: gates.length,
      gateId,
      disposition: isProduction ? 'delta' : 'executed',
      runtime: context.runtime,
      argv: [...scope.argv],
      env: { ...scope.env },
      coveredScopeIds
    });
  }

  return {
    policyRevision: CodexDevelopmentEvidenceCompositionPolicyRevisionV1,
    policyId: CodexDevelopmentSm3P0EvidencePolicyIdV1,
    workPackageId: CodexDevelopmentSm3P0WorkPackageIdV1,
    ciRevision: CI_VERIFICATION_COMPOSITION_CONTRACT_REVISION,
    requiredProfile: 'quick',
    parentSelectionDigest: context.inventory.fullSelectionDigest,
    fullSelectionDigest: CodexDevelopmentVerificationSelectionDigestV1(
      'quick',
      context.inventory.fullChangedFiles,
      refinedScopes,
      context.inventory.fullChangedInputDigest
    ),
    refinements,
    assignments,
    gates,
    reusedEvidence: [reuse]
  };
}

export function CodexDevelopmentRegisteredEvidenceCompositionPolicyV1(
  context: CodexDevelopmentEvidenceCompositionPolicyFactoryContextV1
): CodexDevelopmentEvidenceCompositionPolicyV1 {
  if (context.policyId !== CodexDevelopmentSm3P0EvidencePolicyIdV1) {
    throw new Error(`Unknown base-registered evidence composition policy: ${context.policyId}.`);
  }
  return sm3P0Policy(context);
}

export function CodexDevelopmentSm3P0ProtectedTransitionDigestV1(): string {
  return CodexDevelopmentEvidenceCompositionDigestV1(PROTECTED_PRODUCT_TRANSITIONS);
}
