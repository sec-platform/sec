import { deepFreeze } from '../../../../contracts/canonical.ts';
import {
  WorkspaceTransitionContractError,
  type GitObjectId,
  type GitObjectIdLength,
  type ParseWorkspaceTransitionTriggerInput,
  type WorkspaceTransitionFailureCode,
  type WorkspaceTransitionTrigger
} from './contract.ts';

export const WORKSPACE_TRANSITION_REWRITE_MAXIMUM_BYTES = 1024 * 1024;
export const WORKSPACE_TRANSITION_REWRITE_MAXIMUM_RECORDS = 10_000;

function fail(code: WorkspaceTransitionFailureCode, message: string): never {
  throw new WorkspaceTransitionContractError(code, message);
}

function parseObjectId(value: string, length: GitObjectIdLength, allowNull: boolean): GitObjectId | null {
  const pattern = length === 40 ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
  if (!pattern.test(value)) {
    fail('workspace-transition-object-id-invalid', 'Workspace transition Git object id is invalid.');
  }
  if (/^0+$/u.test(value)) {
    if (allowNull) return null;
    fail('workspace-transition-object-id-invalid', 'Workspace transition current object id cannot be null.');
  }
  return value;
}

function requireNoStandardInput(input: ParseWorkspaceTransitionTriggerInput): void {
  if (input.standardInput !== undefined && input.standardInput.byteLength !== 0) {
    fail('workspace-transition-argument-invalid', 'Workspace transition event does not accept standard input.');
  }
}

function parseRewriteRecords(
  bytes: Uint8Array,
  objectIdLength: GitObjectIdLength
): readonly Readonly<{ readonly oldHead: GitObjectId; readonly newHead: GitObjectId }>[] {
  if (bytes.byteLength === 0) {
    fail('workspace-transition-rewrite-input-invalid', 'Workspace rewrite input must contain at least one record.');
  }
  if (bytes.byteLength > WORKSPACE_TRANSITION_REWRITE_MAXIMUM_BYTES) {
    fail('workspace-transition-rewrite-input-limit-exceeded', 'Workspace rewrite input exceeds its byte budget.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('workspace-transition-rewrite-input-invalid', 'Workspace rewrite input is not exact UTF-8.');
  }
  if (text.includes('\r') || !text.endsWith('\n')) {
    fail('workspace-transition-rewrite-input-invalid', 'Workspace rewrite records must be LF-terminated.');
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > WORKSPACE_TRANSITION_REWRITE_MAXIMUM_RECORDS) {
    fail('workspace-transition-rewrite-input-limit-exceeded', 'Workspace rewrite input exceeds its record budget.');
  }
  return Object.freeze(lines.map((line) => {
    const fields = line.split(' ');
    if (fields.length > 2) {
      fail('workspace-transition-rewrite-extra-unsupported', 'Workspace rewrite extra information is unsupported.');
    }
    if (fields.length !== 2 || fields.some((field) => field.length === 0)) {
      fail('workspace-transition-rewrite-input-invalid', 'Workspace rewrite record is malformed.');
    }
    return deepFreeze({
      oldHead: parseObjectId(fields[0]!, objectIdLength, false) as GitObjectId,
      newHead: parseObjectId(fields[1]!, objectIdLength, false) as GitObjectId
    });
  }));
}

/** Event admission is shared by pure decoding and the resource-owning entry. */
export function assertWorkspaceTransitionEvent(
  event: unknown
): asserts event is WorkspaceTransitionTrigger['event'] {
  if (event !== 'post-checkout' && event !== 'post-merge' && event !== 'post-rewrite') {
    fail('workspace-transition-argument-invalid', 'Workspace transition event is unsupported.');
  }
}

/** Parses only Git's transport facts. It does not authorize materialization. */
export function parseWorkspaceTransitionTrigger(
  input: ParseWorkspaceTransitionTriggerInput
): WorkspaceTransitionTrigger {
  assertWorkspaceTransitionEvent(input.event);
  if (input.objectIdLength !== 40 && input.objectIdLength !== 64) {
    fail('workspace-transition-object-id-invalid', 'Workspace transition object format is unsupported.');
  }
  const currentHead = parseObjectId(input.currentHead, input.objectIdLength, false) as GitObjectId;
  if (input.event === 'post-checkout') {
    requireNoStandardInput(input);
    if (input.arguments.length !== 3 || !['0', '1'].includes(input.arguments[2]!)) {
      fail('workspace-transition-argument-invalid', 'Post-checkout arguments are not canonical.');
    }
    const previousHead = parseObjectId(input.arguments[0]!, input.objectIdLength, true);
    const newHead = parseObjectId(input.arguments[1]!, input.objectIdLength, false) as GitObjectId;
    if (newHead !== currentHead) {
      fail('workspace-transition-current-head-mismatch', 'Post-checkout new head differs from the observed current head.');
    }
    return deepFreeze({
      event: 'post-checkout', previousHead, newHead,
      checkoutKind: input.arguments[2] === '1' ? 'branch' : 'paths'
    });
  }
  if (input.event === 'post-merge') {
    requireNoStandardInput(input);
    if (input.arguments.length !== 1 || !['0', '1'].includes(input.arguments[0]!)) {
      fail('workspace-transition-argument-invalid', 'Post-merge arguments are not canonical.');
    }
    return deepFreeze({ event: 'post-merge', currentHead, squash: input.arguments[0] === '1' });
  }
  if (input.arguments.length !== 1 || !['amend', 'rebase'].includes(input.arguments[0]!)) {
    fail('workspace-transition-argument-invalid', 'Post-rewrite arguments are not canonical.');
  }
  return deepFreeze({
    event: 'post-rewrite',
    currentHead,
    command: input.arguments[0] as 'amend' | 'rebase',
    records: parseRewriteRecords(input.standardInput ?? new Uint8Array(), input.objectIdLength)
  });
}
