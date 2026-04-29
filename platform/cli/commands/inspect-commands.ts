import type { CommandHandler } from '../command-registry.ts';
import {
  runDepsCommand,
  runReferenceCommand,
  runBenchmarkCommand,
  runTestCommand,
  runPolicyCommand,
  runAcceptanceCommand,
  runRuntimeCommand,
  runVerificationCommand,
  runProvenanceCommand,
  runReviewCommand,
  runDemoCommand,
  runContractCommand,
  runInstallCommand,
  runBlocksCommand,
  runPostgresCommand
} from '../commands.ts';
import { parseDoctorArgs } from '../args.ts';
import { getDoctorReport, formatDoctorReport } from '../../shared/dependency-environment.ts';
import { formatJson } from '../format-utils.ts';
import {
  DOCTOR_USAGE,
  DEPS_USAGE,
  REFERENCE_USAGE,
  BENCHMARK_USAGE,
  TEST_USAGE,
  POLICY_USAGE,
  ACCEPTANCE_USAGE,
  RUNTIME_USAGE,
  VERIFICATION_USAGE,
  PROVENANCE_USAGE,
  REVIEW_USAGE,
  DEMO_USAGE,
  CONTRACT_USAGE,
  INSTALL_USAGE,
  BLOCKS_USAGE,
  POSTGRES_USAGE
} from '../usage.ts';

export const doctorCommand: CommandHandler = {
  name: 'doctor',
  usage: DOCTOR_USAGE,
  async execute(args, ctx) {
    const doctorArgs = parseDoctorArgs(args);
    const report = await getDoctorReport(ctx.cwd);
    if (doctorArgs.json) {
      console.log(formatJson(report, doctorArgs));
      return;
    }
    console.log(formatDoctorReport(report));
  }
};

export const depsCommand: CommandHandler = {
  name: 'deps',
  usage: DEPS_USAGE,
  async execute(args, ctx) {
    await runDepsCommand(args, ctx.cwd);
  }
};

export const referenceCommand: CommandHandler = {
  name: 'reference',
  usage: REFERENCE_USAGE,
  async execute(args) {
    await runReferenceCommand(args);
  }
};

export const benchmarkCommand: CommandHandler = {
  name: 'benchmark',
  usage: BENCHMARK_USAGE,
  async execute(args) {
    await runBenchmarkCommand(args);
  }
};

export const testCommand: CommandHandler = {
  name: 'test',
  usage: TEST_USAGE,
  async execute(args) {
    await runTestCommand(args);
  }
};

export const policyCommand: CommandHandler = {
  name: 'policy',
  usage: POLICY_USAGE,
  async execute(args, ctx) {
    await runPolicyCommand(args, ctx.cwd);
  }
};

export const acceptanceCommand: CommandHandler = {
  name: 'acceptance',
  usage: ACCEPTANCE_USAGE,
  async execute(args, ctx) {
    await runAcceptanceCommand(args, ctx.cwd);
  }
};

export const runtimeCommand: CommandHandler = {
  name: 'runtime',
  usage: RUNTIME_USAGE,
  async execute(args, ctx) {
    await runRuntimeCommand(args, ctx.cwd);
  }
};

export const verificationCommand: CommandHandler = {
  name: 'verification',
  usage: VERIFICATION_USAGE,
  async execute(args, ctx) {
    await runVerificationCommand(args, ctx.cwd);
  }
};

export const provenanceCommand: CommandHandler = {
  name: 'provenance',
  usage: PROVENANCE_USAGE,
  async execute(args, ctx) {
    await runProvenanceCommand(args, ctx.cwd);
  }
};

export const reviewCommand: CommandHandler = {
  name: 'review',
  usage: REVIEW_USAGE,
  async execute(args, ctx) {
    await runReviewCommand(args, ctx.cwd);
  }
};

export const demoCommand: CommandHandler = {
  name: 'demo',
  usage: DEMO_USAGE,
  async execute(args, ctx) {
    await runDemoCommand(args, ctx.cwd);
  }
};

export const contractCommand: CommandHandler = {
  name: 'contract',
  usage: CONTRACT_USAGE,
  async execute(args) {
    await runContractCommand(args);
  }
};

export const installCommand: CommandHandler = {
  name: 'install',
  usage: INSTALL_USAGE,
  async execute(args, ctx) {
    await runInstallCommand(args, ctx.cwd);
  }
};

export const blocksCommand: CommandHandler = {
  name: 'blocks',
  usage: BLOCKS_USAGE,
  async execute(args, ctx) {
    await runBlocksCommand(args, ctx.cwd);
  }
};

export const postgresCommand: CommandHandler = {
  name: 'postgres',
  usage: POSTGRES_USAGE,
  async execute(args, ctx) {
    await runPostgresCommand(args, ctx.cwd);
  }
};
