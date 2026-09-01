export type DirectedGraphEdge<NodeId extends string = string> = Readonly<{
  readonly from: NodeId;
  readonly to: NodeId;
}>;

function directedGraphTextOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Compile every strongly connected component of one closed directed graph.
 * Node and edge order cannot affect the result, duplicate edges are idempotent,
 * and an edge outside the declared node set is rejected rather than inferred.
 */
export function compileClosedDirectedGraphStrongComponents<NodeId extends string>(
  nodeIds: readonly NodeId[],
  edges: readonly DirectedGraphEdge<NodeId>[]
): readonly (readonly NodeId[])[] {
  const orderedNodeIds = [...new Set(nodeIds)].sort(directedGraphTextOrder);
  const nodeSet = new Set(orderedNodeIds);
  const targetsByNodeId = new Map<NodeId, Set<NodeId>>(
    orderedNodeIds.map((nodeId) => [nodeId, new Set<NodeId>()])
  );
  for (const edge of edges) {
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      throw new Error(
        `[directed-graph-unknown-endpoint] ${JSON.stringify(edge.from)} -> ${JSON.stringify(edge.to)}`
      );
    }
    targetsByNodeId.get(edge.from)!.add(edge.to);
  }

  const indexByNodeId = new Map<NodeId, number>();
  const lowLinkByNodeId = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  const onStack = new Set<NodeId>();
  const components: NodeId[][] = [];
  let nextIndex = 0;
  const visit = (nodeId: NodeId): void => {
    indexByNodeId.set(nodeId, nextIndex);
    lowLinkByNodeId.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);
    const orderedTargets = [...targetsByNodeId.get(nodeId)!].sort(directedGraphTextOrder);
    for (const target of orderedTargets) {
      if (!indexByNodeId.has(target)) {
        visit(target);
        lowLinkByNodeId.set(
          nodeId,
          Math.min(lowLinkByNodeId.get(nodeId)!, lowLinkByNodeId.get(target)!)
        );
      } else if (onStack.has(target)) {
        lowLinkByNodeId.set(
          nodeId,
          Math.min(lowLinkByNodeId.get(nodeId)!, indexByNodeId.get(target)!)
        );
      }
    }
    if (lowLinkByNodeId.get(nodeId) !== indexByNodeId.get(nodeId)) return;
    const component: NodeId[] = [];
    for (;;) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === nodeId) break;
    }
    components.push(component.sort(directedGraphTextOrder));
  };

  for (const nodeId of orderedNodeIds) {
    if (!indexByNodeId.has(nodeId)) visit(nodeId);
  }
  return Object.freeze(components
    .sort((left, right) => directedGraphTextOrder(left[0]!, right[0]!))
    .map((component) => Object.freeze(component)));
}
