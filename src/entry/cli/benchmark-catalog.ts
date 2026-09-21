export type BenchmarkTaskCatalogPresentationSource = Readonly<{
  catalogId: string;
  status: string;
  command: string;
  taskCount: number;
  tasks: readonly Readonly<{
    id: string;
    goal: string;
    gate: string;
    command: string;
    artifactPathCount: number;
    artifactPaths: readonly string[];
    scoreFocusCount: number;
    scoreFocus: readonly string[];
  }>[];
  artifactPathCount: number;
  artifactPaths: readonly string[];
  scoreDimensionCount: number;
  scoreDimensions: readonly string[];
}>;

export function formatBenchmarkTaskCatalog(
  catalog: BenchmarkTaskCatalogPresentationSource
): string {
  const lines = [
    `Benchmark catalog ${catalog.catalogId} (${catalog.status})`,
    `Command: ${catalog.command}`,
    `Tasks: ${catalog.taskCount}`,
    `Artifact paths: ${catalog.artifactPathCount}`,
    `Artifact path list: ${catalog.artifactPaths.join(', ')}`,
    `Score dimension count: ${catalog.scoreDimensionCount}`,
    `Score dimensions: ${catalog.scoreDimensions.join(', ')}`
  ];
  for (const task of catalog.tasks) {
    lines.push(
      `Task ${task.id}: ${task.goal}; gate=${task.gate}; command=${task.command}; artifactCount=${task.artifactPathCount}; artifacts=${task.artifactPaths.join(', ')}; scoreFocusCount=${task.scoreFocusCount}; score=${task.scoreFocus.join(', ')}`
    );
  }
  return lines.join('\n');
}
