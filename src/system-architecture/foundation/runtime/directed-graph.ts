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
  const targetsByNodeId = new Map<NodeId, Set<NodeId>>(
    orderedNodeIds.map((nodeId) => [nodeId, new Set<NodeId>()])
  );
  for (const edge of edges) {
    const { from, to } = edge;
    if (!targetsByNodeId.has(from) || !targetsByNodeId.has(to)) {
      throw new Error(
        `[directed-graph-unknown-endpoint] ${JSON.stringify(from)} -> ${JSON.stringify(to)}`
      );
    }
    targetsByNodeId.get(from)!.add(to);
  }

  const indexByNodeId = new Map<NodeId, number>();
  const lowLinkByNodeId = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  const onStack = new Set<NodeId>();
  const components: NodeId[][] = [];
  let nextIndex = 0;
  type VisitFrame = {
    readonly nodeId: NodeId;
    readonly targets: Iterator<NodeId>;
  };
  const frames: VisitFrame[] = [];
  const enter = (nodeId: NodeId): void => {
    indexByNodeId.set(nodeId, nextIndex);
    lowLinkByNodeId.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);
    // SCC membership is independent of DFS edge order. Canonicalize the
    // returned partition below, not every adjacency list on the hot path.
    frames.push({ nodeId, targets: targetsByNodeId.get(nodeId)!.values() });
  };

  for (const root of orderedNodeIds) {
    if (indexByNodeId.has(root)) continue;
    enter(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const { nodeId } = frame;
      const next = frame.targets.next();
      if (!next.done) {
        const target = next.value;
        if (!indexByNodeId.has(target)) {
          enter(target);
        } else if (onStack.has(target)) {
          lowLinkByNodeId.set(
            nodeId,
            Math.min(lowLinkByNodeId.get(nodeId)!, indexByNodeId.get(target)!)
          );
        }
        continue;
      }

      frames.pop();
      if (lowLinkByNodeId.get(nodeId) === indexByNodeId.get(nodeId)) {
        const component: NodeId[] = [];
        for (;;) {
          const member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
          if (member === nodeId) break;
        }
        components.push(component.sort(directedGraphTextOrder));
      }
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        lowLinkByNodeId.set(
          parent.nodeId,
          Math.min(lowLinkByNodeId.get(parent.nodeId)!, lowLinkByNodeId.get(nodeId)!)
        );
      }
    }
  }
  return Object.freeze(components
    .sort((left, right) => directedGraphTextOrder(left[0]!, right[0]!))
    .map((component) => Object.freeze(component)));
}
