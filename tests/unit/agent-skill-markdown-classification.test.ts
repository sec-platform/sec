import { expect, test } from 'bun:test';

import {
  resolveSecMarkdownSkillCoverage
} from '../../platform/shared/agent-skill-contract.ts';

test('unknown root and docs-external Markdown fail closed', () => {
  for (const path of [
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'notes/architecture.md'
  ]) {
    expect(resolveSecMarkdownSkillCoverage(path)).toBeNull();
  }
});

test('public documentation pages classify as projection without Skill authority', () => {
  for (const path of [
    'public-docs/CONTRACT.md',
    'public-docs/README.md',
    'public-docs/principles.md'
  ]) {
    expect(resolveSecMarkdownSkillCoverage(path)).toEqual({
      kind: 'public-projection',
      skills: []
    });
  }
  expect(resolveSecMarkdownSkillCoverage('public-docs/nested/unregistered.md')).toBeNull();
});
