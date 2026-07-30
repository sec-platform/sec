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
