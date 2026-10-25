import { settleResources, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest,
  type OperationEffectKind
} from '../../../../execution/operation/semantic.ts';
import { issueIndependentProviderProcessCapability } from './independent-provider-process.ts';
import {
  compileWindowsObservedJobLimitFlags,
  windowsObservedJobDescendantDisposition
} from './observed-process.ts';
import {
  inspectNoFollowDirectoryChain,
  retainCurrentProcessExecutable,
  retainNoFollowDirectoryForChildProcess,
} from './physical-no-follow.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from './process.ts';

const digest = (value: unknown): OperationDigest => sha256(value) as OperationDigest;

function providerCapability(effectKinds: readonly OperationEffectKind[]) {
  const plan = compileSemanticOperationPlan({
    operation: 'test.independent-provider-job',
    intentDigest: digest('intent'),
    decisionDigest: digest('decision'),
    deadlineAtUnixMs: Date.now() + 10_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: 1 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'test.provider-process',
      contractDigest: digest('contract'),
      effectKinds,
      failureKinds: ['process.failed']
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: digest('grant') })
  });
  const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'test.provider-process',
    contractDigest: digest('contract'),
    providerIdentityDigest: digest('provider')
  })]);
  const executable = retainCurrentProcessExecutable(RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'provider job test executable');
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(path.resolve(import.meta.dir, '../../../..'), 'provider job test cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'provider job test cwd'
  );
  const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
  try {
    return Object.freeze({
      capability: issueIndependentProviderProcessCapability({ boundary, operation }),
      dispose() {
        workingDirectory.dispose();
        executable.dispose();
      }
    });
  } catch (error) {
    workingDirectory.dispose();
    executable.dispose();
    throw error;
  }
}

test('ordinary process callers cannot structurally select provider breakaway', () => {
  expect(() => compileWindowsObservedJobLimitFlags(
    'unowned' as 'contained'
  )).toThrow('descendant disposition is invalid');
  expect(windowsObservedJobDescendantDisposition()).toBe('contained');
  expect(compileWindowsObservedJobLimitFlags(
    windowsObservedJobDescendantDisposition()
  )).toBe(0x0000_2000);
  expect(() => windowsObservedJobDescendantDisposition({
    providerPhysicalIdentityDigest: digest('forged-provider')
  })).toThrow('was not issued');
  expect(() => providerCapability(['process'])).toThrow('process and provider Effects');
});

test('an issued process plus provider capability selects breakaway behavior', () => {
  const fixture = providerCapability(['process', 'provider']);
  let fixtureFailure1: ResourceSettlementFailure | undefined;
  try {
    expect(windowsObservedJobDescendantDisposition(fixture.capability)).toBe('independent-provider');
    expect(compileWindowsObservedJobLimitFlags(
      windowsObservedJobDescendantDisposition(fixture.capability)
    )).toBe(0x0000_3000);
    expect(() => windowsObservedJobDescendantDisposition({ ...fixture.capability }))
      .toThrow('was not issued');
  } catch (error) {
    fixtureFailure1 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure1,
      cleanup: [{ label: 'fixture cleanup', settle: () => { fixture.dispose(); } }]
    });
  }
});
