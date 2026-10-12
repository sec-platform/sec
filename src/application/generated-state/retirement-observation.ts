import path from 'node:path';
import { generatedStateLegacyRetirementRuleForPath, generatedStateRuleForPath, normalizeGeneratedStateRelativePath } from '../../execution/generated-state/contract.ts';
import type { GeneratedStateProducerBindingExpectation } from '../../execution/generated-state/lifecycle-port.ts';
import { issueGeneratedStateRetirementObservation } from '../../execution/generated-state/observation.ts';
import type { GeneratedStateRegistrationObservationBackend } from '../../execution/generated-state/registration-port.ts';

export async function observeGeneratedStateRetirement(input: Readonly<{
  repositoryRoot: string; workspaceRoot: string; relativePath: string;
  expected?: GeneratedStateProducerBindingExpectation; environment?: NodeJS.ProcessEnv;
}>, backend: GeneratedStateRegistrationObservationBackend) {
  const relativePath = normalizeGeneratedStateRelativePath(input.relativePath);
  const active = generatedStateRuleForPath(relativePath);
  const legacy = generatedStateLegacyRetirementRuleForPath(relativePath);
  const rule = active ?? (legacy !== null && input.expected?.ruleId === legacy.id &&
    input.expected.owner === legacy.owner && input.expected.producer === legacy.producer ? legacy : null);
  if (rule === null) throw new Error('Generated-state retirement observation has no current or explicitly owned historical rule.');
  const resource = backend.openObservation(input);
  if (resource === null) throw new Error('Native readonly workspace observation resource is unavailable.');
  const scope = Object.freeze({ repositoryRoot: path.resolve(input.repositoryRoot), workspaceRoot: path.resolve(input.workspaceRoot),
    relativePath, ruleId: rule.id, expected: input.expected });
  const captured = backend.captureObservationEvidence(resource, scope);
  await backend.assertObservationCurrent(resource);
  return issueGeneratedStateRetirementObservation(scope, captured.facts, captured.evidence);
}
