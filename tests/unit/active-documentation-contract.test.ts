import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  isActiveDocumentationPath
} from '../../src/control/documentation/active.ts';
import {
  activeDocumentationPaths,
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex
} from '../../src/control/documentation/authority.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../src/system-architecture/foundation/contract/repository-path.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

const NON_CANONICAL_REPOSITORY_PATHS = [
  '',
  '/docs/work/current-state.yaml',
  'C:/absolute.md',
  'C:relative.md',
  'file:/docs/readme.md',
  'docs\\work\\current-state.yaml',
  'docs/file:stream.md',
  'docs//x.md',
  'docs/./x.md',
  'docs/work/../evidence/probe.yaml',
  'docs/work//state.yaml',
  'docs/work/\0state.yaml',
  'docs/e\u0301.md'
] as const;

function authorityRecord(
  id: string,
  filePath: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    path: filePath,
    kind: 'authority',
    domain: `test-${id}`,
    lifecycle: 'stable',
    dynamicPolicy: 'forbidden',
    owns: [`test.${id}`],
    projects: [],
    ...overrides
  };
}

function navigationRecord(
  id: string,
  filePath: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    path: filePath,
    kind: 'navigation',
    domain: `navigation-${id}`,
    lifecycle: 'active',
    dynamicPolicy: 'forbidden',
    owns: [],
    projects: [],
    ...overrides
  };
}

function proposalRecord(
  id: string,
  filePath: string,
  target = 'target',
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    path: filePath,
    kind: 'proposal',
    domain: 'proposal',
    lifecycle: 'draft',
    dynamicPolicy: 'forbidden',
    owns: [],
    projects: [target],
    proposal: {
      disposition: 'adapt',
      canonicalTargets: [target],
      activationTrigger: 'real-consumer-and-focused-work-package',
      retirementTarget: `docs/archive/proposals/${id}.md`,
      evidenceRequirement: 'consumer-migration-and-main-readback',
      reversalCondition: null
    },
    ...overrides
  };
}

function authorityRegistry(...documents: Record<string, unknown>[]): string {
  return JSON.stringify({ documents });
}

test('canonical repository paths require normalized repository-relative POSIX segments', () => {
  for (const file of [
    'README.md',
    'docs/product.md',
    'docs/work/current-state.yaml'
  ]) expect(CodexDevelopmentIsCanonicalRepositoryPath(file)).toBe(true);

  for (const file of NON_CANONICAL_REPOSITORY_PATHS) {
    expect(CodexDevelopmentIsCanonicalRepositoryPath(file)).toBe(false);
  }
});

test('documentation registry reuses canonical paths and rejects Windows aliases', () => {
  for (const file of NON_CANONICAL_REPOSITORY_PATHS) {
    expect(() => parseDocumentationAuthorityRegistry(
      authorityRegistry(authorityRecord('invalid', file))
    )).toThrow();
  }

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('upper', 'docs/A.md'),
    authorityRecord('lower', 'docs/a.md')
  ))).toThrow('Case-insensitive document path collision');
});

test('existing registry lists retain code-unit ordering semantics', () => {
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('ordered', 'docs/ordered.md', { owns: ['test.A', 'test.a'] })
  ))).not.toThrow();
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('reversed', 'docs/reversed.md', { owns: ['test.a', 'test.A'] })
  ))).toThrow(/canonical code-unit order/);
});

test('documentation dependency graph rejects project, generation and proposal-target cycles', () => {
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('a', 'docs/a.md', { projects: ['b'] }),
    authorityRecord('b', 'docs/b.md', { projects: ['a'] })
  ))).toThrow('Documentation dependency cycle');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    navigationRecord('self', 'docs/self.md', { generatedFrom: 'docs/self.md' })
  ))).toThrow('Documentation dependency cycle');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    navigationRecord('a', 'docs/a.md', { generatedFrom: 'docs/b.md' }),
    navigationRecord('b', 'docs/b.md', { generatedFrom: 'docs/a.md' })
  ))).toThrow('Documentation dependency cycle');

  const target = authorityRecord('target', 'docs/target.md', { projects: ['proposal'] });
  const proposal = proposalRecord('proposal', 'docs/proposals/proposal.md', 'target', {
    projects: []
  });
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    proposal
  ))).toThrow('Documentation dependency cycle');
});

test('proposal kind requires one enforceable lifecycle disposition', () => {
  const target = authorityRecord('target', 'docs/target.md');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    proposalRecord('missing', 'docs/proposals/missing.md', 'target', { proposal: undefined })
  ))).toThrow(/requires lifecycle draft and proposal metadata/);

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    proposalRecord('active', 'docs/proposals/active.md', 'target', { lifecycle: 'active' })
  ))).toThrow(/requires lifecycle draft/);

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    authorityRecord('non-proposal', 'docs/non-proposal.md', {
      proposal: proposalRecord('nested', 'docs/proposals/nested.md', 'target').proposal
    })
  ))).toThrow(/non-proposal kind cannot declare proposal metadata/);
});

test('adopt and adapt proposals require target, activation, Evidence and archive retirement', () => {
  const target = authorityRecord('target', 'docs/target.md');
  const base = proposalRecord('proposal', 'docs/proposals/proposal.md', 'target');

  for (const patch of [
    { canonicalTargets: [] },
    { activationTrigger: null },
    { evidenceRequirement: null }
  ]) {
    expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
      target,
      { ...base, proposal: { ...(base.proposal as object), ...patch } }
    ))).toThrow(/requires canonicalTargets, activationTrigger and evidenceRequirement/);
  }

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    { ...base, proposal: { ...(base.proposal as object), retirementTarget: 'docs/proposal.md' } }
  ))).toThrow(/retirementTarget must be under docs\/archive/);
});

test('proposal targets must resolve to owning non-proposal records', () => {
  const target = authorityRecord('target', 'docs/target.md');
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    proposalRecord('unknown', 'docs/proposals/unknown.md', 'missing', {
      projects: ['target']
    })
  ))).toThrow(/targets unknown document missing/);

  const first = proposalRecord('first', 'docs/proposals/first.md', 'target');
  const second = proposalRecord('second', 'docs/proposals/second.md', 'first');
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    first,
    second
  ))).toThrow(/cannot migrate into proposal first/);

  const navigation = navigationRecord('navigation', 'docs/navigation.md');
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    navigation,
    proposalRecord('bad-target', 'docs/proposals/bad-target.md', 'navigation')
  ))).toThrow(/target navigation is not an owning canonical record/);
});

test('proposal retirement targets are unique', () => {
  const target = authorityRecord('target', 'docs/target.md');
  const first = proposalRecord('first', 'docs/proposals/first.md', 'target');
  const secondBase = proposalRecord('second', 'docs/proposals/second.md', 'target');
  const second = {
    ...secondBase,
    proposal: {
      ...(secondBase.proposal as object),
      retirementTarget: 'docs/archive/proposals/first.md'
    }
  };
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    first,
    second
  ))).toThrow(/retirementTarget .* is shared by first and second/);
});

test('reject and experimental dispositions preserve reversal or Evidence requirements', () => {
  const target = authorityRecord('target', 'docs/target.md');
  const base = proposalRecord('proposal', 'docs/proposals/proposal.md', 'target');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    {
      ...base,
      proposal: {
        ...(base.proposal as object),
        disposition: 'reject',
        canonicalTargets: [],
        reversalCondition: null
      }
    }
  ))).toThrow(/reject requires no canonicalTargets and a reversalCondition/);

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    {
      ...base,
      proposal: {
        ...(base.proposal as object),
        disposition: 'experimental',
        canonicalTargets: [],
        evidenceRequirement: null
      }
    }
  ))).toThrow(/experimental requires activationTrigger and evidenceRequirement/);
});

test('active documentation lookup and generated index consume the registry', async () => {
  const registrySource = await readFile(
    path.join(REPOSITORY_ROOT, 'docs/authority.json'),
    'utf8'
  );
  const registry = parseDocumentationAuthorityRegistry(registrySource);
  const projectedPaths = activeDocumentationPaths(registry);
  for (const file of projectedPaths) {
    expect(isActiveDocumentationPath(file)).toBe(true);
  }

  const actualIndex = await readFile(path.join(REPOSITORY_ROOT, 'docs/README.md'), 'utf8');
  expect(actualIndex).toBe(renderDocumentationIndex(registry));
  expect(actualIndex).toContain('| Proposal 处置 |');
  expect(actualIndex).toContain('| adapt |');
});

test('historical, evidence, work-package, and unknown documents are not active by fallback', () => {
  for (const file of [
    'docs/00-文档索引与一致性规则.md',
    'docs/archive/authority-v5/00-文档索引与一致性规则.md',
    'docs/evidence/probe.md',
    'docs/work-packages/unknown.md',
    'docs/architecture/unowned.md',
    'docs/governance/unowned.yaml',
    'README.MD',
    ...NON_CANONICAL_REPOSITORY_PATHS
  ]) expect(isActiveDocumentationPath(file)).toBe(false);
});
