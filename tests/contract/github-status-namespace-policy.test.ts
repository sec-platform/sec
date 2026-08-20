import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  SEC_GITHUB_STATUS_NAMESPACE_POLICY_DIGEST_V1,
  SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1,
  SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1,
  SEC_VERIFICATION_ACTION_STATUS_PREFIX_V1
} from '../../platform/shared/github-status-namespace-policy.ts';
import { VERIFICATION_ACTION_PROVIDER_POLICY_V2 } from '../../platform/shared/verification-action-provider-contract.ts';
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

const WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/architecture-tools.yml',
  '.github/workflows/compiler-pr-validation.yml',
  '.github/workflows/compiler-release-validation.yml',
  '.github/workflows/sec-merge-gate.yml',
  '.github/workflows/sec-trusted-bootstrap.yml'
] as const);

test('status namespace policy declares one non-merge Action prefix and one merge terminal context', () => {
  expect(SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1.namespaces.verificationAction).toMatchObject({
    prefix: 'sec/action/',
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    writerJobs: ['claim-verification-action', 'assemble-verification-action-terminal'],
    authority: { requiredCheck: false, mergeAuthorization: false, actionKeyTombstone: true }
  });
  expect(SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1.namespaces.integrationAuthorization).toMatchObject({
    context: 'sec/integration-authorization',
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    writerJobs: ['terminal-status'],
    authority: { requiredCheck: true, mergeAuthorization: true }
  });
  expect(SEC_GITHUB_STATUS_NAMESPACE_POLICY_V1.separation).toEqual({
    enforcement: 'trusted-base-tcb-plus-job-scoped-github-token-permissions',
    sameGitHubApp: true,
    terminalWriterMayMutateRepository: false,
    integrationEffectMayWriteStatuses: false,
    actionWritersMayUseTerminalContext: false
  });
  expect(SEC_GITHUB_STATUS_NAMESPACE_POLICY_DIGEST_V1).toMatch(/^sha256:[0-9a-f]{64}$/u);

});

test('terminal status writer cannot mutate repository and effect job cannot mint status', async () => {
  const source = await readCompilerFile('.github/workflows/sec-merge-gate.yml');
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
    .toBe(SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1);
});

test('merge-facing context is exact and cannot collide with the Action prefix', () => {
  expect(SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1.startsWith(
    SEC_VERIFICATION_ACTION_STATUS_PREFIX_V1
  )).toBe(false);
  expect(SEC_INTEGRATION_AUTHORIZATION_STATUS_CONTEXT_V1).toBe('sec/integration-authorization');
});
