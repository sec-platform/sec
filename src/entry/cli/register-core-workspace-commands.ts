import type { Command } from 'commander';
import { addJsonFlags, jsonOpts } from './command-options.ts';
import { commandValue } from './command-value.ts';
import { VERIFICATION_LANE_OPTION } from './verification-lane-option.ts';
import { registerWorkspaceAction, type WorkspaceProgressRunner } from './workspace-action.ts';
import {
  COMPOSE_LOCK_OPTION,
  VERIFY_COMMAND_DEFAULT_LANE,
  parseComposeCommandInput,
  parseVerifyCommandInput
} from './workspace-command-input.ts';

type ComposeRequest = ReturnType<typeof parseComposeCommandInput>;
type VerificationRequest = ReturnType<typeof parseVerifyCommandInput>['request'];

export interface CoreWorkspaceCommandOperations {
  readonly progress: WorkspaceProgressRunner;
  readonly init: (workspaceRoot: string) => Promise<unknown>;
  readonly add: (workspaceRoot: string, blockId: string) => Promise<Readonly<{
    changed: boolean;
    selectedBlock: Readonly<{ id: string; version: string; registrySourceId: string; registryKind: string }>;
  }>>;
  readonly resolve: (workspaceRoot: string) => Promise<Readonly<{ lock: Readonly<{ resolvedBlocks: readonly unknown[] }> }>>;
  readonly compose: (workspaceRoot: string, request: ComposeRequest) => Promise<unknown>;
  readonly verify: (workspaceRoot: string, request: VerificationRequest) => Promise<Readonly<{
    report: Readonly<{ summary: Readonly<{ status: string; requestedLane: string }> }>;
  }>>;
}

/** Entry owns grammar, capture and result presentation for single-execution workspace commands. */
export function registerCoreWorkspaceCommands(program: Command, operations: CoreWorkspaceCommandOperations): void {
  const { progress, init, add, resolve, compose, verify } = operations;
  if ([progress, init, add, resolve, compose, verify].some((value) => typeof value !== 'function')) {
    throw new TypeError('Core workspace command operations must be callable');
  }

  const textOutput = jsonOpts({});
  registerWorkspaceAction(program.command('init').description('Initialize project workspace'), {
    decode: () => ({ request: undefined, output: textOutput }),
    execute: (root) => init(root),
    view: () => commandValue(undefined, () => 'Initialized project workspace')
  });

  registerWorkspaceAction(program.command('add <block-id>').description('Add a block to the project'), {
    decode: (blockId: string) => ({ request: blockId, output: textOutput }),
    execute: (root, blockId) => add(root, blockId),
    view: (result) => commandValue(result, (value) => {
      const selected = value.selectedBlock;
      return `${value.changed ? 'Added' : 'Selected'} block ${selected.id}@${selected.version} from ${selected.registrySourceId} (${selected.registryKind})`;
    })
  });

  registerWorkspaceAction(program.command('resolve').description('Resolve block dependencies'), {
    decode: () => ({ request: undefined, output: textOutput }),
    progress: { text: 'Resolving block dependencies', run: progress },
    execute: (root) => resolve(root),
    view: (result) => commandValue(result, (value) => `Resolved ${value.lock.resolvedBlocks.length} blocks`)
  });

  registerWorkspaceAction(program.command('compose')
    .description('Compose project')
    .option(COMPOSE_LOCK_OPTION.flags, 'Lock project files as read-only'), {
    decode: (rawOptions: Record<string, unknown>) => ({ request: parseComposeCommandInput(rawOptions), output: textOutput }),
    progress: { text: 'Composing project', run: progress },
    execute: (root, input) => compose(root, input),
    view: () => commandValue(undefined, () => 'Composed project')
  });

  registerWorkspaceAction(addJsonFlags(program.command('verify'))
    .description('Run verification')
    .option(VERIFICATION_LANE_OPTION.flags, VERIFICATION_LANE_OPTION.description, VERIFY_COMMAND_DEFAULT_LANE), {
    decode: parseVerifyCommandInput,
    progress: { text: 'Running verification', run: progress },
    execute: (root, request) => verify(root, request),
    view: ({ report }) => commandValue(report, (value) => `Verification ${value.summary.status} (${value.summary.requestedLane})`)
  });
}
