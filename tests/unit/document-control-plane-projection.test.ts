import { expect, test } from 'bun:test';

import {
  CodexDevelopmentActivateMainHealthRepairRollingPlan,
  CodexDevelopmentAssertRollingMachineBaseBinding,
  CodexDevelopmentCreateFreezeProjection,
  CodexDevelopmentParseActivePointer,
  CodexDevelopmentParseCurrentStateSpec,
  CodexDevelopmentParseRollingMachineProjection,
  CodexDevelopmentParseRollingPlan,
  CodexDevelopmentPromoteRollingPlan,
  CodexDevelopmentRenderCommittedCandidateReplanRollingPlan,
  CodexDevelopmentRequiresCommittedCandidateProjectionRefresh
} from '../../src/control/documentation/document-control-plane-contract.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../src/control/task/contract/work-package.ts';
import {
  compileSecWorkRollingTransitionProjection,
  renderSecWorkRollingTransitionPlan
} from '../../src/control/work-selection/live-contract.ts';
import { rawSha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';

const exactMain = 'a'.repeat(40);
const exactMainTree = 'b'.repeat(40);
const activePackageId = 'active-v1';
const candidates = ['candidate-two-v1', 'candidate-three-v1'] as const;

function legacyRollingPlanSource(): string {
  return `---
title: projection fixture
status: active
domain: current-control
last-reviewed: 2026-08-21
---

# Projection fixture

## 当前唯一 Work Package

### ${activePackageId}

Legacy prose must not survive a generated transition.

## 候选 Work Package

### 1. ${candidates[0]}

Legacy candidate prose.

### 2. ${candidates[1]}

Legacy candidate prose.
`;
}

test('MainHealth topology is compiled and rendered atomically instead of slicing prior Markdown', () => {
  const repairPackageId = 'main-health-repair-v1';
  const rendered = CodexDevelopmentActivateMainHealthRepairRollingPlan({
    source: legacyRollingPlanSource(),
    packageId: repairPackageId,
    manifestPath: `docs/work-packages/${repairPackageId}.md`,
    manifestDigest: rawSha256('repair-manifest'),
    mainSha: exactMain,
    mainTreeSha: exactMainTree,
    healthRevision: rawSha256('health'),
    ledgerDigest: rawSha256('ledger'),
    decisionDigest: rawSha256('decision'),
    failureFingerprints: [rawSha256('failure')],
    publishedActivePackageId: activePackageId,
    reviewedOn: '2026-08-21'
  });
  expect(CodexDevelopmentParseRollingPlan(rendered)).toEqual({
    activePackageId: repairPackageId,
    candidatePackageIds: [...candidates]
  });
  expect(CodexDevelopmentParseRollingMachineProjection(rendered)).toMatchObject({
    schema: 'sec-work-rolling-transition-projection-v1',
    exactMain,
    exactMainTree,
    authority: { kind: 'main-health-repair' },
    active: { packageId: repairPackageId, tracking: 'none' },
    candidates: [...candidates]
  });
  expect(rendered).not.toContain('Legacy prose');
  expect(rendered).not.toContain('Legacy candidate prose');
});

test('a digest-bound topology cannot be promoted by Markdown surgery', () => {
  const projection = compileSecWorkRollingTransitionProjection({
    exactMain,
    exactMainTree,
    authority: {
      kind: 'committed-candidate-replan',
      sourceHead: 'c'.repeat(40),
      sourceTree: 'd'.repeat(40),
      sourceManifestDigest: rawSha256('source-manifest'),
      sourcePointerRevision: rawSha256('source-pointer'),
      sourceRollingRevision: rawSha256('source-rolling')
    },
    active: {
      packageId: activePackageId,
      tracking: 'issue-1',
      manifestPath: `docs/work-packages/${activePackageId}.md`,
      manifestDigest: rawSha256('active-manifest')
    },
    candidates
  });
  const source = renderSecWorkRollingTransitionPlan({ projection, reviewedOn: '2026-08-21' });
  expect(() => CodexDevelopmentPromoteRollingPlan({
    source,
    packageId: candidates[0]
  })).toThrow('require the canonical WorkDecision or transition renderer');
});

test('committed replan binds immutable source bytes and emits one canonical full document', () => {
  const sourceManifest = Buffer.from('immutable source manifest', 'utf8');
  const sourceManifestDigest = rawSha256(sourceManifest);
  const pointerSource = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-20
---

# Active fixture

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/${activePackageId}.md
manifestDigest: ${sourceManifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  const authority = {
    kind: 'committed-candidate-replan' as const,
    sourceHead: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    sourceManifestDigest,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(legacyRollingPlanSource())
  };
  const rendered = CodexDevelopmentRenderCommittedCandidateReplanRollingPlan({
    currentPointerSource: pointerSource,
    currentRollingPlanSource: legacyRollingPlanSource(),
    currentManifestBytes: sourceManifest,
    authority,
    targetManifestPath: `docs/work-packages/${activePackageId}.md`,
    targetManifestDigest: rawSha256('next manifest'),
    targetPackageId: activePackageId,
    targetTracking: 'issue-1',
    exactMain,
    exactMainTree,
    reviewedOn: '2026-08-21'
  });
  const projection = CodexDevelopmentParseRollingMachineProjection(rendered)!;
  expect(projection).toMatchObject({
    exactMain,
    exactMainTree,
    authority,
    active: { packageId: activePackageId, tracking: 'issue-1' }
  });
  expect(rendered).not.toContain('Legacy prose');
  expect(() => CodexDevelopmentRenderCommittedCandidateReplanRollingPlan({
    currentPointerSource: pointerSource,
    currentRollingPlanSource: `${legacyRollingPlanSource()}drift`,
    currentManifestBytes: sourceManifest,
    authority,
    targetManifestPath: `docs/work-packages/${activePackageId}.md`,
    targetManifestDigest: rawSha256('next manifest'),
    targetPackageId: activePackageId,
    targetTracking: 'issue-1',
    exactMain,
    exactMainTree,
    reviewedOn: '2026-08-21'
  })).toThrow('does not bind the immutable source bytes');
  CodexDevelopmentAssertRollingMachineBaseBinding({
    projection,
    exactMain,
    exactMainTree
  });
  expect(() => CodexDevelopmentAssertRollingMachineBaseBinding({
    projection,
    exactMain: 'e'.repeat(40),
    exactMainTree
  })).toThrow('exact live default revision');
  expect(() => CodexDevelopmentAssertRollingMachineBaseBinding({
    projection,
    exactMain,
    exactMainTree: 'f'.repeat(40)
  })).toThrow('exact live default tree');
});

test('required same-package freeze compiles the committed replan instead of accepting caller prose', () => {
  const manifestPath = `docs/work-packages/${activePackageId}.md`;
  const sourceManifest = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${activePackageId}
tracking: issue-1
base: '${exactMain}'
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: projection
    owner: projection-owner
    ownedPaths:
      - ${manifestPath}
forbiddenPaths:
  - public-docs/
acceptance:
  - "Projection remains canonical."
tests:
  - tests/unit/document-control-plane-projection.test.ts
---

# Projection
`, 'utf8');
  const targetManifest = Buffer.concat([
    sourceManifest,
    Buffer.from('\nReplanned generation.\n', 'utf8')
  ]);
  const sourceManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    sourceManifest
  ) as `sha256:${string}`;
  const pointerSource = `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-08-20
---

# Active fixture

\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${manifestPath}
manifestDigest: ${sourceManifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`;
  const authority = {
    kind: 'committed-candidate-replan' as const,
    sourceHead: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    sourceManifestDigest,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(legacyRollingPlanSource())
  };
  const spec = CodexDevelopmentParseCurrentStateSpec(`schema: sec-current-state-live-v1
resolver:
  command: bun src/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts:
  workSelection:
    catalog: docs/roadmap.md#sec-work-selection-roadmap-catalog-v1
    projection: sec-work-selection-live-v1-required
`);
  const result = CodexDevelopmentCreateFreezeProjection({
    spec,
    currentPointerSource: pointerSource,
    currentRollingPlanSource: legacyRollingPlanSource(),
    currentManifestBytes: sourceManifest,
    committedCandidateReplanProjection: authority,
    manifestPath,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  });
  expect(result.retiredManifestPath).toBeNull();
  expect(CodexDevelopmentParseRollingMachineProjection(result.rollingPlanSource)).toMatchObject({
    authority,
    active: {
      packageId: activePackageId,
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest)
    }
  });
  const refreshedAuthority = {
    ...authority,
    sourceHead: 'e'.repeat(40),
    sourceTree: 'f'.repeat(40),
    sourceManifestDigest: CodexDevelopmentWorkPackageManifestDigest(
      targetManifest
    ) as `sha256:${string}`,
    sourcePointerRevision: rawSha256(result.pointerSource),
    sourceRollingRevision: rawSha256(result.rollingPlanSource)
  };
  const refreshed = CodexDevelopmentCreateFreezeProjection({
    spec,
    currentPointerSource: result.pointerSource,
    currentRollingPlanSource: result.rollingPlanSource,
    currentManifestBytes: targetManifest,
    committedCandidateReplanProjection: refreshedAuthority,
    manifestPath,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  });
  expect(refreshed.retiredManifestPath).toBeNull();
  expect(CodexDevelopmentParseRollingMachineProjection(refreshed.rollingPlanSource)).toMatchObject({
    authority: refreshedAuthority,
    active: { manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest) }
  });
  const staleDerivedDigestAuthority = {
    ...refreshedAuthority,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(result.rollingPlanSource)
  };
  const repairedDerivedDigest = CodexDevelopmentCreateFreezeProjection({
    spec,
    currentPointerSource: pointerSource,
    currentRollingPlanSource: result.rollingPlanSource,
    currentManifestBytes: targetManifest,
    committedCandidateReplanProjection: staleDerivedDigestAuthority,
    manifestPath,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  });
  expect(CodexDevelopmentParseActivePointer(repairedDerivedDigest.pointerSource).manifestDigest)
    .toBe(CodexDevelopmentWorkPackageManifestDigest(targetManifest) as `sha256:${string}`);
  expect(CodexDevelopmentParseRollingMachineProjection(
    repairedDerivedDigest.rollingPlanSource
  )).toMatchObject({ authority: staleDerivedDigestAuthority });
  const refreshedProjection = CodexDevelopmentParseRollingMachineProjection(
    refreshed.rollingPlanSource
  );
  const permittedProjectionDeltaPaths = new Set([
    manifestPath,
    'docs/work/active-work-package.md',
    'docs/work/rolling-plan.md'
  ]);
  const exactActive = {
    packageId: activePackageId,
    tracking: 'issue-1',
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest) as `sha256:${string}`
  };
  expect(CodexDevelopmentRequiresCommittedCandidateProjectionRefresh({
    projection: refreshedProjection,
    exactMain,
    exactMainTree,
    active: exactActive,
    sourceTreeDeltaPaths: [...permittedProjectionDeltaPaths],
    permittedProjectionDeltaPaths
  })).toBe(false);
  expect(CodexDevelopmentRequiresCommittedCandidateProjectionRefresh({
    projection: refreshedProjection,
    exactMain,
    exactMainTree,
    active: exactActive,
    sourceTreeDeltaPaths: ['src/compiler/changed.ts'],
    permittedProjectionDeltaPaths
  })).toBe(true);
  expect(() => CodexDevelopmentCreateFreezeProjection({
    spec,
    currentPointerSource: pointerSource,
    currentRollingPlanSource: legacyRollingPlanSource(),
    currentManifestBytes: sourceManifest,
    requestedRollingPlanSource: `${result.rollingPlanSource}\ncaller prose\n`,
    committedCandidateReplanProjection: authority,
    manifestPath,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  })).toThrow('must equal the canonical transition renderer exactly');
});

test('heading drift is rejected against the digest-bound machine topology', () => {
  const repairPackageId = 'main-health-repair-v1';
  const rendered = CodexDevelopmentActivateMainHealthRepairRollingPlan({
    source: legacyRollingPlanSource(),
    packageId: repairPackageId,
    manifestPath: `docs/work-packages/${repairPackageId}.md`,
    manifestDigest: rawSha256('repair-manifest'),
    mainSha: exactMain,
    mainTreeSha: exactMainTree,
    healthRevision: rawSha256('health'),
    ledgerDigest: rawSha256('ledger'),
    decisionDigest: rawSha256('decision'),
    failureFingerprints: [rawSha256('failure')],
    publishedActivePackageId: activePackageId,
    reviewedOn: '2026-08-21'
  });
  expect(() => CodexDevelopmentParseRollingPlan(rendered.replace(
    `### 1. ${candidates[0]}`,
    '### 1. drifted-candidate-v1'
  ))).toThrow('headings do not equal the digest-bound machine projection');
});
