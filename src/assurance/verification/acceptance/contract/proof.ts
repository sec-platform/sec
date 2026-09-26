import { canonicalEquals, uniqueSorted } from '../../../../contracts/canonical.ts';
import { assertCanonicalPortableLogicalPath } from '../../../../contracts/logical-path.ts';
import { isRepositoryTestModulePath } from '../../../../contracts/repository-test-path.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../contract/types.ts';

export interface AcceptanceProofBinding {
  readonly testPath: string;
  readonly acceptanceIds: readonly string[];
}

function binding(
  testPath: string,
  acceptanceIds: readonly string[]
): AcceptanceProofBinding {
  return Object.freeze({
    testPath,
    acceptanceIds: Object.freeze(uniqueSorted([...acceptanceIds]))
  });
}

/** Unique machine owner for the current physical test-file → semantic acceptance-ID relation. */
const ACCEPTANCE_PROOF_BINDINGS = Object.freeze([
  binding('tests/acceptance/customer-flow.test.ts', [
    'tenant_only_sees_own_customers',
    'user_can_create_customer',
    'user_can_list_customers'
  ]),
  binding('tests/acceptance/ticket-flow.test.ts', [
    'assignee_can_filter_tickets',
    'tenant_only_sees_own_tickets',
    'ticket_attachment_can_be_uploaded',
    'ticket_can_be_created',
    'ticket_comment_can_be_added',
    'ticket_status_can_transition'
  ]),
  binding('tests/acceptance/agent-classifier-flow.test.ts', [
    'agent_can_be_registered',
    'agent_can_automatically_classify_ticket'
  ]),
  binding('tests/acceptance/auth-flow.test.ts', [
    'user_can_login'
  ]),
  binding('tests/acceptance/customer-attachments-flow.test.ts', [
    'customer_can_upload_attachment'
  ])
] as const);

function canonicalTestPath(value: string): string {
  assertCanonicalPortableLogicalPath(value, 'Acceptance proof path');
  if (!value.startsWith('tests/acceptance/') || !isRepositoryTestModulePath(value)) {
    throw new Error(`Acceptance proof path is outside the canonical test domain: ${value}`);
  }
  return value;
}

function assertBindings(bindings: readonly AcceptanceProofBinding[]): void {
  const testPaths = new Set<string>();
  for (const entry of bindings) {
    canonicalTestPath(entry.testPath);
    if (testPaths.has(entry.testPath)) {
      throw new Error(`Duplicate acceptance proof test path: ${entry.testPath}`);
    }
    testPaths.add(entry.testPath);
    if (
      entry.acceptanceIds.length === 0
      || entry.acceptanceIds.some((id) => id.trim().length === 0)
      || new Set(entry.acceptanceIds).size !== entry.acceptanceIds.length
      || !canonicalEquals([...entry.acceptanceIds].sort(), entry.acceptanceIds)
    ) {
      throw new Error(`Acceptance proof IDs are invalid for ${entry.testPath}`);
    }
  }
}

assertBindings(ACCEPTANCE_PROOF_BINDINGS);

function acceptanceExecutedTestPaths(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): string[] {
  const fastPaths = fast.acceptance.passed.map((file) =>
    file.startsWith('tests/') ? file : `tests/acceptance/${file}`
  );
  return uniqueSorted([...fastPaths, ...runtime.acceptance.passed].map(canonicalTestPath));
}

function acceptanceIdsProvenByExecutedTests(
  executedTestPaths: readonly string[],
  enabledAcceptanceIds: readonly string[],
  bindings: readonly AcceptanceProofBinding[] = ACCEPTANCE_PROOF_BINDINGS
): string[] {
  assertBindings(bindings);
  const canonicalExecuted = uniqueSorted(executedTestPaths.map(canonicalTestPath));
  const enabled = new Set(enabledAcceptanceIds);
  const byPath = new Map(bindings.map((entry) => [entry.testPath, entry.acceptanceIds]));
  return uniqueSorted(canonicalExecuted.flatMap((testPath) =>
    byPath.get(testPath)?.filter((acceptanceId) => enabled.has(acceptanceId)) ?? []
  ));
}

export function acceptanceIdsProvenByVerificationReports(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  enabledAcceptanceIds: readonly string[],
  bindings: readonly AcceptanceProofBinding[] = ACCEPTANCE_PROOF_BINDINGS
): string[] {
  return acceptanceIdsProvenByExecutedTests(
    acceptanceExecutedTestPaths(fast, runtime),
    enabledAcceptanceIds,
    bindings
  );
}
