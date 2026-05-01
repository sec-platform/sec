import { CompilerError } from '../../shared/errors.ts';
import type { ExplainGraph, ExplainGraphEdge, ExplainGraphNode } from '../../shared/explain-types.ts';
import type { ViewMutation, ViewMutationFile } from './apply-view-mutations.ts';

export const GRAPH_MUTATION_DRY_RUN_REPORT_PATH = 'control/workflow/graph-mutation-dry-run-report.json' as const;

export type GraphMutationOperation = {
  id: string;
  kind: 'add-acceptance';
  acceptanceId: string;
};

export type GraphMutationDryRunStatus = 'ready' | 'blocked';
export type GraphMutationRisk = 'low';
export type GraphMutationPreconditionStatus = 'satisfied' | 'failed';

export interface GraphMutationPrecondition {
  id: string;
  status: GraphMutationPreconditionStatus;
  target: string;
}

export interface GraphMutationDeltaGroup<T> {
  added: T[];
  changed: T[];
  removed: T[];
}

export interface GraphMutationExpectedDelta {
  nodes: GraphMutationDeltaGroup<ExplainGraphNode>;
  edges: GraphMutationDeltaGroup<ExplainGraphEdge>;
}

export interface GraphMutationDryRunOperation {
  id: string;
  kind: GraphMutationOperation['kind'];
  status: GraphMutationDryRunStatus;
  risk: GraphMutationRisk;
  mutationFilePath: `source/views/mutations/${string}.json`;
  mutationFile: ViewMutationFile | null;
  preconditions: GraphMutationPrecondition[];
  expectedGraphDelta: GraphMutationExpectedDelta;
  affectedNodes: string[];
  affectedEdges: string[];
  requiredPasses: string[];
  rollback: string;
  rejectionReason: string | null;
}

export interface GraphMutationDryRunSummary {
  readyCount: number;
  blockedCount: number;
  expectedNodeAddCount: number;
  expectedEdgeAddCount: number;
}

export interface GraphMutationDryRunReport {
  formatVersion: '1';
  path: typeof GRAPH_MUTATION_DRY_RUN_REPORT_PATH;
  stableArtifact: false;
  mode: 'dry-run';
  status: GraphMutationDryRunStatus;
  writesSource: false;
  sourceRoot: 'source/views/mutations';
  targetPath: 'source/app.yaml';
  operationCount: number;
  mutationFileCount: number;
  summary: GraphMutationDryRunSummary;
  operations: GraphMutationDryRunOperation[];
}

const GRAPH_MUTATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const REQUIRED_PASSES = ['workbench-mutations-apply', 'resolve', 'verify', 'explain'];

function assertGraphMutationOperationId(id: string): void {
  if (!GRAPH_MUTATION_ID_PATTERN.test(id)) {
    throw new CompilerError('WORKBENCH-MUTATION-DRY-RUN-001', `Graph mutation operation id "${id}" must be kebab-case`);
  }
}

function findAppNode(graph: ExplainGraph): ExplainGraphNode | undefined {
  return graph.nodes.find((node) => node.type === 'app');
}

function hasNode(graph: ExplainGraph, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId);
}

function emptyDelta<T>(): GraphMutationDeltaGroup<T> {
  return {
    added: [],
    changed: [],
    removed: []
  };
}

function buildMutationFile(mutation: ViewMutation): ViewMutationFile {
  return {
    formatVersion: '1',
    mutations: [mutation]
  };
}

function mutationFilePath(id: string): `source/views/mutations/${string}.json` {
  return `source/views/mutations/${id}.json`;
}

function buildRollback(operation: GraphMutationOperation): string {
  return `Remove ${mutationFilePath(operation.id)} before apply, or revert the acceptance entry in source/app.yaml after apply.`;
}

function buildAddAcceptanceDryRun(graph: ExplainGraph, operation: GraphMutationOperation): GraphMutationDryRunOperation {
  assertGraphMutationOperationId(operation.id);
  const acceptanceNode: ExplainGraphNode = {
    id: `acceptance:${operation.acceptanceId}`,
    type: 'acceptance',
    label: operation.acceptanceId
  };
  const alreadyPresent = hasNode(graph, acceptanceNode.id);
  const status: GraphMutationDryRunStatus = alreadyPresent ? 'blocked' : 'ready';
  const mutation: ViewMutation = {
    id: operation.id,
    kind: 'add-acceptance',
    acceptanceId: operation.acceptanceId
  };
  const appNode = findAppNode(graph);
  const preconditions: GraphMutationPrecondition[] = [
    {
      id: 'acceptance-node-absent',
      status: alreadyPresent ? 'failed' : 'satisfied',
      target: acceptanceNode.id
    }
  ];

  return {
    id: operation.id,
    kind: operation.kind,
    status,
    risk: 'low',
    mutationFilePath: mutationFilePath(operation.id),
    mutationFile: status === 'ready' ? buildMutationFile(mutation) : null,
    preconditions,
    expectedGraphDelta: {
      nodes: {
        added: status === 'ready' ? [acceptanceNode] : [],
        changed: [],
        removed: []
      },
      edges: emptyDelta()
    },
    affectedNodes: [appNode?.id, acceptanceNode.id].filter((nodeId): nodeId is string => Boolean(nodeId)),
    affectedEdges: [],
    requiredPasses: [...REQUIRED_PASSES],
    rollback: buildRollback(operation),
    rejectionReason: alreadyPresent ? `${acceptanceNode.id} already exists` : null
  };
}

function buildSummary(operations: readonly GraphMutationDryRunOperation[]): GraphMutationDryRunSummary {
  return {
    readyCount: operations.filter((operation) => operation.status === 'ready').length,
    blockedCount: operations.filter((operation) => operation.status === 'blocked').length,
    expectedNodeAddCount: operations.reduce((count, operation) => count + operation.expectedGraphDelta.nodes.added.length, 0),
    expectedEdgeAddCount: operations.reduce((count, operation) => count + operation.expectedGraphDelta.edges.added.length, 0)
  };
}

export function buildGraphMutationDryRun(
  graph: ExplainGraph,
  operations: readonly GraphMutationOperation[]
): GraphMutationDryRunReport {
  const dryRunOperations = operations.map((operation) => buildAddAcceptanceDryRun(graph, operation));
  const summary = buildSummary(dryRunOperations);

  return {
    formatVersion: '1',
    path: GRAPH_MUTATION_DRY_RUN_REPORT_PATH,
    stableArtifact: false,
    mode: 'dry-run',
    status: summary.blockedCount > 0 ? 'blocked' : 'ready',
    writesSource: false,
    sourceRoot: 'source/views/mutations',
    targetPath: 'source/app.yaml',
    operationCount: dryRunOperations.length,
    mutationFileCount: summary.readyCount,
    summary,
    operations: dryRunOperations
  };
}
