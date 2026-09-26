import { expect, test } from 'bun:test';

import { compileRepositoryModuleGraph } from '../../src/adapters/repository/source-program-model/typescript.ts';
import { readCompilerTypeScriptMutationFixture } from '../helpers/compiler-fixtures.ts';

// This is the admitted pure closure, not a sample of entrypoints. Every local
// import/re-export (including type-only edges) must resolve inside this set.
const pureMaintenanceFiles = [
  'src/adapters/self-hosting/control/repository-maintenance/contract.ts',
  'src/adapters/self-hosting/control/repository-maintenance/plan.ts',
  'src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts',
  'src/adapters/self-hosting/control/repository-maintenance/comment-retirement-contract.ts',
  'src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts',
  'src/contracts/git-reference.ts',
  'src/contracts/canonical.ts',
  'src/contracts/digest.ts'
] as const;

async function compilePureMaintenanceGraph(injectedSource = '') {
  const sources = new Map(await Promise.all(pureMaintenanceFiles.map(async (file) => (
    [file, await readCompilerTypeScriptMutationFixture(file, 'tcb-analysis')] as const
  ))));
  return compileRepositoryModuleGraph({
    files: pureMaintenanceFiles,
    readSource: (file) => {
      const source = sources.get(file as typeof pureMaintenanceFiles[number]);
      if (source === undefined) throw new Error(`Unadmitted maintenance source: ${file}`);
      // Mutate a transitive dependency, not only the public entrypoint.
      return file.endsWith('/comment-retirement-contract.ts') ? source + injectedSource : source;
    }
  });
}

function impureEdges(graph: ReturnType<typeof compileRepositoryModuleGraph>) {
  return graph.references.filter((reference) => {
    if (reference.resolvedTarget !== null) return false;
    // Deterministic encoding/hash owners may use pure runtime primitives;
    // maintenance itself receives no filesystem, process or network import.
    if (reference.from === 'src/contracts/canonical.ts' && reference.specifier === 'node:path') return false;
    if (reference.from === 'src/contracts/digest.ts' && reference.specifier === 'node:crypto') return false;
    return true;
  });
}

test('maintenance pure closure contains no provider, host or unresolved dependency', async () => {
  const graph = await compilePureMaintenanceGraph();
  expect(graph.unresolvedFiles).toEqual([]);
  expect(impureEdges(graph)).toEqual([]);
});

test.each([
  "\nimport './comment-retirement.ts';",
  "\nexport { retireExactClosedIssueComments } from './comment-retirement.ts';",
  "\nimport type { Foreign } from './comment-retirement.ts';",
  "\nimport { readFileSync } from 'node:fs';",
  "\nvoid import('node:child_process');"
])('maintenance closure rejects a transitive forbidden edge: %s', async (injectedSource) => {
  const graph = await compilePureMaintenanceGraph(injectedSource);
  expect(impureEdges(graph)).toHaveLength(1);
});
