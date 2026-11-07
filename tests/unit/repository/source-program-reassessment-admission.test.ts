import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseRepositoryModuleDescriptorJson } from '../../../src/adapters/repository/architecture/contract.ts';
import { consumeHostedSourceProgramReassessment, issueHostedSourceProgramReassessment } from '../../../src/adapters/verification/platform/ci/runtime/source-program-reassessment-admission.ts';
import { TRUSTED_RUNTIME_NATIVE_BUDGETS, TRUSTED_RUNTIME_NATIVE_REQUIREMENT } from '../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-native-operation.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';
import { compileSemanticOperationPlan, issueSemanticOperationAttemptContext } from '../../../src/execution/operation/semantic.ts';

// Rejected input doubles never become native Origin, Domain grants or physical
// sessions. Positive native parent/Scope/Review qualification needs Hosted facts.
type IssueInput = Parameters<typeof issueHostedSourceProgramReassessment>[0];
type ConsumeInput = Parameters<typeof consumeHostedSourceProgramReassessment>[0];

function planDouble() {
  return compileSemanticOperationPlan({ operation: 'verification.source-program-reassessment',
    intentDigest: sha256('untrusted intent'), decisionDigest: sha256('untrusted decision'),
    aggregateBudgets: TRUSTED_RUNTIME_NATIVE_BUDGETS, requirements: [TRUSTED_RUNTIME_NATIVE_REQUIREMENT],
    deadlineAtUnixMs: Date.now() + 60_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: sha256('untrusted correlation') }) });
}

test('an unissued receiver Origin cannot issue a reassessment grant', async () => {
  const source = { origin: { phase: 'receive-verification-session-resume', runId: '1' } };
  await expect(issueHostedSourceProgramReassessment(source as unknown as IssueInput)).rejects.toMatchObject({
    code: 'authenticated-github-job-origin-unavailable', reason: 'binding'
  });
});

test('a JSON-copied operation plan cannot enter the Domain consumer', async () => {
  const input = { admission: { plan: JSON.parse(JSON.stringify(planDouble())), grant: {}, source: { origin: {} } } };
  await expect(consumeHostedSourceProgramReassessment(input as ConsumeInput)).rejects.toThrow('foundation');
});

test('a foundation plan cannot bypass receiver Origin admission at the Domain consumer', async () => {
  const input = { admission: { plan: planDouble(), grant: {}, source: { origin: {} } } };
  await expect(consumeHostedSourceProgramReassessment(input as unknown as ConsumeInput)).rejects.toMatchObject({
    code: 'authenticated-github-job-origin-unavailable', reason: 'binding'
  });
});

test('declared issuer and physical consumer share the actual bounded operation contract', () => {
  const ciPath = 'src/adapters/verification/platform/ci/module.json';
  const nativePath = 'src/adapters/verification/platform/trusted-runtime/module.json';
  const ci = parseRepositoryModuleDescriptorJson(readFileSync(ciPath, 'utf8'), ciPath);
  const native = parseRepositoryModuleDescriptorJson(readFileSync(nativePath, 'utf8'), nativePath);
  const issuer = ci.capabilityProviders.flatMap(provider => provider.operationRoles)
    .find(role => role.operation === 'issueHostedSourceProgramReassessment');
  const consumer = native.capabilityProviders.flatMap(provider => provider.operationRoles)
    .find(role => role.operation === 'observeTrustedRuntimeSourceProgramTransition');
  expect(issuer?.role).toBe('grant-issuer'); expect(consumer?.role).toBe('domain-owner');
  expect(issuer?.semanticOperation).toBe('verification.source-program-reassessment');
  expect(consumer?.semanticOperation).toBe(issuer?.semanticOperation);
  for (const obligation of ci.operationObligations) {
    expect(obligation.consumerSupport.consumers).toEqual([native.moduleId]);
    expect(obligation.resources.aggregateBudgets).toEqual(TRUSTED_RUNTIME_NATIVE_BUDGETS);
    expect(obligation.effect.kinds).toEqual(TRUSTED_RUNTIME_NATIVE_REQUIREMENT.effectKinds);
  }
  expect(native.operationObligations[0]!.resources.aggregateBudgets).toEqual(TRUSTED_RUNTIME_NATIVE_BUDGETS);
});
