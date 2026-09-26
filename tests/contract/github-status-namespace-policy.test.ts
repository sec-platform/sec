import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { INTEGRATION_AUTHORIZATION_STATUS_CONTEXT } from '../../src/adapters/self-hosting/control/main-health/github-status-namespace.ts';
import { VERIFICATION_ACTION_PROVIDER_POLICY } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

type Workflow = Readonly<{
  jobs: Readonly<Record<string, Readonly<{
    permissions?: Readonly<Record<string, string>>;
    steps?: readonly Readonly<{
      env?: Readonly<Record<string, unknown>>;
      run?: string;
      with?: Readonly<Record<string, unknown>>;
    }>[];
  }>>>;
}>;

test('terminal status writer cannot mutate repository and effect job cannot mint status', async () => {
  const source = await readCompilerFile('.github/workflows/merge-gate.yml');
  const workflow = parseYaml(source) as Workflow;
  const terminal = workflow.jobs['terminal-status']!;
  const integrate = workflow.jobs.integrate!;

  expect(terminal.permissions).toEqual({
    contents: 'read',
    'pull-requests': 'read',
    statuses: 'write'
  });
  expect(terminal.permissions?.contents).not.toBe('write');
  expect(terminal.permissions?.['pull-requests']).not.toBe('write');
  expect(terminal.permissions?.issues).not.toBe('write');
  expect(integrate.permissions?.statuses).toBe('read');
  expect(integrate.permissions?.contents).toBe('write');
  expect(integrate.permissions?.['pull-requests']).toBe('write');

  expect(terminal.steps?.[0]?.env?.STATUS_CONTEXT)
    .toBe(INTEGRATION_AUTHORIZATION_STATUS_CONTEXT);
});

test('merge-facing context is exact and cannot collide with the Action prefix', () => {
  expect(INTEGRATION_AUTHORIZATION_STATUS_CONTEXT.startsWith(
    VERIFICATION_ACTION_PROVIDER_POLICY.contextPrefix
  )).toBe(false);
  expect(INTEGRATION_AUTHORIZATION_STATUS_CONTEXT).toBe('sec/integration-authorization');
});
