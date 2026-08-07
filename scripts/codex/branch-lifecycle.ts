#!/usr/bin/env bun
/**
 * SEC deterministic branch/ref lifecycle owner (Issue #269/#313).
 *
 * Read-only audit inventories local/remote refs, every worktree, all PR states,
 * the active Work Package resolver, external settings and post-enforcement
 * published closeout receipts. Destructive closeout is two-phase and delegates
 * durable recovery, exact-SHA CAS and typed readback to focused modules.
 * This entrypoint never resets, stashes, cleans or removes user worktrees.
 */
import { parseBranchCloseoutReceipt } from './branch-closeout-contract.ts';
import {
  publishAndReadBackBranchCloseoutReceipt
} from './branch-closeout-receipt.ts';
import {
  finalizeBranchCloseout,
  finalizeMergedPullRequestCloseout as finalizeMergedPullRequestCloseoutCore,
  loadPreparedBranchCloseoutEnvelope,
  preparationFilePath,
  prepareBranchCloseout,
  receiptFilePath,
  type PreparedBranchCloseoutEnvelope
} from './branch-closeout.ts';
import {
  defaultBranchLifecycleCommandRunner,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import { configureBranchLifecycleClone } from './branch-lifecycle-config.ts';
import {
  auditBranchLifecycle,
  type BranchCloseoutDisposition,
  type BranchCloseoutPublicationResult,
  type BranchCloseoutReceipt,
  type BranchLifecycleInventory
} from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';

export * from './branch-closeout-receipt.ts';
export * from './branch-closeout.ts';
export { branchLifecycleDigest } from './branch-lifecycle-audit.ts';
export * from './branch-lifecycle-command.ts';
export * from './branch-lifecycle-config.ts';
export * from './branch-lifecycle-health.ts';
export * from './branch-lifecycle-inventory.ts';
export * from './branch-lifecycle-parsers.ts';
export {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
  type BranchCloseoutReceipt,
  type BranchCloseoutReceiptObservation,
  type BranchLifecycleInventory,
  type BranchPublishedCloseoutReceiptV1,
  type BranchPullRequestObservation
} from './branch-lifecycle-types.ts';
export * from './branch-recovery.ts';

export function validateBranchCloseoutReceiptForPublication(
  receipt: BranchCloseoutReceipt
): BranchCloseoutReceipt {
  return parseBranchCloseoutReceipt(JSON.stringify(receipt));
}

function publishReceiptOrThrow(
  ctx: BranchLifecycleContext,
  receipt: BranchCloseoutReceipt
): BranchCloseoutPublicationResult {
  const validatedReceipt = validateBranchCloseoutReceiptForPublication(receipt);
  const publication = publishAndReadBackBranchCloseoutReceipt(ctx, validatedReceipt);
  if (publication.publish !== 'success' || publication.readback !== 'success') {
    throw new Error(`Branch closeout receipt publication failed: ${publication.detail}`);
  }
  return publication;
}

/**
 * The merge bootstrap imports this explicit wrapper from branch-lifecycle.ts.
 * Physical ref closeout is not a successful terminal until the durable receipt
 * is published to the bound PR/Issue and read back byte-exactly.
 */
export function finalizeMergedPullRequestCloseout(
  ctx: BranchLifecycleContext,
  prepared: PreparedBranchCloseoutEnvelope,
  newMainSha: string,
  blockingReasons: readonly string[] = []
): BranchCloseoutReceipt {
  const receipt = finalizeMergedPullRequestCloseoutCore(
    ctx,
    prepared,
    newMainSha,
    blockingReasons
  );
  publishReceiptOrThrow(ctx, receipt);
  return receipt;
}

function formatAuditText(inventory: BranchLifecycleInventory): string {
  const report = auditBranchLifecycle(inventory);
  const lines: string[] = [
    'Branch/Ref Lifecycle Audit',
    `  repository: ${inventory.repository.fullName}`,
    `  default: ${inventory.repository.defaultBranch}@${inventory.main.remoteSha ?? '<unknown>'}`,
    `  status: ${report.status}`,
    `  remote heads: ${inventory.remoteBranches.length}`,
    `  local branches: ${inventory.localBranches.length}`,
    `  worktrees: ${inventory.worktrees.length}`,
    `  pull requests observed: ${inventory.pullRequests.length}`,
    `  active Work Package: ${inventory.activeWorkPackage.state}`,
    ''
  ];
  for (const classification of report.classifications) {
    lines.push(
      `  ${classification.branch}: ${classification.classification}`
      + ` local=${classification.localSha ?? '-'} remote=${classification.remoteSha ?? '-'}`
    );
  }
  if (report.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const finding of report.findings) {
      lines.push(
        `  [${finding.severity}] ${finding.code}`
        + `${finding.branch ? ` (${finding.branch})` : ''}: ${finding.message}`
      );
    }
  }
  return lines.join('\n');
}

interface CliArguments {
  command: 'audit' | 'configure-clone' | 'prepare' | 'finalize';
  json: boolean;
  compact: boolean;
  branch: string | null;
  prNumber: number | null;
  preparationPath: string | null;
  disposition: BranchCloseoutDisposition | null;
  durableGoalKind: 'main' | 'issue' | 'evidence' | null;
  durableGoalReference: string | null;
  recoveryRoot: string | null;
}

function parsePositiveInteger(value: string | undefined, label: string): number {
  if (!value || !/^[1-9]\d*$/u.test(value)) {
    throw new Error(`${label} requires a positive integer.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range.`);
  return parsed;
}

function parseCliArguments(argv: readonly string[]): CliArguments {
  const command = argv[0];
  if (
    command !== 'audit'
    && command !== 'configure-clone'
    && command !== 'prepare'
    && command !== 'finalize'
  ) {
    throw new Error(USAGE);
  }
  const result: CliArguments = {
    command,
    json: false,
    compact: false,
    branch: null,
    prNumber: null,
    preparationPath: null,
    disposition: null,
    durableGoalKind: null,
    durableGoalReference: null,
    recoveryRoot: null
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') result.json = true;
    else if (arg === '--compact') result.compact = true;
    else if (arg === '--branch') {
      result.branch = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--pr') {
      result.prNumber = parsePositiveInteger(argv[index + 1], '--pr');
      index += 1;
    } else if (arg === '--preparation') {
      result.preparationPath = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--disposition') {
      const value = argv[index + 1];
      if (
        value !== 'merged'
        && value !== 'closed-superseded'
        && value !== 'completed-spike'
      ) {
        throw new Error('--disposition is invalid.');
      }
      result.disposition = value;
      index += 1;
    } else if (arg === '--durable-goal-kind') {
      const value = argv[index + 1];
      if (value !== 'main' && value !== 'issue' && value !== 'evidence') {
        throw new Error('--durable-goal-kind is invalid.');
      }
      result.durableGoalKind = value;
      index += 1;
    } else if (arg === '--durable-goal') {
      result.durableGoalReference = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--recovery-root') {
      result.recoveryRoot = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (result.compact && !result.json) throw new Error('--compact requires --json.');
  return result;
}

const USAGE = `Usage:
  bun scripts/codex/branch-lifecycle.ts audit [--json [--compact]]
  bun scripts/codex/branch-lifecycle.ts configure-clone [--json]
  bun scripts/codex/branch-lifecycle.ts prepare --branch <name> [--pr <n>] [--recovery-root <absolute-path>] [--json]
  bun scripts/codex/branch-lifecycle.ts finalize --preparation <file> --disposition <merged|closed-superseded|completed-spike> --durable-goal-kind <main|issue|evidence> --durable-goal <reference> [--json]
`;

async function main(): Promise<void> {
  const args = parseCliArguments(process.argv.slice(2));
  const ctx: BranchLifecycleContext = {
    repositoryRoot: process.cwd(),
    run: defaultBranchLifecycleCommandRunner,
    recoveryRoot: args.recoveryRoot ?? undefined
  };

  if (args.command === 'audit') {
    const inventory = collectBranchLifecycleInventory(ctx);
    const report = auditBranchLifecycle(inventory);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(
        args.compact
          ? {
              schema: inventory.schema,
              observedAt: inventory.observedAt,
              status: report.status,
              remoteHeads: inventory.remoteBranches.length,
              localBranches: inventory.localBranches.length,
              worktrees: inventory.worktrees.length,
              findings: report.findings.length
            }
          : { inventory, report },
        null,
        args.compact ? 0 : 2
      )}\n`);
    } else {
      process.stdout.write(`${formatAuditText(inventory)}\n`);
    }
    if (report.status === 'drift' || report.status === 'blocked') process.exitCode = 1;
    return;
  }

  if (args.command === 'configure-clone') {
    const observation = configureBranchLifecycleClone(ctx);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
    } else {
      process.stdout.write(
        'Configured clone-local fetch.prune, remote.origin.prune and fetch.pruneTags to true.\n'
      );
    }
    return;
  }

  if (args.command === 'prepare') {
    if (!args.branch) throw new Error(`--branch is required.\n${USAGE}`);
    const prepared = prepareBranchCloseout(ctx, {
      branch: args.branch,
      pullRequestNumber: args.prNumber
    });
    const filePath = preparationFilePath(prepared.preparation);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ preparationPath: filePath, prepared }, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Prepared ${prepared.preparation.branch}; durable recovery=${prepared.preparation.recovery.path}; preparation=${filePath}\n`
      );
    }
    return;
  }

  if (
    !args.preparationPath
    || !args.disposition
    || !args.durableGoalKind
    || !args.durableGoalReference
  ) {
    throw new Error(`finalize requires preparation, disposition and durable goal.\n${USAGE}`);
  }
  const prepared = loadPreparedBranchCloseoutEnvelope(args.preparationPath);
  const receipt = finalizeBranchCloseout(ctx, {
    prepared,
    disposition: args.disposition,
    durableGoal: {
      kind: args.durableGoalKind,
      reference: args.durableGoalReference
    }
  });
  let publication: BranchCloseoutPublicationResult;
  try {
    publication = publishReceiptOrThrow(ctx, receipt);
  } catch (error) {
    publication = {
      target: null,
      publish: 'failed',
      readback: 'failed',
      receipt: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ receipt, publication }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Branch closeout ${receipt.status}; receipt=${receiptFilePath(receipt.preparation)}; digest=${receipt.receiptDigest}; publication=${publication.publish}/${publication.readback}\n`
    );
  }
  if (
    (receipt.status !== 'completed' && receipt.status !== 'protected-pending')
    || publication.publish !== 'success'
    || publication.readback !== 'success'
  ) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
