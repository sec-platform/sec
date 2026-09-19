import type { Command } from 'commander';

import {
  addJsonFlags,
  commandPath,
  jsonOpts,
  usageError,
  type JsonOpts
} from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

export type DependencyCleanRequest = Readonly<{
  project?: boolean;
  shared?: boolean;
  bunCache?: boolean;
  all?: boolean;
  force?: boolean;
}>;

interface WorkspaceJsonContext {
  readonly workspaceRoot: string;
  readonly output: JsonOpts;
}

export type DependencyCommandProjection = Readonly<{
  value: unknown;
  text: string;
}>;

export interface DependencyCommandOperations {
  doctor(workspaceRoot: string): Promise<DependencyCommandProjection>;
  status(workspaceRoot: string): Promise<DependencyCommandProjection>;
  freshness(): Promise<DependencyCommandProjection>;
  warmup(workspaceRoot: string): Promise<DependencyCommandProjection>;
  relink(workspaceRoot: string): Promise<DependencyCommandProjection>;
  clean(
    workspaceRoot: string,
    request: DependencyCleanRequest
  ): Promise<Readonly<{ removedCount: number }>>;
}

export interface DependencyCommandHandlers {
  doctor(context: WorkspaceJsonContext): Promise<void>;
  status(context: WorkspaceJsonContext): Promise<void>;
  freshness(context: Readonly<{ output: JsonOpts }>): Promise<void>;
  warmup(context: WorkspaceJsonContext): Promise<void>;
  relink(context: WorkspaceJsonContext): Promise<void>;
  clean(context: Readonly<{
    workspaceRoot: string;
    request: DependencyCleanRequest;
  }>): Promise<void>;
}

export function bindDependencyCommandHandlers(
  operations: DependencyCommandOperations
): DependencyCommandHandlers {
  const required = [
    operations.doctor,
    operations.status,
    operations.freshness,
    operations.warmup,
    operations.relink,
    operations.clean
  ];
  if (required.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Dependency command operations must be callable');
  }
  const render = async (
    output: JsonOpts,
    projection: Promise<DependencyCommandProjection>
  ): Promise<void> => {
    const resolved = await projection;
    printJsonOrText(resolved.value, output, () => resolved.text);
  };
  return Object.freeze({
    doctor: ({ workspaceRoot, output }) =>
      render(output, operations.doctor.call(operations, workspaceRoot)),
    status: ({ workspaceRoot, output }) =>
      render(output, operations.status.call(operations, workspaceRoot)),
    freshness: ({ output }) =>
      render(output, operations.freshness.call(operations)),
    warmup: ({ workspaceRoot, output }) =>
      render(output, operations.warmup.call(operations, workspaceRoot)),
    relink: ({ workspaceRoot, output }) =>
      render(output, operations.relink.call(operations, workspaceRoot)),
    clean: async ({ workspaceRoot, request }) => {
      const result = await operations.clean.call(operations, workspaceRoot, request);
      console.log(`Cleaned ${result.removedCount} dependency paths`);
    }
  });
}

/** Entry owns dependency/environment command grammar and clean-option admission. */
export function registerDependencyCommands(
  program: Command,
  handlers: DependencyCommandHandlers
): void {
  const operations = [
    handlers.doctor,
    handlers.status,
    handlers.freshness,
    handlers.warmup,
    handlers.relink,
    handlers.clean
  ];
  if (operations.some(operation => typeof operation !== 'function')) {
    throw new TypeError('Dependency command handlers must be callable');
  }

  addJsonFlags(program.command('doctor'))
    .description('Check environment readiness')
    .action(async (rawOptions: Record<string, unknown>) => {
      await handlers.doctor({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions)
      });
    });

  const deps = program.command('deps').description('Dependency management');

  addJsonFlags(deps.command('status')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.status({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions)
      });
    }
  );

  addJsonFlags(deps.command('freshness')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.freshness({ output: jsonOpts(rawOptions) });
    }
  );

  addJsonFlags(deps.command('warmup')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.warmup({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions)
      });
    }
  );

  addJsonFlags(deps.command('relink')).action(
    async (rawOptions: Record<string, unknown>) => {
      await handlers.relink({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions)
      });
    }
  );

  deps.command('clean')
    .option('--project', 'Clean project deps')
    .option('--shared', 'Clean shared deps')
    .option('--bun-cache', 'Clean Bun cache')
    .option('--all', 'Clean all')
    .option('--force', 'Force clean')
    .action(async (rawOptions: Record<string, unknown>, command: Command) => {
      const request: DependencyCleanRequest = Object.freeze({
        project: rawOptions.project === true,
        shared: rawOptions.shared === true,
        bunCache: rawOptions.bunCache === true,
        all: rawOptions.all === true,
        force: rawOptions.force === true
      });
      if (request.all && !request.force) {
        throw usageError(`Usage: ${commandPath(command)} --all --force`);
      }
      if (!request.all && request.force) {
        throw usageError(`Usage: ${commandPath(command)} --all --force`);
      }
      await handlers.clean({
        workspaceRoot: process.cwd(),
        request
      });
    });
}
