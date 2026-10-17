import { expect, test } from 'bun:test';

import {
  resolveMarkdownSkillCoverage
} from '../../src/adapters/self-hosting/control/agent/skill.ts';

test('ordinary root policies carry no Skill authority and unknown external Markdown stays unclassified', () => {
  for (const path of [
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.github/PULL_REQUEST_TEMPLATE.md'
  ]) {
    expect(resolveMarkdownSkillCoverage(path)).toEqual({ kind: 'repository-content', skills: [] });
  }
  expect(resolveMarkdownSkillCoverage('notes/architecture.md')).toBeNull();
});

test('repository control Markdown is classified outside the documentation namespace', () => {
  expect(resolveMarkdownSkillCoverage(
    'config/repository/work-packages/docs-control-convergence.md'
  )).toEqual({ kind: 'frozen-work-package', skills: [] });
  expect(resolveMarkdownSkillCoverage('config/repository/active-work-package.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
  expect(resolveMarkdownSkillCoverage('config/repository/rolling-plan.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
  expect(resolveMarkdownSkillCoverage('config/repository/work-selection.md'))
    .toEqual({ kind: 'control-projection', skills: [] });
});
