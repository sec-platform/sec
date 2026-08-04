import { uniqueSorted } from './collections.ts';
import { isSafeRelativePath, posixPath } from './paths.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport
} from './verification-types.ts';

export interface AcceptanceProofBindingV1 {
  readonly testPath: string;
  readonly acceptanceIds: readonly string[];
}

function binding(
  testPath: string,
  acceptanceIds: readonly string[]
): AcceptanceProofBindingV1 {
  return Object.freeze({
    testPath,
    acceptanceIds: Object.freeze(uniqueSorted([...acceptanceIds]))
  });
}

/** Unique machine owner for the current physical test-file → semantic acceptance-ID relation. */
export const ACCEPTANCE_PROOF_BINDINGS_V1 = Object.freeze([
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
  binding('tests/runtime/acceptance/customer-flow.spec.ts', [
    'audit_entry_can_be_created',
    'customer_can_upload_attachment',
    'customer_creation_sends_email_notification',
    'customer_list_can_be_filtered',
    'tenant_only_sees_own_customers',
    'user_can_access_authorized_route',
    'user_can_create_customer',
    'user_can_list_customers',
    'user_can_login'
  ]),
  binding('tests/runtime/acceptance/ticket-flow.spec.ts', [
    'assignee_can_filter_tickets',
    'audit_entry_can_be_created',
    'tenant_only_sees_own_tickets',
    'ticket_attachment_can_be_uploaded',
    'ticket_can_be_created',
    'ticket_comment_can_be_added',
    'ticket_status_can_transition',
    'ticket_summary_can_be_reported',
    'user_can_login',
    'worklog_can_be_recorded'
  ])
] as const);

function canonicalTestPath(value: string): string {
  const normalized = posixPath(value);
  if (
    normalized !== value
    || !isSafeRelativePath(value)
    || !value.startsWith('tests/')
    || !/\.(test|spec)\.tsx?$/u.test(value)
  ) {
    throw new Error(`Acceptance proof path is not canonical: ${value}`);
  }
  return value;
}

function assertBindings(bindings: readonly AcceptanceProofBindingV1[]): void {
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
      || JSON.stringify([...entry.acceptanceIds].sort()) !== JSON.stringify(entry.acceptanceIds)
    ) {
      throw new Error(`Acceptance proof IDs are invalid for ${entry.testPath}`);
    }
  }
}

assertBindings(ACCEPTANCE_PROOF_BINDINGS_V1);

export function acceptanceExecutedTestPathsV1(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport
): string[] {
  const fastPaths = fast.acceptance.passed.map((file) =>
    file.startsWith('tests/') ? file : `tests/acceptance/${file}`
  );
  return uniqueSorted([...fastPaths, ...runtime.acceptance.passed].map(canonicalTestPath));
}

export function acceptanceIdsProvenByExecutedTestsV1(
  executedTestPaths: readonly string[],
  enabledAcceptanceIds: readonly string[],
  bindings: readonly AcceptanceProofBindingV1[] = ACCEPTANCE_PROOF_BINDINGS_V1
): string[] {
  assertBindings(bindings);
  const canonicalExecuted = uniqueSorted(executedTestPaths.map(canonicalTestPath));
  const enabled = new Set(enabledAcceptanceIds);
  const byPath = new Map(bindings.map((entry) => [entry.testPath, entry.acceptanceIds]));
  return uniqueSorted(canonicalExecuted.flatMap((testPath) =>
    byPath.get(testPath)?.filter((acceptanceId) => enabled.has(acceptanceId)) ?? []
  ));
}

export function acceptanceIdsProvenByVerificationReportsV1(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  enabledAcceptanceIds: readonly string[],
  bindings: readonly AcceptanceProofBindingV1[] = ACCEPTANCE_PROOF_BINDINGS_V1
): string[] {
  return acceptanceIdsProvenByExecutedTestsV1(
    acceptanceExecutedTestPathsV1(fast, runtime),
    enabledAcceptanceIds,
    bindings
  );
}
