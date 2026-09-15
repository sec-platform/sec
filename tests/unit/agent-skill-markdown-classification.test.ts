import { expect, test } from 'bun:test';

import {
  resolveSecMarkdownSkillCoverage
} from '../../src/control/agent/skill.ts';

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

test('retired public documentation paths have no current classification', () => {
  for (const path of [
    'public-docs/CONTRACT.md',
    'public-docs/README.md',
    'public-docs/principles.md'
  ]) {
    expect(resolveSecMarkdownSkillCoverage(path)).toBeNull();
  }
  expect(resolveSecMarkdownSkillCoverage('public-docs/nested/unregistered.md')).toBeNull();
});

test('repository control Markdown is classified outside the documentation namespace', () => {
  expect(resolveSecMarkdownSkillCoverage(
    'config/repository/work-packages/docs-control-convergence.md'
  )).toEqual({ kind: 'frozen-work-package', skills: [] });
  expect(resolveSecMarkdownSkillCoverage('config/repository/active-work-package.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
  expect(resolveSecMarkdownSkillCoverage('config/repository/rolling-plan.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
  expect(resolveSecMarkdownSkillCoverage('config/repository/work-selection.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
});
