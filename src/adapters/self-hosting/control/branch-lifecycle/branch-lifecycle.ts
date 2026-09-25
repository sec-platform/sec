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
import {
  preparationFilePath,
  prepareBranchCloseout
} from './branch-closeout.ts';
import { assertGitBranchName } from './branch-lifecycle-audit.ts';
import { configureBranchLifecycleClone } from './branch-lifecycle-config.ts';
import {
  auditBranchLifecycle,
  type BranchLifecycleInventory
} from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import { executeMergedLocalBranchResidueCloseout } from './branch-local-residue-closeout.ts';

export {


  renderPublishedBranchCloseoutReceiptComment
} from './branch-closeout-receipt.ts';
export { branchLifecycleDigest } from './branch-lifecycle-audit.ts';
export { parseRestCloseoutReceiptCommentCandidates } from './branch-lifecycle-parsers.ts';
export {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,



  type BranchPublishedCloseoutReceipt
} from './branch-lifecycle-types.ts';
;
;
;
;
;
;
;

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
  command: 'audit' | 'configure-clone' | 'prepare' | 'settle-local-merged';
  json: boolean;
  compact: boolean;
  branch: string | null;
  refState: 'present' | 'absent';
  expectedHeadSha: string | null;
  expectedPrHeadSha: string | null;
  prNumber: number | null;
  recoveryRoot: string | null;
  reviews: Array<{ branch: string; pullRequestNumber: number; commentId: number }>;
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
    && command !== 'settle-local-merged'
  ) {
    throw new Error(USAGE);
  }
  const result: CliArguments = {
    command,
    json: false,
    compact: false,
    branch: null,
    refState: 'present',
    expectedHeadSha: null,
    expectedPrHeadSha: null,
    prNumber: null,
    recoveryRoot: null,
    reviews: []
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    // This switch only parses a fixed CLI vocabulary; every branch effect rechecks live authority.
    switch (arg) {
      case '--json':
        result.json = true;
        break;
      case '--compact':
        result.compact = true;
        break;
      case '--branch':
        result.branch = argv[++index] ?? null;
        break;
      case '--ref-state': {
        const value = argv[++index];
        if (value !== 'present' && value !== 'absent') {
          throw new Error('--ref-state must be present or absent.');
        }
        result.refState = value;
        break;
      }
      case '--expected-head-sha': {
        const value = argv[++index];
        if (value === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
          throw new Error('--expected-head-sha must be a 40- or 64-character Git object ID.');
        }
        result.expectedHeadSha = value;
        break;
      }
      case '--pr-head-sha': {
        const value = argv[++index];
        if (value === undefined || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)) {
          throw new Error('--pr-head-sha must be a 40- or 64-character Git object ID.');
        }
        result.expectedPrHeadSha = value;
        break;
      }
      case '--pr':
        result.prNumber = parsePositiveInteger(argv[++index], '--pr');
        break;
      case '--recovery-root':
        result.recoveryRoot = argv[++index] ?? null;
        break;
      case '--review': {
        const value = argv[++index];
        const match = value?.match(/^([^:]+):([1-9][0-9]*):([1-9][0-9]*)$/u);
        if (match === null || match === undefined) {
          throw new Error('--review requires exact branch:pull-request-number:comment-id.');
        }
        const branch = match[1]!;
        assertGitBranchName(branch, '--review branch');
        if (result.reviews.some((entry) => entry.branch === branch)) {
          throw new Error(`--review branch was supplied more than once: ${branch}`);
        }
        result.reviews.push({ branch,
          pullRequestNumber: parsePositiveInteger(match[2], '--review pull request'),
          commentId: parsePositiveInteger(match[3], '--review comment') });
        break;
      }
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    }
  }
  if (result.compact && !result.json) throw new Error('--compact requires --json.');
  return result;
}

const USAGE = `Usage:
  bun src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle.ts audit [--json [--compact]]
  bun src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle.ts configure-clone [--json]
  bun src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle.ts prepare --branch <name> [--pr <n>] [--ref-state <present|absent>] [--expected-head-sha <sha>] [--pr-head-sha <sha>] [--recovery-root <absolute-path>] [--json]
  bun src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle.ts settle-local-merged [--review <branch>:<pr>:<comment-id>]... [--recovery-root <absolute-path>] [--json]
`;

async function main(): Promise<void> {
  const args = parseCliArguments(process.argv.slice(2));
  const scope = {
    repositoryRoot: process.cwd(),
    recoveryRoot: args.recoveryRoot ?? undefined
  };

  if (args.command === 'audit') {
    const inventory = await collectBranchLifecycleInventory(scope);
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
    const observation = await configureBranchLifecycleClone(scope);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
    } else {
      process.stdout.write(
        'Configured clone-local fetch.prune, remote.origin.prune and fetch.pruneTags to true.\n'
      );
    }
    return;
  }

  if (args.command === 'settle-local-merged') {
    const result = await executeMergedLocalBranchResidueCloseout({
      repositoryRoot: process.cwd(),
      recoveryRoot: args.recoveryRoot ?? undefined,
      reviews: args.reviews
    });
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(
        `Settled ${result.settled.length} merged local branch residues; `
        + `retired-recovery=${result.retiredRecoveryFiles.length}; `
        + `recovery-root-retired=${String(result.recoveryRootRetired)}; `
        + `retired-worktree-evidence=${result.worktreeEvidenceGc.retiredOperationIds.length}; `
        + `protected=${result.protectedBranches.length}; unresolved=${result.unresolvedBranches.length}.\n`
      );
    }
    if (result.unresolvedBranches.length > 0) process.exitCode = 2;
    return;
  }

  if (args.command === 'prepare') {
    if (!args.branch) throw new Error(`--branch is required.\n${USAGE}`);
    const prepared = await prepareBranchCloseout(scope, {
      branch: args.branch,
      refState: args.refState,
      expectedHeadSha: args.expectedHeadSha ?? undefined,
      expectedPrHeadSha: args.expectedPrHeadSha ?? undefined,
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

  throw new Error(USAGE);
}

if (import.meta.main) {
  await main();
}
