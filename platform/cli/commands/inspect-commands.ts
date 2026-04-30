import { formatDoctorReport, getDoctorReport } from '../../shared/dependency-environment.ts';
import { parseDoctorArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import {
  runAcceptanceCommand,
  runBenchmarkCommand,
  runBlocksCommand,
  runContractCommand,
  runDemoCommand,
  runDepsCommand,
  runInstallCommand,
  runPolicyCommand,
  runPostgresCommand,
  runProvenanceCommand,
  runReferenceCommand,
  runReviewCommand,
  runRuntimeCommand,
  runTestCommand,
  runVerificationCommand
} from '../commands.ts';
import { printJsonOrText } from '../format-utils.ts';
import {
  ACCEPTANCE_USAGE,
  BENCHMARK_USAGE,
  BLOCKS_USAGE,
  CONTRACT_USAGE,
  DEMO_USAGE,
  DEPS_USAGE,
  DOCTOR_USAGE,
  INSTALL_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  PROVENANCE_USAGE,
  REFERENCE_USAGE,
  REVIEW_USAGE,
  RUNTIME_USAGE,
  TEST_USAGE,
  VERIFICATION_USAGE
} from '../usage.ts';

type ArgsCommandRunner = (args: string[]) => Promise<void>;
type WorkspaceCommandRunner = (args: string[], cwd: string) => Promise<void>;

function createArgsCommand(name: string, usage: string, run: ArgsCommandRunner): CommandHandler {
  return {
    name,
    usage,
    async execute(args) {
      await run(args);
    }
  };
}

function createWorkspaceCommand(name: string, usage: string, run: WorkspaceCommandRunner): CommandHandler {
  return {
    name,
    usage,
    async execute(args, ctx) {
      await run(args, ctx.cwd);
    }
  };
}

const doctorCommand: CommandHandler = {
  name: 'doctor',
  usage: DOCTOR_USAGE,
  async execute(args, ctx) {
    const doctorArgs = parseDoctorArgs(args);
    const report = await getDoctorReport(ctx.cwd);
    printJsonOrText(report, doctorArgs, formatDoctorReport);
  }
};

export const inspectCommands: CommandHandler[] = [
  doctorCommand,
  createWorkspaceCommand('deps', DEPS_USAGE, runDepsCommand),
  createArgsCommand('reference', REFERENCE_USAGE, runReferenceCommand),
  createArgsCommand('benchmark', BENCHMARK_USAGE, runBenchmarkCommand),
  createArgsCommand('test', TEST_USAGE, runTestCommand),
  createWorkspaceCommand('policy', POLICY_USAGE, runPolicyCommand),
  createWorkspaceCommand('acceptance', ACCEPTANCE_USAGE, runAcceptanceCommand),
  createWorkspaceCommand('runtime', RUNTIME_USAGE, runRuntimeCommand),
  createWorkspaceCommand('verification', VERIFICATION_USAGE, runVerificationCommand),
  createWorkspaceCommand('provenance', PROVENANCE_USAGE, runProvenanceCommand),
  createWorkspaceCommand('review', REVIEW_USAGE, runReviewCommand),
  createWorkspaceCommand('demo', DEMO_USAGE, runDemoCommand),
  createArgsCommand('contract', CONTRACT_USAGE, runContractCommand),
  createWorkspaceCommand('install', INSTALL_USAGE, runInstallCommand),
  createWorkspaceCommand('blocks', BLOCKS_USAGE, runBlocksCommand),
  createWorkspaceCommand('postgres', POSTGRES_USAGE, runPostgresCommand)
];
