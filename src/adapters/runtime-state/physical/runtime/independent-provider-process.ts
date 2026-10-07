import { sha256 } from '../../../../contracts/canonical.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import {
  assertRetainedCommandBoundaryCurrent,
  retainedCommandBoundaryAuxiliaryInputs,
  type RetainedCommandBoundary
} from './retained-command-boundary.ts';

export interface IndependentProviderProcessCapability {
  readonly providerPhysicalIdentityDigest: OperationDigest;
}

type IndependentProviderProcessRecord = Readonly<{
  boundary: RetainedCommandBoundary;
  boundAttemptDigest: OperationDigest;
  operationIdentityDigest: OperationDigest;
  providerPhysicalIdentityDigest: OperationDigest;
}>;

const ISSUED_INDEPENDENT_PROVIDER_PROCESS_CAPABILITIES = new WeakMap<
  object,
  IndependentProviderProcessRecord
>();

/**
 * Issues breakaway authority only to the holder of an already-retained
 * executable/cwd boundary. The semantic projection contributes correlation,
 * never authority, and no caller-selected provider digest is accepted.
 */
export function issueIndependentProviderProcessCapability(
  input: Readonly<{
    boundary: RetainedCommandBoundary;
    operation: BoundSemanticOperation;
  }>
): IndependentProviderProcessCapability {
  const operation = input.operation;
  assertSemanticOperationProjection(operation);
  assertRetainedCommandBoundaryCurrent(input.boundary);
  const requirement = operation.plan.execution.requirements.find(({ effectKinds }) => (
    effectKinds.includes('provider') && effectKinds.includes('process')
  ));
  const binding = requirement === undefined ? undefined : operation.bindings.find(
    ({ requirementId }) => requirementId === requirement.id
  );
  if (requirement === undefined || binding === undefined) {
    throw new Error('Independent provider process requires bound process and provider Effects.');
  }
  const executable = input.boundary.executable.digest();
  const auxiliaryInputs = retainedCommandBoundaryAuxiliaryInputs(input.boundary).map(
    ({ capability, kind }) => ({
      kind,
      childPath: capability.childPath,
      ...(kind === 'ordinary-file' && 'digest' in capability ? {
        path: capability.path,
        parent: capability.parent,
        physical: capability.physical,
        ...capability.digest()
      } : {})
    })
  );
  const providerPhysicalIdentityDigest = sha256({
    domain: 'sec.independent-provider-process.retained-boundary',
    executable: {
      path: input.boundary.executable.path,
      physical: input.boundary.executable.physical,
      ...executable
    },
    workingDirectory: {
      childPath: input.boundary.workingDirectory.childPath
    },
    auxiliaryInputs
  }) as OperationDigest;
  const capability: IndependentProviderProcessCapability = Object.freeze({
    providerPhysicalIdentityDigest
  });
  ISSUED_INDEPENDENT_PROVIDER_PROCESS_CAPABILITIES.set(capability, Object.freeze({
    boundary: input.boundary,
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    providerPhysicalIdentityDigest
  }));
  return capability;
}

export function assertIndependentProviderProcessCapabilityForSession(
  capability: IndependentProviderProcessCapability,
  expected: Readonly<{
    operationIdentityDigest: OperationDigest;
    boundAttemptDigest: OperationDigest;
    boundary: RetainedCommandBoundary;
  }>
): void {
  assertIndependentProviderProcessCapability(capability);
  const record = ISSUED_INDEPENDENT_PROVIDER_PROCESS_CAPABILITIES.get(capability)!;
  if (record.operationIdentityDigest !== expected.operationIdentityDigest) {
    throw new Error('Independent provider process capability operation transplant was rejected.');
  }
  if (record.boundAttemptDigest !== expected.boundAttemptDigest) {
    throw new Error('Independent provider process capability attempt transplant was rejected.');
  }
  if (record.boundary !== expected.boundary) {
    throw new Error('Independent provider process capability retained provider transplant was rejected.');
  }
  assertRetainedCommandBoundaryCurrent(record.boundary);
}

export function assertIndependentProviderProcessCapability(
  value: unknown
): asserts value is IndependentProviderProcessCapability {
  if (value === null || typeof value !== 'object'
      || !ISSUED_INDEPENDENT_PROVIDER_PROCESS_CAPABILITIES.has(value)) {
    throw new Error('Independent provider process capability was not issued by its owner.');
  }
}
