import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  CodexDevelopmentDefaultGitRevision,
  CodexDevelopmentExactGitTestImpactSourceProvider
} from '../../src/verification/ci/runtime/ci-orchestration-core.ts';
import { readRepositoryModuleGraphV1 } from '../../src/verification/test-impact/runtime/impact.ts';

const canonicalJournal = 'src/verification/action/journal.ts';
const canonicalRunner = 'src/verification/action/runner.ts';

test('Verification Action dependency direction and process capability stay bounded', () => {
  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const headSha = CodexDevelopmentDefaultGitRevision(repositoryRoot, 'HEAD');
  if (headSha === null) throw new Error('Verification Action boundary requires one exact Git HEAD');
  const graph = readRepositoryModuleGraphV1(
    CodexDevelopmentExactGitTestImpactSourceProvider(repositoryRoot, headSha)
  );
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
