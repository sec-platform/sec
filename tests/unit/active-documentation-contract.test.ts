import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  CODEX_DEVELOPMENT_ACTIVE_DOCUMENTATION_PATHS_V2,
  CodexDevelopmentIsActiveDocumentationPathV1
} from '../../platform/shared/active-documentation-contract.ts';
import {
  activeDocumentationPaths,
  DOCUMENT_AUTHORITY_REGISTRY_SCHEMA,
  parseDocumentationAuthorityRegistry,
  renderDocumentationIndex
} from '../../platform/shared/documentation-authority-contract.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from '../../platform/shared/repository-path-contract.ts';

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
    audience: ['developer'],
    consumers: ['test'],
    updateTriggers: ['contract-change'],
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
    audience: ['developer'],
    consumers: ['roadmap'],
    updateTriggers: ['proposal-decision'],
    ...overrides
  };
}

function authorityRegistry(...documents: Record<string, unknown>[]): string {
  return JSON.stringify({
    schema: DOCUMENT_AUTHORITY_REGISTRY_SCHEMA,
    documents
  });
}

test('canonical repository paths require normalized repository-relative POSIX segments', () => {
  for (const file of [
    'README.md',
    'docs/product.md',
    'docs/work/current-state.yaml'
  ]) expect(CodexDevelopmentIsCanonicalRepositoryPathV1(file)).toBe(true);

  for (const file of NON_CANONICAL_REPOSITORY_PATHS) {
    expect(CodexDevelopmentIsCanonicalRepositoryPathV1(file)).toBe(false);
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

test('documentation dependency graph rejects projection and generation cycles', () => {
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('a', 'docs/a.md', { projects: ['b'] }),
    authorityRecord('b', 'docs/b.md', { projects: ['a'] })
  ))).toThrow('Documentation dependency cycle');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('self', 'docs/self.md', { generatedFrom: 'docs/self.md' })
  ))).toThrow('Documentation dependency cycle');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    authorityRecord('a', 'docs/a.md', { generatedFrom: 'docs/b.md' }),
    authorityRecord('b', 'docs/b.md', { generatedFrom: 'docs/a.md' })
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

test('adopt and adapt proposals require target, activation and archive retirement', () => {
  const target = authorityRecord('target', 'docs/target.md');
  const base = proposalRecord('proposal', 'docs/proposals/proposal.md', 'target');

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    { ...base, proposal: { ...(base.proposal as object), canonicalTargets: [] } }
  ))).toThrow(/requires canonicalTargets and activationTrigger/);

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    { ...base, proposal: { ...(base.proposal as object), activationTrigger: null } }
  ))).toThrow(/requires canonicalTargets and activationTrigger/);

  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    { ...base, proposal: { ...(base.proposal as object), retirementTarget: 'docs/proposal.md' } }
  ))).toThrow(/retirementTarget must be under docs\/archive/);
});

test('proposal targets must resolve to non-proposal registered owners', () => {
  const target = authorityRecord('target', 'docs/target.md');
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    proposalRecord('unknown', 'docs/proposals/unknown.md', 'missing')
  ))).toThrow(/targets unknown document missing/);

  const first = proposalRecord('first', 'docs/proposals/first.md', 'target');
  const second = proposalRecord('second', 'docs/proposals/second.md', 'first');
  expect(() => parseDocumentationAuthorityRegistry(authorityRegistry(
    target,
    first,
    second
  ))).toThrow(/cannot migrate into proposal first/);
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

test('active documentation projection and generated index exactly match registry', async () => {
  const registrySource = await readFile(
    path.join(REPOSITORY_ROOT, 'docs/authority.json'),
    'utf8'
  );
  const registry = parseDocumentationAuthorityRegistry(registrySource);
  const projectedPaths: readonly string[] = CODEX_DEVELOPMENT_ACTIVE_DOCUMENTATION_PATHS_V2;
  expect(projectedPaths).toEqual(activeDocumentationPaths(registry));
  for (const file of CODEX_DEVELOPMENT_ACTIVE_DOCUMENTATION_PATHS_V2) {
    expect(CodexDevelopmentIsActiveDocumentationPathV1(file)).toBe(true);
  }

  const actualIndex = await readFile(path.join(REPOSITORY_ROOT, 'docs/README.md'), 'utf8');
  expect(actualIndex.replace(/\r\n/gu, '\n')).toBe(renderDocumentationIndex(registry));
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
  ]) expect(CodexDevelopmentIsActiveDocumentationPathV1(file)).toBe(false);
});
