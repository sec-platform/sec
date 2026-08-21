import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const TEST_RESPONSIBILITY_LAYERS = [
  'unit',
  'property',
  'contract',
  'integration',
  'physical',
  'recovery',
  'mutation'
] as const;

export type TestResponsibilityLayer = (typeof TEST_RESPONSIBILITY_LAYERS)[number];

export const TEST_RESPONSIBILITY_ROLES = [
  'primary',
  'supporting',
  'calibration',
  'diagnostic'
] as const;

export type TestResponsibilityRole = (typeof TEST_RESPONSIBILITY_ROLES)[number];

export const TEST_RESPONSIBILITY_LIFECYCLES = [
  'active',
  'retiring',
  'diagnostic'
] as const;

export type TestResponsibilityLifecycle = (typeof TEST_RESPONSIBILITY_LIFECYCLES)[number];

export const TEST_PROOF_OBLIGATION_KINDS = [
  'architecture-owner',
  'contract',
  'verification-requirement',
  'regression-obligation',
  'verifier-calibration'
] as const;

export type TestProofObligationKind = (typeof TEST_PROOF_OBLIGATION_KINDS)[number];

export const TEST_PROOF_INDEPENDENCE_DIMENSIONS = [
  'oracle',
  'environment',
  'failure-class',
  'state-boundary',
  'platform',
  'provider'
] as const;

export type TestProofIndependenceDimension =
  (typeof TEST_PROOF_INDEPENDENCE_DIMENSIONS)[number];

export type TestProofObligation = Readonly<{
  kind: TestProofObligationKind;
  id: string;
  owner: string;
  /** Stable machine reason code; human prose remains an owner projection. */
  failureMeaningCode: string;
}>;

export type TestProofIndependence = Readonly<{
  dimension: TestProofIndependenceDimension;
  witnessRef: string;
}>;

export type TestRetirementCondition =
  | Readonly<{ kind: 'persistent-invariant' }>
  | Readonly<{ kind: 'owner-retirement'; owner: string }>
  | Readonly<{
      /** This is the only canonical supersedence relation. */
      kind: 'replacement-proof';
      replacementTestIds: readonly string[];
      coverageRef: string;
    }>
  | Readonly<{ kind: 'diagnostic-completion'; workRef: string }>;

export type TestResponsibilityDeclaration = Readonly<{
  /** Stable logical identity. Test titles and source paths are locators, not identity. */
  testId: string;
  sourcePath: string;
  owner: string;
  layer: TestResponsibilityLayer;
  role: TestResponsibilityRole;
  lifecycle: TestResponsibilityLifecycle;
  obligations: readonly TestProofObligation[];
  regressionRefs?: readonly string[];
  independence?: readonly TestProofIndependence[];
  retirementCondition: TestRetirementCondition;
}>;

const MACHINE_ID = /^[a-z0-9][a-z0-9._:-]*$/u;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireMachineId(value: string, field: string): void {
  if (value.length === 0 || value.length > 160 || !MACHINE_ID.test(value)) {
    throw new Error(`${field} must be a bounded stable machine id`);
  }
}

function requireReference(value: string, field: string): void {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty bounded exact reference`);
  }
}

function uniqueValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} contains duplicate values`);
  }
}

function normalizeObligation(obligation: TestProofObligation): TestProofObligation {
  requireMachineId(obligation.id, 'obligation.id');
  requireMachineId(obligation.owner, 'obligation.owner');
  requireMachineId(obligation.failureMeaningCode, 'obligation.failureMeaningCode');
  if (!TEST_PROOF_OBLIGATION_KINDS.includes(obligation.kind)) {
    throw new Error(`unknown proof obligation kind: ${String(obligation.kind)}`);
  }
  return Object.freeze({ ...obligation });
}

function normalizeRetirementCondition(
  declaration: TestResponsibilityDeclaration,
  allTestIds: ReadonlySet<string>
): TestRetirementCondition {
  const condition = declaration.retirementCondition;
  switch (condition.kind) {
    case 'persistent-invariant':
      return Object.freeze({ kind: 'persistent-invariant' });
    case 'owner-retirement':
      requireMachineId(condition.owner, 'retirementCondition.owner');
      return Object.freeze({ ...condition });
    case 'replacement-proof': {
      requireReference(condition.coverageRef, 'retirementCondition.coverageRef');
      if (condition.replacementTestIds.length === 0) {
        throw new Error('replacement-proof requires at least one replacement test');
      }
      uniqueValues(condition.replacementTestIds, 'retirementCondition.replacementTestIds');
      for (const replacementTestId of condition.replacementTestIds) {
        requireMachineId(replacementTestId, 'retirementCondition.replacementTestId');
        if (replacementTestId === declaration.testId) {
          throw new Error(`${declaration.testId} cannot replace itself`);
        }
        if (!allTestIds.has(replacementTestId)) {
          throw new Error(`unknown replacement test: ${replacementTestId}`);
        }
      }
      return Object.freeze({
        kind: 'replacement-proof',
        replacementTestIds: Object.freeze([...condition.replacementTestIds].sort(compareText)),
        coverageRef: condition.coverageRef
      });
    }
    case 'diagnostic-completion':
      requireReference(condition.workRef, 'retirementCondition.workRef');
      return Object.freeze({ ...condition });
  }
}

function assertNoReplacementCycles(
  declarations: readonly TestResponsibilityDeclaration[]
): void {
  const edges = new Map<string, readonly string[]>();
  for (const declaration of declarations) {
    edges.set(
      declaration.testId,
      declaration.retirementCondition.kind === 'replacement-proof'
        ? declaration.retirementCondition.replacementTestIds
        : []
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (testId: string): void => {
    if (visited.has(testId)) return;
    if (visiting.has(testId)) {
      throw new Error(`test replacement cycle contains ${testId}`);
    }
    visiting.add(testId);
    for (const target of edges.get(testId) ?? []) visit(target);
    visiting.delete(testId);
    visited.add(testId);
  };

  for (const testId of edges.keys()) visit(testId);
}

/**
 * Validates and canonicalizes only proof-responsibility declarations.
 * It does not select tests, execute Verification, or authorize retirement.
 */
export function normalizeTestResponsibilityDeclarations(
  declarations: readonly TestResponsibilityDeclaration[]
): readonly TestResponsibilityDeclaration[] {
  const testIds = declarations.map((declaration) => declaration.testId);
  for (const testId of testIds) requireMachineId(testId, 'testId');
  uniqueValues(testIds, 'testId');
  const allTestIds = new Set(testIds);

  const normalized = declarations.map((declaration) => {
    if (!CodexDevelopmentIsCanonicalRepositoryPathV1(declaration.sourcePath)) {
      throw new Error(`${declaration.testId} sourcePath is not canonical repository-relative POSIX`);
    }
    requireMachineId(declaration.owner, `${declaration.testId}.owner`);
    if (!TEST_RESPONSIBILITY_LAYERS.includes(declaration.layer)) {
      throw new Error(`unknown test responsibility layer: ${String(declaration.layer)}`);
    }
    if (!TEST_RESPONSIBILITY_ROLES.includes(declaration.role)) {
      throw new Error(`unknown test responsibility role: ${String(declaration.role)}`);
    }
    if (!TEST_RESPONSIBILITY_LIFECYCLES.includes(declaration.lifecycle)) {
      throw new Error(`unknown test responsibility lifecycle: ${String(declaration.lifecycle)}`);
    }
    if (declaration.obligations.length === 0) {
      throw new Error(`${declaration.testId} must bind at least one proof obligation`);
    }

    const obligations = declaration.obligations.map(normalizeObligation);
    const obligationKeys = obligations.map((obligation) => `${obligation.kind}:${obligation.id}`);
    uniqueValues(obligationKeys, `${declaration.testId}.obligations`);

    const regressionRefs = [...(declaration.regressionRefs ?? [])];
    for (const reference of regressionRefs) requireReference(reference, 'regressionRef');
    uniqueValues(regressionRefs, `${declaration.testId}.regressionRefs`);

    const independence = [...(declaration.independence ?? [])].map((entry) => {
      if (!TEST_PROOF_INDEPENDENCE_DIMENSIONS.includes(entry.dimension)) {
        throw new Error(`unknown proof independence dimension: ${String(entry.dimension)}`);
      }
      requireReference(entry.witnessRef, 'independence.witnessRef');
      return Object.freeze({ ...entry });
    });
    uniqueValues(
      independence.map((entry) => `${entry.dimension}:${entry.witnessRef}`),
      `${declaration.testId}.independence`
    );

    const diagnostic = declaration.role === 'diagnostic' || declaration.lifecycle === 'diagnostic';
    if (diagnostic && !(declaration.role === 'diagnostic' && declaration.lifecycle === 'diagnostic')) {
      throw new Error(`${declaration.testId} diagnostic role and lifecycle must agree`);
    }
    if (diagnostic && declaration.retirementCondition.kind !== 'diagnostic-completion') {
      throw new Error(`${declaration.testId} diagnostic proof requires diagnostic-completion retirement`);
    }
    if (!diagnostic && declaration.retirementCondition.kind === 'diagnostic-completion') {
      throw new Error(`${declaration.testId} non-diagnostic proof cannot use diagnostic-completion retirement`);
    }
    if (declaration.lifecycle === 'retiring'
      && declaration.retirementCondition.kind !== 'replacement-proof'
      && declaration.retirementCondition.kind !== 'owner-retirement') {
      throw new Error(`${declaration.testId} retiring proof requires replacement-proof or owner-retirement`);
    }
    if (declaration.lifecycle !== 'retiring'
      && declaration.retirementCondition.kind === 'replacement-proof') {
      throw new Error(`${declaration.testId} replacement-proof requires retiring lifecycle`);
    }

    const retirementCondition = normalizeRetirementCondition(declaration, allTestIds);

    return Object.freeze({
      testId: declaration.testId,
      sourcePath: declaration.sourcePath,
      owner: declaration.owner,
      layer: declaration.layer,
      role: declaration.role,
      lifecycle: declaration.lifecycle,
      obligations: Object.freeze([...obligations].sort((left, right) => (
        compareText(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`)
      ))),
      regressionRefs: regressionRefs.length > 0
        ? Object.freeze(regressionRefs.sort(compareText))
        : undefined,
      independence: independence.length > 0
        ? Object.freeze(independence.sort((left, right) => (
            compareText(`${left.dimension}:${left.witnessRef}`, `${right.dimension}:${right.witnessRef}`)
          )))
        : undefined,
      retirementCondition
    } satisfies TestResponsibilityDeclaration);
  });

  assertNoReplacementCycles(normalized);
  return Object.freeze([...normalized].sort((left, right) => compareText(left.testId, right.testId)));
}
