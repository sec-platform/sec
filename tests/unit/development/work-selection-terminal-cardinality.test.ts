import { expect, test } from 'bun:test';

import { compileOperationDemandGraph } from '../../../src/adapters/self-hosting/control/operation/demand.ts';
import { projectWorkSelectionCli } from '../../../src/adapters/self-hosting/control/work-selection/runtime.ts';
import { parseRollingPlan } from '../../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';
import type { CurrentWorkLifecycle } from '../../../src/adapters/self-hosting/control/work-selection/contract.ts';
import {
  ROADMAP_WORK_CATALOG_BEGIN,
  ROADMAP_WORK_CATALOG_END,
  compileWorkRollingProposalProjection,
  compileWorkSelectionTerminalProjection,
  createWorkCurrentSpecObservation,
  createWorkDecisionReceipt,
  createWorkRegistryObservation,
  currentSpecRevisionFromBody,
  parseRoadmapWorkCatalog,
  renderWorkRollingProposalPlan,
  renderWorkRollingSelectionPlan,
  resolvedWorkSelectionLiveResult
} from '../../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';

const exactMain = 'a'.repeat(40);
const exactMainTree = 'b'.repeat(40);

function oneItemCatalogSource(): string {
  return `${ROADMAP_WORK_CATALOG_BEGIN}
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
${ROADMAP_WORK_CATALOG_END}`;
}

function currentLifecycle(): CurrentWorkLifecycle {
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
  const catalog = parseRoadmapWorkCatalog(source);
  expect(catalog.items).toHaveLength(1);

  const currentSpec = createWorkCurrentSpecObservation({
    workId: 'issue-1',
    currentSpecRef: 'github:issue/1',
    providerResourceRef: 'github-node:fixture-1',
    providerState: 'open',
    currentSpecRevision: currentSpecRevisionFromBody('one live current spec')
  });
  const receiptInput = {
    repository: 'sec-platform/sec',
    exactMain,
    exactMainTree,
    roadmapRevision: rawSha256(source),
    catalog,
    registry: createWorkRegistryObservation({
      defaultTreeSha: exactMainTree,
      entries: []
    }),
    current: currentLifecycle(),
    currentSpecs: [currentSpec]
  };
  const receipt = createWorkDecisionReceipt(receiptInput);

  expect(receipt.decision.status).toBe('select-next');
  expect(receipt.decision.selectedWorkId).toBe('issue-1');

  const demand = compileOperationDemandGraph({ operation: 'work-selection-observe', terminalWorkIds: [] });
  const unresolvedSource = source.replace('"scopeClosure": "closed"', '"scopeClosure": "unresolved"')
    .replace('"rootCauseState": "not-repeated"', '"rootCauseState": "unresolved"');
  const unresolvedReceipt = createWorkDecisionReceipt({
    ...receiptInput, roadmapRevision: rawSha256(unresolvedSource),
    catalog: parseRoadmapWorkCatalog(unresolvedSource)
  });
  for (const [current, status, selectedWorkId, preconditions] of [
    [receipt, 'select-next', 'issue-1', 0],
    [unresolvedReceipt, 'unresolved', null, 2]
  ] as const) {
    const result = resolvedWorkSelectionLiveResult(current, demand);
    const projected = projectWorkSelectionCli(result);
    expect(Object.keys(projected).sort()).toEqual([
      'decision', 'demandGraph', 'exactMain', 'exactMainTree', 'receiptDigest',
      'resultDigest', 'schema', 'status', 'terminalCompaction'
    ]);
    expect(projected).toMatchObject({
      schema: 'sec-work-selection-cli-projection-v1', status: 'resolved',
      exactMain, exactMainTree, resultDigest: result.resultDigest,
      receiptDigest: current.receiptDigest, terminalCompaction: null,
      decision: { status, selectedWorkId, requiredPreconditions: preconditions }
    });
    expect('decision' in projected).toBe(true);
    if ('decision' in projected) expect(Object.keys(projected.decision).sort()).toEqual([
      'blockedCandidateRefs', 'decisionDigest', 'reasonCodes', 'requiredPreconditions',
      'selectedCandidateRef', 'selectedWorkId', 'status'
    ]);
    expect(projected).not.toHaveProperty('receipt');
    expect(projected).not.toHaveProperty('catalog');
    expect(JSON.stringify(projected)).not.toContain('fixture:priority');
  }

  const rendered = renderWorkRollingSelectionPlan({ receipt, reviewedOn: '2026-10-07' });
  expect(parseRollingPlan(rendered)).toEqual({
    activePackageId: 'only-live-work-v1',
    candidatePackageIds: []
  });
});

test('terminal compaction can retire the last work item to an empty catalog', () => {
  const source = oneItemCatalogSource();
  const closedSpec = createWorkCurrentSpecObservation({
    workId: 'issue-1',
    currentSpecRef: 'github:issue/1',
    providerResourceRef: 'github-node:fixture-1',
    providerState: 'closed',
    currentSpecRevision: currentSpecRevisionFromBody('closed current spec')
  });

  const terminal = compileWorkSelectionTerminalProjection({
    roadmapSource: source,
    currentSpecs: [closedSpec],
    presentManifestPaths: []
  });

  expect(terminal.terminalCompaction?.retiredWorkIds).toEqual(['issue-1']);
  expect(terminal.terminalCompaction?.delayedManifestRetirementPaths).toEqual([]);
  expect(terminal.catalog.items).toEqual([]);
  expect(terminal.currentSpecs).toEqual([]);
  expect(parseRoadmapWorkCatalog(terminal.terminalCompaction!.roadmapSource).items).toEqual([]);
});


test('proposal projection accepts an active package with no retained candidates', () => {
  const projection = compileWorkRollingProposalProjection({
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
  const rendered = renderWorkRollingProposalPlan({
    projection,
    reviewedOn: '2026-10-07'
  });
  expect(parseRollingPlan(rendered)).toEqual({
    activePackageId: 'only-proposal-v1',
    candidatePackageIds: []
  });
});
