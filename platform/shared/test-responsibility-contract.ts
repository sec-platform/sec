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
  /** Failure meaning for this test-to-obligation proof edge, not a global obligation label. */
  failureMeaningCode: string;
}>;

export type TestProofIndependence = Readonly<{
  dimension: TestProofIndependenceDimension;
  witnessRef: string;
}>;

/**
 * Current physical locator for one executable test case. It is deliberately not
 * semantic identity: a file move, suite rename or title rewrite updates this locator
 * while stable testId remains unchanged.
 */
export type TestCaseLocator = Readonly<{
  suitePath: readonly string[];
  title: string;
}>;

export type TestRetirementCondition =
  | Readonly<{ kind: 'persistent-invariant' }>
  | Readonly<{ kind: 'owner-retirement'; owner: string }>
  | Readonly<{
      /** This is the only canonical supersedence relation. */
      kind: 'replacement-proof';
      replacementTestIds: readonly string[];
      /** Reference only: this pure normalizer does not validate the replacement Evidence itself. */
      coverageRef: string;
    }>
  | Readonly<{ kind: 'diagnostic-completion'; workRef: string }>;

/**
 * Stable proof semantics authored beside the executable case. Physical source/suite/title
 * locators are excluded so source is the only writer of those facts and a census can derive
 * them from the current tree.
 */
export type TestResponsibilityMetadata = Readonly<{
  testId: string;
  owner: string;
  layer: TestResponsibilityLayer;
  role: TestResponsibilityRole;
  lifecycle: TestResponsibilityLifecycle;
  obligations: readonly TestProofObligation[];
  regressionRefs?: readonly string[];
  /**
   * Omission means unobserved/unresolved, never "no independent dimension". A retirement
   * or dedup consumer must not turn undefined into authority to remove a proof.
   */
  independence?: readonly TestProofIndependence[];
  retirementCondition: TestRetirementCondition;
}>;

export type TestResponsibilityDeclaration = TestResponsibilityMetadata & Readonly<{
  /** Current test source locator; never semantic identity. */
  sourcePath: string;
  /** Exact current executable case locator inside sourcePath. */
  case: TestCaseLocator;
}>;

const MACHINE_ID = /^[a-z0-9][a-z0-9._:-]*$/u;
const TEST_SOURCE_PATH = /^tests\/.+\.(?:test|spec)\.[cm]?[jt]sx?$/u;

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

function requireLocatorText(value: string, field: string, maxLength: number): void {
  if (value.length === 0 || value.length > maxLength || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty bounded exact locator string`);
  }
}

function uniqueValues(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${field} contains duplicate values`);
  }
}

function obligationIdentity(obligation: TestProofObligation): string {
  return `${obligation.kind}:${obligation.owner}:${obligation.id}`;
}

export function testCaseLocatorIdentity(
  sourcePath: string,
  locator: TestCaseLocator
): string {
  return [sourcePath, ...locator.suitePath, locator.title].join('\u0000');
}

function normalizeCaseLocator(locator: TestCaseLocator, testId: string): TestCaseLocator {
  requireLocatorText(locator.title, `${testId}.case.title`, 1024);
  const suitePath = locator.suitePath.map((segment, index) => {
    requireLocatorText(segment, `${testId}.case.suitePath[${index}]`, 512);
    return segment;
  });
  return Object.freeze({ suitePath: Object.freeze(suitePath), title: locator.title });
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

function assertReplacementProofsClose(
  declarations: readonly TestResponsibilityDeclaration[]
): void {
  const byId = new Map(declarations.map((declaration) => [declaration.testId, declaration] as const));

  for (const declaration of declarations) {
    const condition = declaration.retirementCondition;
    if (condition.kind !== 'replacement-proof') continue;

    const replacements = condition.replacementTestIds.map((testId) => {
      const replacement = byId.get(testId);
      if (!replacement) throw new Error(`unknown replacement test: ${testId}`);
      if (replacement.lifecycle !== 'active') {
        throw new Error(`${declaration.testId} replacement ${testId} must be active`);
      }
      return replacement;
    });

    const replacementObligations = new Set(replacements.flatMap((replacement) => (
      replacement.obligations.map(obligationIdentity)
    )));

    const missing = declaration.obligations
      .map(obligationIdentity)
      .filter((identity) => !replacementObligations.has(identity))
      .sort(compareText);
    if (missing.length > 0) {
      throw new Error(
        `${declaration.testId} replacement proof does not cover obligations: ${missing.join(', ')}`
      );
    }
  }
}

/**
 * Validates and canonicalizes proof-responsibility declarations only.
 * It does not select tests, discover runtime cases, execute Verification, validate
 * coverageRef Evidence, or authorize retirement.
 */
export function normalizeTestResponsibilityDeclarations(
  declarations: readonly TestResponsibilityDeclaration[]
): readonly TestResponsibilityDeclaration[] {
  const testIds = declarations.map((declaration) => declaration.testId);
  for (const testId of testIds) requireMachineId(testId, 'testId');
  uniqueValues(testIds, 'testId');
  const allTestIds = new Set(testIds);

  const normalized = declarations.map((declaration) => {
    if (!CodexDevelopmentIsCanonicalRepositoryPathV1(declaration.sourcePath)
      || !TEST_SOURCE_PATH.test(declaration.sourcePath)) {
      throw new Error(`${declaration.testId} sourcePath must be a canonical executable test path`);
    }
    const testCase = normalizeCaseLocator(declaration.case, declaration.testId);
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
    const obligationKeys = obligations.map(obligationIdentity);
    uniqueValues(obligationKeys, `${declaration.testId}.obligations`);
    if (declaration.role === 'calibration'
      && obligations.some((obligation) => obligation.kind !== 'verifier-calibration')) {
      throw new Error(`${declaration.testId} calibration proof may only own verifier-calibration obligations`);
    }
    if (declaration.role !== 'calibration'
      && declaration.role !== 'diagnostic'
      && obligations.some((obligation) => obligation.kind === 'verifier-calibration')) {
      throw new Error(`${declaration.testId} verifier-calibration obligation requires calibration role`);
    }
    if (declaration.layer === 'mutation'
      && declaration.role !== 'calibration'
      && declaration.role !== 'diagnostic') {
      throw new Error(`${declaration.testId} mutation layer is calibration/diagnostic evidence, not primary proof`);
    }

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
    if (retirementCondition.kind === 'owner-retirement'
      && obligations.some((obligation) => obligation.owner !== retirementCondition.owner)) {
      throw new Error(`${declaration.testId} owner-retirement must cover every obligation owner`);
    }

    return Object.freeze({
      testId: declaration.testId,
      sourcePath: declaration.sourcePath,
      case: testCase,
      owner: declaration.owner,
      layer: declaration.layer,
      role: declaration.role,
      lifecycle: declaration.lifecycle,
      obligations: Object.freeze([...obligations].sort((left, right) => (
        compareText(obligationIdentity(left), obligationIdentity(right))
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

  const locatorKeys = normalized.map((declaration) => (
    testCaseLocatorIdentity(declaration.sourcePath, declaration.case)
  ));
  uniqueValues(locatorKeys, 'test case locator');
  assertReplacementProofsClose(normalized);
  return Object.freeze([...normalized].sort((left, right) => compareText(left.testId, right.testId)));
}
