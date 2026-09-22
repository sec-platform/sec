import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';
import { resolvePathInside } from '../../contracts/relative-path.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import {
  buildSkippedPolicyGateReport,
  completePolicyGateEvaluation,
  preparePolicyGateEvaluation,
  type PolicyGateObservation
} from '../../assurance/policies/gate.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../workspace/engineering-input.ts';
import { loadPolicyDeclarations } from '../workspace/sources/load-policy-declarations.ts';
import {
  observePolicySemanticFlow,
  POLICY_SEMANTIC_FLOW_PROVIDER_ID,
  POLICY_SEMANTIC_FLOW_PROVIDER_REVISION
} from './policies/semantic-flow.ts';

function readPolicyTarget(workspaceRoot: string, targetFile: string): string {
  const absolutePath = resolvePathInside(workspaceRoot, targetFile);
  if (absolutePath === null) {
    throw new CompilerError(
      'VERIFY-POLICY-002',
      `Policy target path escapes the workspace root: ${targetFile}`
    );
  }
  const bytes = readOptionalRetainedOrdinaryFile(
    absolutePath,
    `Policy target ${targetFile}`
  );
  if (bytes === null) {
    throw new CompilerError(
      'VERIFY-POLICY-003',
      `Applicable policy target is missing: ${targetFile}`
    );
  }
  try {
    return decodeExactUtf8(bytes, `Policy target ${targetFile}`);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-POLICY-004',
      `Applicable policy target is not exact UTF-8: ${targetFile}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
  const { official, project, definitions } = loadPolicyDeclarations(workspaceRoot);
  const mergedDefinitions = [...definitions.values()];

  if (mergedDefinitions.length === 0) {
    return buildSkippedPolicyGateReport(official, project);
  }

  let workspaceInput: Awaited<ReturnType<typeof loadWorkspaceEngineeringIRBuildInput>>;
  try {
    workspaceInput = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-POLICY-001',
      'Policy applicability cannot be resolved without one readable canonical Lock',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  const prepared = preparePolicyGateEvaluation({
    official,
    project,
    definitions: mergedDefinitions,
    lock: workspaceInput.sourceLock,
    engineeringIRInput: workspaceInput.engineeringIRInput,
    providerId: POLICY_SEMANTIC_FLOW_PROVIDER_ID,
    providerRevision: POLICY_SEMANTIC_FLOW_PROVIDER_REVISION
  });

  const observations: PolicyGateObservation[] = [];
  for (const request of prepared.requests) {
    const observation = observePolicySemanticFlow({
      targetPath: request.targetPath,
      source: readPolicyTarget(workspaceRoot, request.targetPath),
      providerModulePaths: new Set(request.providerModulePaths),
      rule: request.rule
    });
    observations.push({
      requestId: request.requestId,
      sourceRevision: observation.sourceRevision,
      status: observation.status
    });
  }

  return completePolicyGateEvaluation(prepared, observations);
}
