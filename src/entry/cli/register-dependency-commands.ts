import type { Command } from 'commander';

import {
  addJsonFlags,
  commandPath,
  jsonOpts,
  usageError,
  type JsonOpts
} from './command-options.ts';
import {
  formatDependencyEnvironmentStatus,
  formatDependencyFreshnessDecision,
  formatDoctorReport,
  type DependencyEnvironmentPresentationSource,
  type DependencyFreshnessPresentationSource,
  type DoctorReportPresentationSource
} from './dependency-environment.ts';
import { printJsonOrText } from './format-utils.ts';

type DependencyCleanRequest = Readonly<{
  project?: boolean;
  materializations?: boolean;
  bunCache?: boolean;
  all?: boolean;
  force?: boolean;
}>;

interface WorkspaceJsonContext {
  readonly workspaceRoot: string;
  readonly output: JsonOpts;
}

export interface DependencyCommandOperations {
  doctor(workspaceRoot: string): Promise<DoctorReportPresentationSource>;
  status(workspaceRoot: string): Promise<DependencyEnvironmentPresentationSource>;
  freshness(): Promise<DependencyFreshnessPresentationSource>;
  warmup(workspaceRoot: string): Promise<DependencyEnvironmentPresentationSource>;
  relink(workspaceRoot: string): Promise<DependencyEnvironmentPresentationSource>;
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
  const render = async <T>(
    output: JsonOpts,
    pending: Promise<T>,
    formatText: (value: T) => string
  ): Promise<void> => {
    const value = await pending;
    printJsonOrText(value, output, formatText);
  };
  return Object.freeze<DependencyCommandHandlers>({
    doctor: ({ workspaceRoot, output }) =>
      render(
        output,
        operations.doctor.call(operations, workspaceRoot),
        formatDoctorReport
      ),
    status: ({ workspaceRoot, output }) =>
      render(
        output,
        operations.status.call(operations, workspaceRoot),
        formatDependencyEnvironmentStatus
      ),
    freshness: ({ output }) =>
      render(
        output,
        operations.freshness.call(operations),
        formatDependencyFreshnessDecision
      ),
    warmup: ({ workspaceRoot, output }) =>
      render(
        output,
        operations.warmup.call(operations, workspaceRoot),
        formatDependencyEnvironmentStatus
      ),
    relink: ({ workspaceRoot, output }) =>
      render(
        output,
        operations.relink.call(operations, workspaceRoot),
        formatDependencyEnvironmentStatus
      ),
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
    .option('--materializations', 'Clean dependency materializations')
    .option('--bun-cache', 'Clean Bun cache')
    .option('--all', 'Clean all')
    .option('--force', 'Force clean')
    .action(async (rawOptions: Record<string, unknown>, command: Command) => {
      const request: DependencyCleanRequest = Object.freeze({
        project: rawOptions.project === true,
        materializations: rawOptions.materializations === true,
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
