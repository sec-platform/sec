import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  getTestWorkspaceTempRoot,
  resolveTestWorkspaceNamespace
} from '../../platform/dev-runner/env-manager.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

test('test workspace roots honor a safe CI lane namespace', () => {
  const defaultRoot = path.join(compilerRoot, '.tmp', 'test-workspaces');

  expect(getTestWorkspaceTempRoot({})).toBe(defaultRoot);
  expect(getTestWorkspaceTempRoot({
    SEC_TEST_WORKSPACE_NAMESPACE: 'pr-risk-slow-suite-e2e-artifacts'
  })).toBe(path.join(defaultRoot, 'pr-risk-slow-suite-e2e-artifacts'));
});

test('test workspace namespace rejects path traversal and nested paths', () => {
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: '..' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a safe single path segment'
  );
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: '../outside' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a safe single path segment'
  );
  expect(() => resolveTestWorkspaceNamespace({ SEC_TEST_WORKSPACE_NAMESPACE: 'risk/artifacts' })).toThrow(
    'SEC_TEST_WORKSPACE_NAMESPACE must be a safe single path segment'
  );
});
