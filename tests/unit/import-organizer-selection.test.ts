import { describe, expect, test } from 'bun:test';

import {
  resolveImportDiffBase,
  selectChangedImportsOnly
} from '../../platform/dev-runner/import-organizer.ts';

describe('import organizer selection', () => {
  test('explicit changed-only setting overrides CI context', () => {
    expect(selectChangedImportsOnly({ SEC_IMPORTS_CHANGED_ONLY: '1' })).toBe(true);
    expect(selectChangedImportsOnly({
      SEC_IMPORTS_CHANGED_ONLY: '0',
      CI: 'true',
      GITHUB_EVENT_NAME: 'pull_request'
    })).toBe(false);
  });

  test('pull request CI checks changed files while scheduled CI remains global', () => {
    expect(selectChangedImportsOnly({
      CI: 'true',
      GITHUB_EVENT_NAME: 'pull_request'
    })).toBe(true);
    expect(selectChangedImportsOnly({
      CI: 'true',
      GITHUB_EVENT_NAME: 'schedule'
    })).toBe(false);
    expect(selectChangedImportsOnly({})).toBe(false);
  });

  test('diff base prefers explicit base, then pull request base branch, then previous commit', () => {
    expect(resolveImportDiffBase({
      SEC_CHANGED_BASE: 'abc123',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main'
    })).toBe('abc123');
    expect(resolveImportDiffBase({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main'
    })).toBe('origin/main');
    expect(resolveImportDiffBase({})).toBe('HEAD^1');
  });
});
