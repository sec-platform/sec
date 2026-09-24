import { expect, test } from 'bun:test';

import {
  CodexDevelopmentActivateMainHealthRepairRollingPlan,
  CodexDevelopmentAssertPriorFreezeProjection,
  CodexDevelopmentAssertRollingMachineBaseBinding,
  CodexDevelopmentCreateFreezeProjection,
  CodexDevelopmentParseActivePointer,
  CodexDevelopmentParseCurrentStateSpec,
  CodexDevelopmentParseRollingMachineProjection,
  CodexDevelopmentParseRollingPlan,
  CodexDevelopmentPromoteRollingPlan,
  CodexDevelopmentRenderActivePointer,
  CodexDevelopmentRenderCommittedCandidateReplanRollingPlan,
  CodexDevelopmentRequiresCommittedCandidateProjectionRefresh
} from '../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import { WorkPackageManifestDigest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import {
  compileWorkRollingTransitionProjection,
  renderWorkRollingTransitionPlan
} from '../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';

const exactMain = 'a'.repeat(40);
const exactMainTree = 'b'.repeat(40);
const activePackageId = 'active-v1';
const candidates = ['candidate-two-v1', 'candidate-three-v1'] as const;

function proposalManifest(packageId: string, tracking: string, base = exactMain): Buffer {
  return Buffer.from(`---
schema: codex-development-work-package-v1
id: ${packageId}
tracking: ${tracking}
base: '${base}'
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
tasks:
  - id: proposal
    owner: development-governance-maintainer
    ownedPaths:
      - config/repository/work-packages/${packageId}.md
forbiddenPaths:
  - src/compiler/
acceptance:
  - "Proposal remains authority-free."
tests:
  - tests/unit/document-control-plane-projection.test.ts
---

# Proposal
`, 'utf8');
}

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

test('proposal-only freeze renders one authority-free tracking:none successor', () => {
  const proposalPackageId = 'private-sandbox-python-runtime-transition';
  const currentManifest = proposalManifest(activePackageId, 'issue-1');
  const targetManifest = proposalManifest(proposalPackageId, 'none');
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
    catalog: config/repository/work-selection.md#sec-work-selection-roadmap-catalog-v1
    projection: sec-work-selection-live-v1-required
`);
  const currentPointerSource = CodexDevelopmentRenderActivePointer({
    spec,
    manifestPath: `config/repository/work-packages/${activePackageId}.md`,
    manifestDigest: WorkPackageManifestDigest(currentManifest) as `sha256:${string}`,
    reviewedOn: '2026-08-21'
  });
  const common = {
    spec,
    currentPointerSource,
    currentRollingPlanSource: legacyRollingPlanSource(),
    currentManifestBytes: currentManifest,
    manifestPath: `config/repository/work-packages/${proposalPackageId}.md`,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  };
  const proposalOnly = {
    currentResolution: { state: 'none', reason: 'matching-default-blob' } as const,
    defaultManifestBytes: currentManifest
  };
  const projection = CodexDevelopmentCreateFreezeProjection({ ...common, proposalOnly });
  expect(projection.authoringDisposition).toBe('proposal-only');
  expect(projection.retiredManifestPath).toBe(`config/repository/work-packages/${activePackageId}.md`);
  expect(CodexDevelopmentParseRollingPlan(projection.rollingPlanSource).activePackageId)
    .toBe(proposalPackageId);
  expect(CodexDevelopmentParseRollingMachineProjection(projection.rollingPlanSource)).toMatchObject({
    schema: 'sec-work-rolling-proposal-projection-v1',
    exactMain,
    exactMainTree,
    authority: 'none',
    active: {
      packageId: proposalPackageId,
      tracking: 'none',
      manifestPath: `config/repository/work-packages/${proposalPackageId}.md`,
      manifestDigest: WorkPackageManifestDigest(targetManifest)
    },
    candidates: [...candidates]
  });
  expect(() => CodexDevelopmentParseRollingMachineProjection(
    projection.rollingPlanSource.replace('"authority": "none"', '"authority": "activation"')
  )).toThrow('authority none');
  expect(() => CodexDevelopmentAssertRollingMachineBaseBinding({
    projection: CodexDevelopmentParseRollingMachineProjection(projection.rollingPlanSource)!,
    exactMain,
    exactMainTree: 'c'.repeat(40)
  })).toThrow('does not bind the exact live default tree');

  expect(() => CodexDevelopmentCreateFreezeProjection({
    ...common,
    proposalOnly: { ...proposalOnly, currentResolution: {
      state: 'active',
      manifest: `config/repository/work-packages/${activePackageId}.md`,
      manifestDigest: WorkPackageManifestDigest(currentManifest)
    } }
  })).toThrow('byte-exact on the live default');
  expect(() => CodexDevelopmentCreateFreezeProjection({
    ...common,
    manifestBytes: proposalManifest(proposalPackageId, 'issue-2'),
    proposalOnly
  })).toThrow('target tracking must be none');
  expect(() => CodexDevelopmentCreateFreezeProjection({
    ...common,
    proposalOnly,
    workSelectionProjection: { receipt: {} as never }
  })).toThrow('forbids selection, repair, and replan');
  expect(() => CodexDevelopmentCreateFreezeProjection({
    ...common,
    proposalOnly,
    requestedRollingPlanSource: legacyRollingPlanSource()
  })).toThrow('forbids caller-authored rolling-plan bytes');
  expect(() => CodexDevelopmentCreateFreezeProjection({
    ...common,
    manifestBytes: proposalManifest(proposalPackageId, 'none', 'f'.repeat(40)),
    proposalOnly
  })).toThrow('base must equal the exact live default revision');
  expect(() => CodexDevelopmentCreateFreezeProjection(common))
    .toThrow('requires exactly one live WorkDecision or MainHealth repair projection');
});

test('MainHealth topology is compiled and rendered atomically instead of slicing prior Markdown', () => {
  const repairPackageId = 'main-health-repair-v1';
  const rendered = CodexDevelopmentActivateMainHealthRepairRollingPlan({
    source: legacyRollingPlanSource(),
    packageId: repairPackageId,
    manifestPath: `config/repository/work-packages/${repairPackageId}.md`,
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
  const projection = compileWorkRollingTransitionProjection({
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
      manifestPath: `config/repository/work-packages/${activePackageId}.md`,
      manifestDigest: rawSha256('active-manifest')
    },
    candidates
  });
  const source = renderWorkRollingTransitionPlan({ projection, reviewedOn: '2026-08-21' });
  expect(() => CodexDevelopmentPromoteRollingPlan({
    source,
    packageId: candidates[0]
  })).toThrow('require the canonical WorkDecision or transition renderer');
});

test('prior freeze validation derives a machine successor without legacy Markdown promotion', () => {
  const targetPackageId = candidates[0];
  const immutableCandidates = [...candidates, 'candidate-four-v1'] as const;
  const targetManifestPath = `config/repository/work-packages/${targetPackageId}.md`;
  const targetManifest = Buffer.from(`---
schema: codex-development-work-package-v1
id: ${targetPackageId}
tracking: issue-2
base: '${exactMain}'
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: projection
    owner: projection-owner
    ownedPaths:
      - ${targetManifestPath}
forbiddenPaths:
  - private/
acceptance:
  - "Prior machine projection remains exact."
tests:
  - tests/unit/document-control-plane-projection.test.ts
---

# Prior machine projection
`, 'utf8');
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
    catalog: config/repository/work-selection.md#sec-work-selection-roadmap-catalog-v1
    projection: sec-work-selection-live-v1-required
`);
  const manifestDigest = WorkPackageManifestDigest(
    targetManifest
  ) as `sha256:${string}`;
  const pointerSource = CodexDevelopmentRenderActivePointer({
    spec,
    manifestPath: targetManifestPath,
    manifestDigest,
    reviewedOn: '2026-08-21'
  });
  const authority = {
    kind: 'committed-candidate-replan' as const,
    sourceHead: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    sourceManifestDigest: rawSha256('source-manifest'),
    sourcePointerRevision: rawSha256('source-pointer'),
    sourceRollingRevision: rawSha256('source-rolling')
  };
  const immutable = renderWorkRollingTransitionPlan({
    projection: compileWorkRollingTransitionProjection({
      exactMain,
      exactMainTree,
      authority,
      active: {
        packageId: activePackageId,
        tracking: 'issue-1',
        manifestPath: `config/repository/work-packages/${activePackageId}.md`,
        manifestDigest: rawSha256('active-manifest')
      },
      candidates: immutableCandidates
    }),
    reviewedOn: '2026-08-21'
  });
  const successor = renderWorkRollingTransitionPlan({
    projection: compileWorkRollingTransitionProjection({
      exactMain,
      exactMainTree,
      authority,
      active: {
        packageId: targetPackageId,
        tracking: 'issue-2',
        manifestPath: targetManifestPath,
        manifestDigest
      },
      candidates: [candidates[1], immutableCandidates[2]]
    }),
    reviewedOn: '2026-08-21'
  });
  expect(() => CodexDevelopmentAssertPriorFreezeProjection({
    spec,
    immutableRollingPlanSource: immutable,
    pointerSource,
    rollingPlanSource: successor,
    manifestPath: targetManifestPath,
    manifestBytes: targetManifest
  })).not.toThrow();

  const reordered = renderWorkRollingTransitionPlan({
    projection: compileWorkRollingTransitionProjection({
      exactMain,
      exactMainTree,
      authority,
      active: {
        packageId: targetPackageId,
        tracking: 'issue-2',
        manifestPath: targetManifestPath,
        manifestDigest
      },
      candidates: [immutableCandidates[2], candidates[1]]
    }),
    reviewedOn: '2026-08-21'
  });
  expect(() => CodexDevelopmentAssertPriorFreezeProjection({
    spec,
    immutableRollingPlanSource: immutable,
    pointerSource,
    rollingPlanSource: reordered,
    manifestPath: targetManifestPath,
    manifestBytes: targetManifest
  })).toThrow('preserve immutable active and ordered candidate topology');
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
manifest: config/repository/work-packages/${activePackageId}.md
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
    targetManifestPath: `config/repository/work-packages/${activePackageId}.md`,
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
    targetManifestPath: `config/repository/work-packages/${activePackageId}.md`,
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
  const manifestPath = `config/repository/work-packages/${activePackageId}.md`;
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
  - private/
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
  const sourceManifestDigest = WorkPackageManifestDigest(
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
    catalog: config/repository/work-selection.md#sec-work-selection-roadmap-catalog-v1
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
      manifestDigest: WorkPackageManifestDigest(targetManifest)
    }
  });
  const refreshedAuthority = {
    ...authority,
    sourceHead: 'e'.repeat(40),
    sourceTree: 'f'.repeat(40),
    sourceManifestDigest: WorkPackageManifestDigest(
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
    active: { manifestDigest: WorkPackageManifestDigest(targetManifest) }
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
    .toBe(WorkPackageManifestDigest(targetManifest) as `sha256:${string}`);
  expect(CodexDevelopmentParseRollingMachineProjection(
    repairedDerivedDigest.rollingPlanSource
  )).toMatchObject({ authority: staleDerivedDigestAuthority });
  const refreshedProjection = CodexDevelopmentParseRollingMachineProjection(
    refreshed.rollingPlanSource
  );
  const permittedProjectionDeltaPaths = new Set([
    manifestPath,
    'config/repository/active-work-package.md',
    'config/repository/rolling-plan.md'
  ]);
  const exactActive = {
    packageId: activePackageId,
    tracking: 'issue-1',
    manifestPath,
    manifestDigest: WorkPackageManifestDigest(targetManifest) as `sha256:${string}`
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
    manifestPath: `config/repository/work-packages/${repairPackageId}.md`,
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
