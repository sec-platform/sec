import { expect, test } from 'bun:test';

import type { SecCurrentWorkLifecycle } from '../../src/adapters/self-hosting/control/work-selection/contract.ts';
import {
  SEC_ROADMAP_WORK_CATALOG_BEGIN,
  SEC_ROADMAP_WORK_CATALOG_END,
  compileSecWorkRollingProjection,
  compileSecWorkRollingProposalProjection,
  compileSecWorkSelectionTerminalProjection,
  createSecWorkCurrentSpecObservation,
  createSecWorkDecisionReceipt,
  createSecWorkRegistryObservation,
  currentSpecRevisionFromBody,
  parseSecRoadmapWorkCatalog,
  renderSecWorkRollingPlan,
  renderSecWorkRollingProposalPlan
} from '../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { CodexDevelopmentParseRollingPlan } from '../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

const exactMain = 'a'.repeat(40);
const exactMainTree = 'b'.repeat(40);

function oneItemCatalogSource(): string {
  return `${SEC_ROADMAP_WORK_CATALOG_BEGIN}
\`\`\`json
${JSON.stringify({
    schema: 'sec-roadmap-work-catalog-v1',
    stageRef: 'fixture-terminal-cardinality',
    items: [{
      packageId: 'only-live-work-v1',
      workId: 'issue-1',
      tracking: 'issue-1',
      currentSpecRef: 'github:issue/1',
      ownerRef: 'github:issue/1',
      kind: 'focused',
      disposition: 'active',
      priorityClass: 'active-critical-path',
      priorityEvidenceRefs: ['fixture:priority'],
      prerequisiteWorkIds: [],
      orderedAfterWorkIds: [],
      reproductionOrEvidenceFreshness: 'fresh',
      rootCauseState: 'not-repeated',
      rootCauseRef: 'fixture:root-cause',
      scopeClosure: 'closed',
      exitCriteriaRef: 'fixture:exit',
      nearTermConsumerRef: null,
      humanDecisionRef: null
    }]
  }, null, 2)}
\`\`\`
${SEC_ROADMAP_WORK_CATALOG_END}`;
}

function currentLifecycle(): SecCurrentWorkLifecycle {
  return {
    activeWorkId: null,
    activeRef: null,
    activeState: 'none',
    activeLegality: 'not-applicable',
    mainHealthState: 'healthy',
    mainHealthRef: sha256({ fixture: 'health' }),
    closeoutState: 'none',
    closeoutRef: sha256({ fixture: 'closeout' }),
    controlState: 'consistent',
    controlRef: sha256({ fixture: 'control' })
  };
}

test('one live work can be selected without manufacturing successor candidates', () => {
  const source = oneItemCatalogSource();
  const catalog = parseSecRoadmapWorkCatalog(source);
  expect(catalog.items).toHaveLength(1);

  const currentSpec = createSecWorkCurrentSpecObservation({
    workId: 'issue-1',
    currentSpecRef: 'github:issue/1',
    providerResourceRef: 'github-node:fixture-1',
    providerState: 'open',
    currentSpecRevision: currentSpecRevisionFromBody('one live current spec')
  });
  const receipt = createSecWorkDecisionReceipt({
    repository: 'sec-platform/sec',
    exactMain,
    exactMainTree,
    roadmapRevision: rawSha256(source),
    catalog,
    registry: createSecWorkRegistryObservation({
      defaultTreeSha: exactMainTree,
      entries: []
    }),
    current: currentLifecycle(),
    currentSpecs: [currentSpec]
  });

  expect(receipt.decision.status).toBe('select-next');
  expect(receipt.decision.selectedWorkId).toBe('issue-1');

  const projection = compileSecWorkRollingProjection(receipt);
  expect(projection.active.packageId).toBe('only-live-work-v1');
  expect(projection.candidates).toEqual([]);

  const rendered = renderSecWorkRollingPlan({ receipt, reviewedOn: '2026-10-07' });
  expect(CodexDevelopmentParseRollingPlan(rendered)).toEqual({
    activePackageId: 'only-live-work-v1',
    candidatePackageIds: []
  });
});

test('terminal compaction can retire the last work item to an empty catalog', () => {
  const source = oneItemCatalogSource();
  const catalog = parseSecRoadmapWorkCatalog(source);
  const closedSpec = createSecWorkCurrentSpecObservation({
    workId: 'issue-1',
    currentSpecRef: 'github:issue/1',
    providerResourceRef: 'github-node:fixture-1',
    providerState: 'closed',
    currentSpecRevision: currentSpecRevisionFromBody('closed current spec')
  });

  const terminal = compileSecWorkSelectionTerminalProjection({
    roadmapSource: source,
    currentSpecs: [closedSpec],
    presentManifestPaths: []
  });

  expect(terminal.terminalCompaction?.retiredWorkIds).toEqual(['issue-1']);
  expect(terminal.terminalCompaction?.delayedManifestRetirementPaths).toEqual([]);
  expect(terminal.catalog.items).toEqual([]);
  expect(terminal.currentSpecs).toEqual([]);
  expect(parseSecRoadmapWorkCatalog(terminal.terminalCompaction!.roadmapSource).items).toEqual([]);
});


test('proposal projection accepts an active package with no retained candidates', () => {
  const projection = compileSecWorkRollingProposalProjection({
    exactMain,
    exactMainTree,
    active: {
      packageId: 'only-proposal-v1',
      tracking: 'none',
      manifestPath: 'config/repository/work-packages/only-proposal-v1.md',
      manifestDigest: sha256({ fixture: 'proposal-manifest' })
    },
    candidates: []
  });

  expect(projection.candidates).toEqual([]);
  const rendered = renderSecWorkRollingProposalPlan({
    projection,
    reviewedOn: '2026-10-07'
  });
  expect(CodexDevelopmentParseRollingPlan(rendered)).toEqual({
    activePackageId: 'only-proposal-v1',
    candidatePackageIds: []
  });
});
