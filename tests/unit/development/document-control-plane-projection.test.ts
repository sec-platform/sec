import { expect, test } from 'bun:test';

import {
  activateMainHealthRepairRollingPlan,
  assertPriorFreezeProjection,
  assertRollingMachineBaseBinding,
  assertStablePlanRollingBinding,
  createFreezeProjection,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingMachineProjection,
  parseRollingPlan,
  projectStatusContinuation,
  promoteRollingPlan,
  renderActivePointer,
  requiresCommittedCandidateProjectionRefresh
  assertInitiallyAbsentEntryTransition,
  classifyFreezeConvergence,
  classifyInitiallyAbsentEntryTuple,
  classifyPublishedControlBinding,
  classifyTerminalRetirementPrefix,
  type InitiallyAbsentTuple,
  type InitiallyAbsentTupleEdge,
  type InitiallyAbsentTupleEntry,
  type InitiallyAbsentTuplePlatform,
  type InitiallyAbsentTupleState,
} from '../../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageAcceptsObservedBase,
  CodexDevelopmentWorkPackageManifestDigest
} from '../../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import {
  compileWorkRollingProposalProjection,
  compileWorkRollingTransitionProjection,
  parseWorkRollingMachineProjection,
  renderWorkRollingTransitionPlan
} from '../../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';

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
  - tests/unit/development/document-control-plane-projection.test.ts
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

function stablePlanBindingFixture(tracking = 'issue-1') {
  const bytes = Buffer.from(proposalManifest(activePackageId, tracking).toString('utf8')
    .replace('codex-development-work-package-v1', 'codex-development-work-package-v3')
    .replace(`base: '${exactMain}'\n`, ''));
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(bytes.toString('utf8'));
  const manifestPath = `config/repository/work-packages/${activePackageId}.md`;
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(bytes) as `sha256:${string}`;
  const projectionInput = {
    exactMain,
    exactMainTree,
    authority: {
      kind: 'committed-candidate-replan' as const,
      sourceHead: 'c'.repeat(40),
      sourceTree: 'd'.repeat(40),
      sourceManifestDigest: manifestDigest,
      sourcePointerRevision: rawSha256('prior pointer'),
      sourceRollingRevision: rawSha256('prior rolling')
    },
    active: { packageId: activePackageId, tracking, manifestPath, manifestDigest },
    candidates: [...candidates]
  };
  return {
    bytes,
    projectionInput,
    binding: { manifest, manifestPath, manifestDigest, exactMain, exactMainTree,
      projection: compileWorkRollingTransitionProjection(projectionInput) }
  };
}

test('stable plan bytes bind independently to each exact candidate base without minting authority', () => {
  const { bytes, projectionInput, binding } = stablePlanBindingFixture();
  for (const [main, tree] of [[exactMain, exactMainTree], ['e'.repeat(40), 'f'.repeat(40)]]) {
    const projection = compileWorkRollingTransitionProjection({
      ...projectionInput, exactMain: main!, exactMainTree: tree!
    });
    expect(assertStablePlanRollingBinding({
      ...binding, projection, exactMain: main!, exactMainTree: tree!
    })).toBeUndefined();
    expect(String(binding.manifestDigest)).toBe(CodexDevelopmentWorkPackageManifestDigest(bytes));
  }
  const proposal = stablePlanBindingFixture('none');
  expect(assertStablePlanRollingBinding({
    ...proposal.binding,
    projection: compileWorkRollingProposalProjection({
      ...proposal.projectionInput,
      active: { ...proposal.projectionInput.active, tracking: 'none' }
    })
  })).toBeUndefined();
});

test('stable plan binding rejects absent projections and stale base, tree, manifest or scope identity', () => {
  const { bytes, binding, projectionInput } = stablePlanBindingFixture();
  expect(() => assertStablePlanRollingBinding({ ...binding, projection: null }))
    .toThrow('requires a digest-bound rolling machine projection');
  expect(() => assertStablePlanRollingBinding({ ...binding, exactMain: 'e'.repeat(40) }))
    .toThrow('exact live default revision');
  expect(() => assertStablePlanRollingBinding({ ...binding, exactMainTree: 'f'.repeat(40) }))
    .toThrow('exact live default tree');
  for (const active of [
    { ...projectionInput.active, packageId: 'other-v3', manifestPath: 'config/repository/work-packages/other-v3.md' },
    { ...projectionInput.active, tracking: 'issue-2' }
  ]) {
    expect(() => assertStablePlanRollingBinding({
      ...binding, projection: compileWorkRollingTransitionProjection({ ...projectionInput, active })
    })).toThrow('rolling machine active identity');
  }
  expect(() => assertStablePlanRollingBinding({
    ...binding, manifestPath: 'config/repository/work-packages/other-v3.md'
  })).toThrow('rolling machine manifest binding');
  const changedBytes = Buffer.concat([bytes, Buffer.from('\nAcceptance clarification.\n')]);
  expect(() => assertStablePlanRollingBinding({
    ...binding,
    manifest: CodexDevelopmentParseCurrentWorkPackageManifest(changedBytes.toString('utf8')),
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(changedBytes) as `sha256:${string}`
  })).toThrow('rolling machine manifest binding');
});

test('ordinary selection projection binds stable plan base and active identity; v1 keeps its prior base contract', () => {
  const { binding } = stablePlanBindingFixture();
  const selected = {
    schema: 'sec-work-rolling-projection-v1', exactMain,
    roadmapRevision: rawSha256('roadmap'), catalogDigest: rawSha256('catalog'),
    receiptDigest: rawSha256('receipt'), decisionDigest: rawSha256('decision'),
    active: { packageId: activePackageId, tracking: 'issue-1', workId: 'issue-1',
      currentSpecRef: 'github:issue/1', currentSpecRevision: rawSha256('spec'), decisionStatus: 'selected' },
    candidates: candidates.map((packageId, index) => ({
      packageId, tracking: `issue-${index + 2}`, workId: `issue-${index + 2}`,
      currentSpecRef: `github:issue/${index + 2}`, currentSpecRevision: rawSha256(`spec-${index}`),
      decisionStatus: 'eligible'
    }))
  };
  const projection = parseWorkRollingMachineProjection(JSON.stringify({
    ...selected, projectionDigest: sha256(selected)
  }));
  expect(assertStablePlanRollingBinding({ ...binding, projection })).toBeUndefined();
  expect(() => assertStablePlanRollingBinding({
    ...binding, projection, exactMain: 'e'.repeat(40)
  })).toThrow('exact live default revision');
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    proposalManifest(activePackageId, 'issue-1').toString('utf8')
  );
  expect(assertStablePlanRollingBinding({ ...binding, manifest, projection: null }))
    .toBeUndefined();
  expect(assertStablePlanRollingBinding({
    ...binding, manifest, projection, exactMain: 'e'.repeat(40)
  })).toBeUndefined();
  expect(CodexDevelopmentWorkPackageAcceptsObservedBase(manifest, exactMain)).toBe(true);
  expect(CodexDevelopmentWorkPackageAcceptsObservedBase(manifest, 'e'.repeat(40))).toBe(false);
});

test('proposal-only freeze renders one authority-free tracking:none successor', () => {
  const proposalPackageId = 'private-sandbox-python-runtime-transition';
  const currentManifest = proposalManifest(activePackageId, 'issue-1');
  const targetManifest = proposalManifest(proposalPackageId, 'none');
  const spec = parseCurrentStateSpec(`schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
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
  const currentPointerSource = renderActivePointer({
    spec,
    manifestPath: `config/repository/work-packages/${activePackageId}.md`,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(currentManifest) as `sha256:${string}`,
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
  const projection = createFreezeProjection({ ...common, proposalOnly });
  const stableV3Bytes = Buffer.from(targetManifest.toString('utf8')
    .replace('codex-development-work-package-v1', 'codex-development-work-package-v3')
    .replace(`base: '${exactMain}'\n`, ''), 'utf8');
  for (const [baseSha, baseTreeSha] of [[exactMain, exactMainTree], ['c'.repeat(40), 'd'.repeat(40)]]) {
    const v3 = createFreezeProjection({
      ...common, proposalOnly, manifestBytes: stableV3Bytes, baseSha: baseSha!, baseTreeSha: baseTreeSha!
    });
    expect(v3.manifestDigest).toBe(CodexDevelopmentWorkPackageManifestDigest(stableV3Bytes) as `sha256:${string}`);
    expect(parseRollingMachineProjection(v3.rollingPlanSource)).toMatchObject({
      exactMain: baseSha, exactMainTree: baseTreeSha, authority: 'none'
    });
    expect(() => assertRollingMachineBaseBinding({
      projection: parseRollingMachineProjection(v3.rollingPlanSource)!,
      exactMain: baseSha!, exactMainTree: 'e'.repeat(40)
    })).toThrow('does not bind the exact live default tree');
  }

  expect(projection.authoringDisposition).toBe('proposal-only');
  expect(projection.retiredManifestPath).toBe(`config/repository/work-packages/${activePackageId}.md`);
  expect(parseRollingPlan(projection.rollingPlanSource).activePackageId)
    .toBe(proposalPackageId);
  expect(parseRollingMachineProjection(projection.rollingPlanSource)).toMatchObject({
    schema: 'sec-work-rolling-proposal-projection-v1',
    exactMain,
    exactMainTree,
    authority: 'none',
    active: {
      packageId: proposalPackageId,
      tracking: 'none',
      manifestPath: `config/repository/work-packages/${proposalPackageId}.md`,
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest)
    },
    candidates: [...candidates]
  });
  expect(() => parseRollingMachineProjection(
    projection.rollingPlanSource.replace('"authority": "none"', '"authority": "activation"')
  )).toThrow('authority none');
  expect(() => assertRollingMachineBaseBinding({
    projection: parseRollingMachineProjection(projection.rollingPlanSource)!,
    exactMain,
    exactMainTree: 'c'.repeat(40)
  })).toThrow('does not bind the exact live default tree');

  expect(() => createFreezeProjection({
    ...common,
    proposalOnly: { ...proposalOnly, currentResolution: {
      state: 'active',
      manifest: `config/repository/work-packages/${activePackageId}.md`,
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(currentManifest)
    } }
  })).toThrow('byte-exact on the live default');
  expect(() => createFreezeProjection({
    ...common,
    manifestBytes: proposalManifest(proposalPackageId, 'issue-2'),
    proposalOnly
  })).toThrow('target tracking must be none');
  expect(() => createFreezeProjection({
    ...common,
    proposalOnly,
    workSelectionProjection: { receipt: {} as never }
  })).toThrow('forbids selection, repair, and replan');
  expect(() => createFreezeProjection({
    ...common,
    proposalOnly,
    requestedRollingPlanSource: legacyRollingPlanSource()
  })).toThrow('forbids caller-authored rolling-plan bytes');
  expect(() => createFreezeProjection({
    ...common,
    manifestBytes: proposalManifest(proposalPackageId, 'none', 'f'.repeat(40)),
    proposalOnly
  })).toThrow('base must equal the exact live default revision');
  expect(() => createFreezeProjection(common))
    .toThrow('requires exactly one live WorkDecision or MainHealth repair projection');
});

test('MainHealth topology is compiled and rendered atomically instead of slicing prior Markdown', () => {
  const repairPackageId = 'main-health-repair-v1';
  const rendered = activateMainHealthRepairRollingPlan({
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
  expect(parseRollingPlan(rendered)).toEqual({
    activePackageId: repairPackageId,
    candidatePackageIds: [...candidates]
  });
  expect(parseRollingMachineProjection(rendered)).toMatchObject({
    schema: 'sec-work-rolling-transition-projection-v1',
    exactMain,
    exactMainTree,
    authority: { kind: 'main-health-repair' },
    active: { packageId: repairPackageId, tracking: 'none' },
    candidates: [...candidates]
  });
  expect(rendered).not.toContain('Legacy prose');
  expect(rendered).not.toContain('Legacy candidate prose');
  expect(() => parseRollingPlan(rendered.replace(
    `### 1. ${candidates[0]}`,
    '### 1. drifted-candidate-v1'
  ))).toThrow('headings do not equal the digest-bound machine projection');
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
  expect(() => promoteRollingPlan({
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
  - tests/unit/development/document-control-plane-projection.test.ts
---

# Prior machine projection
`, 'utf8');
  const spec = parseCurrentStateSpec(`schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
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
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    targetManifest
  ) as `sha256:${string}`;
  const pointerSource = renderActivePointer({
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
  expect(() => assertPriorFreezeProjection({
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
  expect(() => assertPriorFreezeProjection({
    spec,
    immutableRollingPlanSource: immutable,
    pointerSource,
    rollingPlanSource: reordered,
    manifestPath: targetManifestPath,
    manifestBytes: targetManifest
  })).toThrow('preserve immutable active and ordered candidate topology');
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
  - tests/unit/development/document-control-plane-projection.test.ts
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
  const spec = parseCurrentStateSpec(`schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
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
  const result = createFreezeProjection({
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
  expect(parseRollingMachineProjection(result.rollingPlanSource)).toMatchObject({
    exactMain,
    exactMainTree,
    authority,
    active: {
      packageId: activePackageId,
      tracking: 'issue-1',
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest)
    }
  });
  expect(result.rollingPlanSource).not.toContain('Legacy prose');
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
  const refreshed = createFreezeProjection({
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
  expect(parseRollingMachineProjection(refreshed.rollingPlanSource)).toMatchObject({
    authority: refreshedAuthority,
    active: { manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest) }
  });
  const staleDerivedDigestAuthority = {
    ...refreshedAuthority,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(result.rollingPlanSource)
  };
  const repairedDerivedDigest = createFreezeProjection({
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
  expect(parseActivePointer(repairedDerivedDigest.pointerSource).manifestDigest)
    .toBe(CodexDevelopmentWorkPackageManifestDigest(targetManifest) as `sha256:${string}`);
  expect(parseRollingMachineProjection(
    repairedDerivedDigest.rollingPlanSource
  )).toMatchObject({ authority: staleDerivedDigestAuthority });
  const refreshedProjection = parseRollingMachineProjection(
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
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(targetManifest) as `sha256:${string}`
  };
  expect(requiresCommittedCandidateProjectionRefresh({
    projection: refreshedProjection,
    exactMain,
    exactMainTree,
    active: exactActive,
    sourceTreeDeltaPaths: [...permittedProjectionDeltaPaths],
    permittedProjectionDeltaPaths
  })).toBe(false);
  expect(requiresCommittedCandidateProjectionRefresh({
    projection: refreshedProjection,
    exactMain,
    exactMainTree,
    active: exactActive,
    sourceTreeDeltaPaths: ['src/compiler/changed.ts'],
    permittedProjectionDeltaPaths
  })).toBe(true);
  expect(() => createFreezeProjection({
    spec,
    currentPointerSource: pointerSource,
    currentRollingPlanSource: `${legacyRollingPlanSource()}drift`,
    currentManifestBytes: sourceManifest,
    committedCandidateReplanProjection: authority,
    manifestPath,
    manifestBytes: targetManifest,
    baseSha: exactMain,
    baseTreeSha: exactMainTree,
    reviewedOn: '2026-08-21'
  })).toThrow('does not bind the immutable source bytes');
  expect(() => createFreezeProjection({
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

function statusContinuationFixture() {
  return {
    repositoryRoot: '/candidate/worktree',
    headSha: exactMain,
    candidateTreeSha: exactMainTree,
    defaultRefState: 'fresh' as const,
    activeWorkPackage: { state: 'none' as const, reason: 'matching-default-blob' as const },
    pointerManifest: 'config/repository/work-packages/prior.md',
    changes: [],
    journal: null
  };
}

test('status continuation retains unknown owner admission across ordinary Git states', () => {
  const clean = projectStatusContinuation(statusContinuationFixture());
  expect(clean.next).toEqual({
    owner: 'work-selection', action: 'observe-work-decision', reason: 'matching-default-blob',
    requiredInputs: ['current-work-decision', 'operation-intent']
  });
  const dirty = projectStatusContinuation({
    ...statusContinuationFixture(),
    changes: [
      { index: 'A', worktree: 'M', path: 'src/changed.ts', originalPath: null },
      { index: 'R', worktree: ' ', path: 'src/new.ts', originalPath: 'src/old.ts' }
    ],
    activeWorkPackage: {
      state: 'active', manifest: 'config/repository/work-packages/current.md',
      manifestDigest: `sha256:${'c'.repeat(64)}`
    }
  });
  expect(dirty.next).toMatchObject({ owner: 'operation-admission', action: 'resolve-active-operation' });
  expect(dirty.subject).toMatchObject({ repositoryRoot: '/candidate/worktree', candidateTreeSha: exactMainTree });
  expect(dirty.changes).toEqual({ state: 'observed', records: [
    { index: 'A', worktree: 'M', path: 'src/changed.ts', originalPath: null },
    { index: 'R', worktree: ' ', path: 'src/new.ts', originalPath: 'src/old.ts' }
  ] });
  for (const value of [clean, dirty]) {
    expect(value.authority).toBe('observation-only');
    expect(value.unobservedOwners).toContain('development-commit-journal-census');
    expect(value.unobservedOwners).toContain('compiler-dependency-admission');
    expect(value.unobservedOwners).toContain('work-package-changed-path-ownership');
    expect(value).not.toHaveProperty('ready');
  }
});

test('status continuation preserves journal request and prioritizes races over recovery', () => {
  const journal = {
    operationId: `sha256:${'d'.repeat(64)}` as const,
    manifestPath: 'config/repository/work-packages/recovery.md', reviewedOn: '2026-10-01',
    baseSha: exactMain, candidateTreeSha: exactMainTree, proposalOnly: true, phase: 'terminal'
  };
  const recovery = projectStatusContinuation({
    ...statusContinuationFixture(), changes: null, journal
  });
  expect(recovery.next).toMatchObject({
    owner: 'document-control', action: 'resume-freeze', operationId: journal.operationId,
    executionRoot: 'required-clean-trusted-default-worktree', admission: 'required-by-original-owner',
    arguments: [
      'freeze', '--workspace', '/candidate/worktree', '--manifest', journal.manifestPath,
      '--reviewed-on', '2026-10-01', '--proposal-only', '--json'
    ]
  });
  expect(recovery.changes).toEqual({ state: 'unobserved', records: null });
  const raced = projectStatusContinuation({
    ...statusContinuationFixture(), journal,
    activeWorkPackage: { state: 'unresolved', reason: 'activation-observation-raced' }
  });
  expect(raced.next).toEqual({
    owner: 'repository-orientation', action: 'refresh-observation', reason: 'activation-observation-raced'
  });
  expect(raced.next).not.toHaveProperty('arguments');
});

test('status continuation routes stale and invalid control facts to their existing owners', () => {
  for (const defaultRefState of ['stale', 'unavailable'] as const) {
    const result = projectStatusContinuation({ ...statusContinuationFixture(), defaultRefState });
    expect(result.next).toEqual({
      owner: 'repository-orientation', action: 'refresh-observation', reason: `default-ref-${defaultRefState}`
    });
  }
  const invalid = projectStatusContinuation({
    ...statusContinuationFixture(),
    activeWorkPackage: { state: 'invalid', reason: 'candidate-manifest-absent' }
  });
  expect(invalid.next).toEqual({
    owner: 'document-control', action: 'repair-active-binding', reason: 'candidate-manifest-absent',
    pointerManifest: 'config/repository/work-packages/prior.md'
  });
});

test('initially-absent T/N/R contract covers normalized tuples, malformed entries and its five edges', () => {
  const absent = Object.freeze({ byteClass: 'absent' as const, identity: null });
  const exactA = Object.freeze({ byteClass: 'exact-next' as const, identity: 'A' });
  const exactB = Object.freeze({ byteClass: 'exact-next' as const, identity: 'B' });
  const unknown = Object.freeze({ byteClass: 'unknown' as const, identity: 'A' });
  const entries = [absent, exactA, exactB, unknown] as const;
  const tuple = (
    target: InitiallyAbsentTupleEntry = absent,
    next: InitiallyAbsentTupleEntry = absent,
    retiredNext: InitiallyAbsentTupleEntry = absent
  ): InitiallyAbsentTuple => Object.freeze({ target, next, retiredNext });
  const expectedClassification = (
    platform: InitiallyAbsentTuplePlatform,
    observation: InitiallyAbsentTuple
  ) => {
    const values = [observation.target, observation.next, observation.retiredNext];
    if (values.some((entry) => entry.byteClass === 'unknown')) {
      return { status: 'invalid', reason: 'unknown-bytes' } as const;
    }
    const topology = values.map((entry) => entry.byteClass).join('/');
    const stateByTopology: Readonly<Record<string, InitiallyAbsentTupleState>> = platform === 'win32'
      ? {
          'absent/absent/absent': 'win32-w0',
          'absent/exact-next/absent': 'win32-w1',
          'exact-next/absent/absent': 'win32-w2'
        }
      : {
          'absent/absent/absent': 'linux-l0',
          'absent/exact-next/absent': 'linux-l1',
          'exact-next/exact-next/absent': 'linux-l2',
          'exact-next/absent/exact-next': 'linux-l3'
        };
    const state = stateByTopology[topology];
    if (state === undefined) return { status: 'invalid', reason: 'illegal-topology' } as const;
    if ((state === 'linux-l2' && observation.target.identity !== observation.next.identity)
        || (state === 'linux-l3' && observation.target.identity !== observation.retiredNext.identity)) {
      return { status: 'invalid', reason: 'identity-mismatch' } as const;
    }
    return { status: 'legal', state } as const;
  };

  for (const platform of ['win32', 'linux'] as const) {
    for (const target of entries) for (const next of entries) for (const retiredNext of entries) {
      const observation = tuple(target, next, retiredNext);
      expect(classifyInitiallyAbsentEntryTuple({ platform, tuple: observation })).toEqual(
        expectedClassification(platform, observation)
      );
    }
  }

  const malformedRows = [
    null,
    [],
    {},
    { target: absent, next: absent },
    { target: absent, next: absent, retiredNext: absent, extra: true },
    { target: { byteClass: 'absent', identity: null, extra: true }, next: absent, retiredNext: absent },
    { target: { byteClass: 'other', identity: 'A' }, next: absent, retiredNext: absent },
    { target: { byteClass: 'exact-next', identity: 1 }, next: absent, retiredNext: absent },
    { target: { byteClass: 'exact-next', identity: '' }, next: absent, retiredNext: absent },
    { target: { byteClass: 'unknown', identity: '' }, next: absent, retiredNext: absent },
    { target: absent, next: { byteClass: 'exact-next', identity: '' }, retiredNext: absent },
    { target: absent, next: { byteClass: 'unknown', identity: '' }, retiredNext: absent },
    { target: absent, next: absent, retiredNext: { byteClass: 'exact-next', identity: '' } },
    { target: absent, next: absent, retiredNext: { byteClass: 'unknown', identity: '' } },
    { target: { byteClass: 'absent', identity: 'A' }, next: unknown, retiredNext: unknown },
    { target: { byteClass: 'exact-next', identity: null }, next: unknown, retiredNext: unknown },
    { target: { byteClass: 'unknown', identity: null }, next: unknown, retiredNext: unknown },
    { target: unknown, next: { byteClass: 'absent', identity: 'A' }, retiredNext: unknown },
    { target: unknown, next: { byteClass: 'exact-next', identity: null }, retiredNext: unknown },
    { target: unknown, next: { byteClass: 'unknown', identity: null }, retiredNext: unknown },
    { target: unknown, next: unknown, retiredNext: { byteClass: 'absent', identity: 'A' } },
    { target: unknown, next: unknown, retiredNext: { byteClass: 'exact-next', identity: null } },
    { target: unknown, next: unknown, retiredNext: { byteClass: 'unknown', identity: null } }
  ];
  for (const malformed of malformedRows) {
    expect(classifyInitiallyAbsentEntryTuple({
      platform: 'linux', tuple: malformed as InitiallyAbsentTuple
    })).toEqual({ status: 'invalid', reason: 'malformed-observation' });
  }
  expect(classifyInitiallyAbsentEntryTuple({
    platform: 'darwin' as InitiallyAbsentTuplePlatform,
    tuple: null as unknown as InitiallyAbsentTuple
  })).toEqual({ status: 'invalid', reason: 'unsupported-platform' });

  const legalTuples = {
    win32: [tuple(), tuple(absent, exactA), tuple(exactA)],
    linux: [tuple(), tuple(absent, exactA), tuple(exactA, exactA), tuple(exactA, absent, exactA)]
  } as const;
  const edges = {
    win32: ['win32-w0->win32-w1', 'win32-w1->win32-w2'],
    linux: ['linux-l0->linux-l1', 'linux-l1->linux-l2', 'linux-l2->linux-l3']
  } as const satisfies Readonly<Record<InitiallyAbsentTuplePlatform, readonly InitiallyAbsentTupleEdge[]>>;
  for (const platform of ['win32', 'linux'] as const) {
    const states = legalTuples[platform];
    const platformEdges = edges[platform];
    for (let predecessorIndex = 0; predecessorIndex < states.length; predecessorIndex += 1) {
      for (let successorIndex = 0; successorIndex < states.length; successorIndex += 1) {
        for (const expectedEdge of platformEdges) {
          const result = assertInitiallyAbsentEntryTransition({
            platform,
            predecessor: states[predecessorIndex]!,
            successor: states[successorIndex]!,
            expectedEdge
          });
          if (successorIndex === predecessorIndex + 1 && expectedEdge === platformEdges[predecessorIndex]) {
            expect(result).toEqual(expectedClassification(platform, states[successorIndex]!));
          } else {
            expect(result).toEqual({ status: 'invalid', reason: 'illegal-topology' });
          }
        }
      }
    }
  }
  for (const discontinuity of [
    { platform: 'win32', predecessor: tuple(absent, exactA), successor: tuple(exactB), expectedEdge: 'win32-w1->win32-w2' },
    { platform: 'linux', predecessor: tuple(absent, exactA), successor: tuple(exactB, exactB), expectedEdge: 'linux-l1->linux-l2' },
    { platform: 'linux', predecessor: tuple(exactA, exactA), successor: tuple(exactB, absent, exactB), expectedEdge: 'linux-l2->linux-l3' }
  ] as const) {
    expect(assertInitiallyAbsentEntryTransition(discontinuity)).toEqual({
      status: 'invalid', reason: 'identity-mismatch'
    });
  }
}, 30_000);

test('terminal retirement accepts every canonical prefix cut and rejects namespace holes', () => {
  const entryCount = 9;
  for (let deletedPrefixCount = 0; deletedPrefixCount <= entryCount; deletedPrefixCount += 1) {
    expect(classifyTerminalRetirementPrefix(
      Array.from({ length: entryCount }, (_, index) => index >= deletedPrefixCount)
    )).toEqual({ status: 'valid', deletedPrefixCount });
  }
  for (const hole of [1, 3, 7]) {
    const presence = Array.from({ length: entryCount }, () => true);
    presence[hole] = false;
    expect(classifyTerminalRetirementPrefix(presence)).toEqual({
      status: 'invalid',
      reason: 'non-prefix-hole'
    });
  }
});

test('freeze convergence treats exact successor retirement as semantic current state', () => {
  const exact = {
    targetManifestMatches: true,
    pointerMatches: true,
    indexedRollingMatches: true,
    worktreeRollingMatches: true,
    retirementSatisfied: true
  } as const;
  expect(classifyFreezeConvergence(exact)).toBe('semantic-noop');
  expect(classifyFreezeConvergence({
    ...exact,
    retirementSatisfied: false
  })).toBe('publication-required');
  expect(classifyFreezeConvergence({
    ...exact,
    candidateTreeMatches: false
  })).toBe('publication-required');
});

test('published control binding classifies authority and binding without boolean XOR drift', () => {
  const classify = (overrides: Partial<Parameters<
    typeof classifyPublishedControlBinding
  >[0]> = {}) => classifyPublishedControlBinding({
    authorityProven: true,
    historicalBaseIsLiveDefault: false,
    pointerBindsDefault: false,
    pointerBindsHistoricalRolling: false,
    publishedTargetPresent: true,
    rollingTransition: true,
    ...overrides
  });
  expect(classify({ publishedTargetPresent: false })).toEqual({ kind: 'absent' });
  expect(classify({ rollingTransition: false })).toEqual({
    kind: 'blocked', reason: 'unbound-published-target'
  });
  expect(classify()).toEqual({ kind: 'blocked', reason: 'unbound-published-target' });
  expect(classify({ pointerBindsDefault: true, pointerBindsHistoricalRolling: true })).toEqual({
    kind: 'blocked', reason: 'ambiguous-binding'
  });
  expect(classify({ pointerBindsDefault: true, historicalBaseIsLiveDefault: true })).toEqual({
    kind: 'blocked', reason: 'historical-base-is-live-default'
  });
  expect(classify({ pointerBindsDefault: true, authorityProven: false })).toEqual({
    kind: 'blocked', reason: 'publication-proof-missing'
  });
  expect(classify({ pointerBindsDefault: true })).toEqual({
    kind: 'repairable', pointerBinding: 'default'
  });
  expect(classify({ pointerBindsHistoricalRolling: true })).toEqual({
    kind: 'repairable', pointerBinding: 'historical-rolling'
  });
});
