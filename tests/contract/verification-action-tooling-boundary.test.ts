import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { readRepositoryModuleGraphV1 } from '../../platform/shared/test-impact-contract.ts';

const repositoryRoot = process.cwd();
const retiredOwners = [
  'scripts/codex/verification-action-journal.ts',
  'scripts/codex/verification-action-runner.ts'
] as const;
const canonicalJournal = 'tooling/sec-dev/verification-action-journal.ts';
const canonicalRunner = 'tooling/sec-dev/verification-action-runner.ts';

test('Verification Action has one canonical tooling owner and no retired facade', () => {
  const graph = readRepositoryModuleGraphV1();

  for (const retired of retiredOwners) {
    expect(existsSync(path.join(repositoryRoot, retired))).toBe(false);
    expect(graph.files).not.toContain(retired);
    expect(graph.references.filter((reference) => (
      reference.candidateTargets.includes(retired)
    ))).toEqual([]);
  }

  expect(graph.files.filter((file) => /verification-action-runner\.ts$/u.test(file)))
    .toEqual([canonicalRunner]);
  expect(graph.files.filter((file) => /verification-action-journal\.ts$/u.test(file)))
    .toEqual([canonicalJournal]);
});

test('Verification Action dependency direction and process capability stay bounded', () => {
  const graph = readRepositoryModuleGraphV1();
  const productionConsumers = graph.references.filter((reference) => (
    reference.from.startsWith('scripts/')
    && (reference.resolvedTarget === canonicalRunner || reference.resolvedTarget === canonicalJournal)
  ));
  expect(productionConsumers.length).toBeGreaterThan(0);
  expect(productionConsumers.every((reference) => (
    reference.specifier.includes('tooling/sec-dev/verification-action-')
  ))).toBe(true);
  expect(graph.directDependencies(canonicalRunner)).toContain(canonicalJournal);

  expect(graph.references.filter((reference) => (
    reference.from.startsWith('tooling/sec-dev/')
    && reference.candidateTargets.some((candidate) => candidate.startsWith('scripts/codex/'))
  ))).toEqual([]);
  expect(graph.references.filter((reference) => (
    reference.from === canonicalRunner && reference.specifier === 'node:child_process'
  ))).toEqual([]);
});
