import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  cleanTestWorkspaces,
  getTestWorkspaceTemplateRoot,
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
  expect(getTestWorkspaceTemplateRoot()).toBe(path.join(defaultRoot, '.templates'));
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

test('test workspace cleanup removes only the selected run namespace', async () => {
  const namespace = `env-manager-${process.pid}-${Date.now()}`;
  const env = { SEC_TEST_WORKSPACE_NAMESPACE: namespace };
  const root = getTestWorkspaceTempRoot(env);
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'residue.txt'), 'residue', 'utf8');

  await cleanTestWorkspaces(env);

  await expect(fs.access(root)).rejects.toThrow();
});
