import { expect, test } from 'bun:test';

import { readRepositoryModuleGraphV1 } from '../../src/verification/test-impact/runtime/impact.ts';

const canonicalJournal = 'src/verification/action/journal.ts';
const canonicalRunner = 'src/verification/action/runner.ts';

test('Verification Action dependency direction and process capability stay bounded', () => {
  const graph = readRepositoryModuleGraphV1();
  const productionConsumers = graph.references.filter((reference) => (
    reference.from.startsWith('scripts/')
    && (reference.resolvedTarget === canonicalRunner || reference.resolvedTarget === canonicalJournal)
  ));
  expect(productionConsumers.length).toBeGreaterThan(0);
  expect(productionConsumers.every((reference) => (
    reference.specifier.includes('src/development/tooling/verification-action-')
  ))).toBe(true);
  expect(graph.directDependencies(canonicalRunner)).toContain(canonicalJournal);

  expect(graph.references.filter((reference) => (
    reference.from.startsWith('src/development/tooling/')
    && reference.candidateTargets.some((candidate) => candidate.startsWith('scripts/codex/'))
  ))).toEqual([]);
  expect(graph.references.filter((reference) => (
    reference.from === canonicalRunner && reference.specifier === 'node:child_process'
  ))).toEqual([]);
});
