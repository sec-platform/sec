import { expect, test } from 'bun:test';

import { parseDocumentationAuthorityRegistry } from '../../src/control/documentation/authority.ts';

function authority(
  id: string,
  documentPath: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    path: documentPath,
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

function proposal(
  id: string,
  target = 'target',
  retirementTarget = `docs/archive/proposals/${id}.md`,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    path: `docs/proposals/${id}.md`,
    kind: 'proposal',
    domain: 'proposal',
    lifecycle: 'draft',
    dynamicPolicy: 'forbidden',
    owns: [],
    projects: [target],
    proposal: {
      disposition: 'adapt',
      canonicalTargets: [target],
      activationTrigger: 'focused-work-package',
      retirementTarget,
      evidenceRequirement: 'consumer-migration-and-main-readback',
      reversalCondition: null
    },
    audience: ['developer'],
    consumers: ['roadmap'],
    updateTriggers: ['proposal-decision'],
    ...overrides
  };
}

function registry(...documents: Record<string, unknown>[]): string {
  return JSON.stringify({ documents });
}

test('registry records remain inside docs or the two explicit root entries', () => {
  expect(() => parseDocumentationAuthorityRegistry(registry(
    authority('outside', 'platform/authority.md')
  ))).toThrow(/must be under docs\/ or one of AGENTS\.md, README\.md/);

  expect(() => parseDocumentationAuthorityRegistry(registry(
    authority('root-readme', 'README.md')
  ))).not.toThrow();
});

test('generated projections cannot own canonical facts or receive proposal authority', () => {
  expect(() => parseDocumentationAuthorityRegistry(registry(
    authority('source', 'docs/source.md'),
    authority('generated', 'docs/generated.md', { generatedFrom: 'docs/source.md' })
  ))).toThrow(/generated projection cannot own canonical facts/);

  const generatedNavigation = {
    id: 'generated-navigation',
    path: 'docs/generated-navigation.md',
    kind: 'navigation',
    domain: 'navigation',
    lifecycle: 'active',
    dynamicPolicy: 'forbidden',
    owns: [],
    projects: ['target'],
    generatedFrom: 'docs/target.md',
    audience: ['developer'],
    consumers: ['reader'],
    updateTriggers: ['registry-change']
  };
  expect(() => parseDocumentationAuthorityRegistry(registry(
    authority('target', 'docs/target.md'),
    generatedNavigation,
    proposal('candidate', 'generated-navigation')
  ))).toThrow(/target generated-navigation is not an owning canonical record/);
});

test('retirement destinations are case-insensitively unique and unoccupied', () => {
  const target = authority('target', 'docs/target.md');
  expect(() => parseDocumentationAuthorityRegistry(registry(
    target,
    proposal('first', 'target', 'docs/archive/proposals/Retired.md'),
    proposal('second', 'target', 'docs/archive/proposals/retired.md')
  ))).toThrow(/retirementTarget .* is shared by first and second/);

  expect(() => parseDocumentationAuthorityRegistry(registry(
    target,
    authority('occupied', 'docs/archive/proposals/occupied.md'),
    proposal('candidate', 'target', 'docs/archive/proposals/OCCUPIED.md')
  ))).toThrow(/retirementTarget .* is occupied by occupied/);
});

test('retire is a terminal proposal disposition with migrated targets and exact evidence', () => {
  const target = authority('target', 'docs/target.md');
  const retiringProposal = (proposalMetadata: Record<string, unknown>) => proposal(
    'candidate',
    'target',
    'docs/archive/proposals/candidate.md',
    { proposal: proposalMetadata }
  );
  const validRetirement = {
    disposition: 'retire',
    canonicalTargets: ['target'],
    activationTrigger: null,
    retirementTarget: 'docs/archive/proposals/candidate.md',
    evidenceRequirement: 'consumer-migration-and-main-readback',
    reversalCondition: null
  };

  expect(() => parseDocumentationAuthorityRegistry(registry(
    target,
    retiringProposal(validRetirement)
  ))).not.toThrow();

  for (const invalid of [
    { ...validRetirement, canonicalTargets: [] },
    { ...validRetirement, activationTrigger: 'future-work-package' },
    { ...validRetirement, evidenceRequirement: null },
    { ...validRetirement, reversalCondition: 'restore-proposal' }
  ]) {
    expect(() => parseDocumentationAuthorityRegistry(registry(
      target,
      retiringProposal(invalid)
    ))).toThrow(/retire requires canonicalTargets and evidenceRequirement/);
  }
});

test('unknown canonical target errors are isolated from valid project edges', () => {
  const candidate = proposal('candidate', 'target', 'docs/archive/proposals/candidate.md', {
    projects: ['target'],
    proposal: {
      disposition: 'adapt',
      canonicalTargets: ['missing'],
      activationTrigger: 'focused-work-package',
      retirementTarget: 'docs/archive/proposals/candidate.md',
      evidenceRequirement: 'consumer-migration-and-main-readback',
      reversalCondition: null
    }
  });
  expect(() => parseDocumentationAuthorityRegistry(registry(
    authority('target', 'docs/target.md'),
    candidate
  ))).toThrow(/targets unknown document missing/);
});
