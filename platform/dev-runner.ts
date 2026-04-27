import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureSharedDepsReady } from './shared/project-runtime.ts';
import { compilerRoot } from './shared/paths.ts';
import { pathExists } from './shared/fs.ts';

function usage(): never {
  console.error('Usage: bun ./platform/dev-runner.ts <typecheck|test|test-budget|contract-freeze|benchmark-contract|reference-clean|clean-test-workspaces> [args...]');
  process.exit(1);
}

type ContractFreezeTarget = {
  file: string;
  testNamePattern?: string;
};

function contractFreezeTargets(): ContractFreezeTarget[] {
  return [
    {
      file: 'tests/cli.test.ts',
      testNamePattern: [
        'CLI prints usage for missing or unknown commands',
        'CLI exposes doctor as text and JSON readiness contracts',
        'CLI exposes dependency environment maintenance entrypoints',
        'CLI emits explain JSON for CI consumers',
        'CLI emits artifact manifest JSON for CI upload consumers',
        'CLI reports argument usage errors'
      ].join('|')
    },
    {
      file: 'tests/project-runtime.test.ts',
      testNamePattern: [
        'root package exposes demo scripts through the existing platform chain',
        'test budget and benchmark contracts document slow lanes and task-suite scope',
        'error protocol, closed loop entry, and test lane map stay frozen in developer contracts',
        'reference refresh and shared cache contract stay anchored in repo metadata'
      ].join('|')
    },
    {
      file: 'tests/pipeline.test.ts',
      testNamePattern: 'v0.1 pipeline runs end to end in a temporary workspace'
    }
  ];
}

async function runContractFreeze(): Promise<number> {
  for (const target of contractFreezeTargets()) {
    const args = ['test', target.file];
    if (target.testNamePattern) {
      args.push('--test-name-pattern', target.testNamePattern);
    }
    const code = await runDevCommand('bun', args, process.env);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

function testBudgetContract(): object {
  return {
    formatVersion: '1',
    defaultLane: 'fast',
    lanes: [
      {
        id: 'fast',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify'
      },
      {
        id: 'runtime',
        nextBuild: false,
        playwright: false,
        command: 'npm run platform -- verify --lane runtime'
      },
      {
        id: 'all',
        nextBuild: true,
        playwright: true,
        command: 'npm run platform -- verify --lane all'
      }
    ],
    localDefault: 'fast lane plus targeted named tests',
    fullRuntimeGate: 'scheduled CI or explicit release/demo verification'
  };
}

function benchmarkContract(): object {
  return {
    formatVersion: '1',
    suiteId: 'engineering-compiler-core',
    status: 'active',
    taskCount: 5,
    tasks: [
      {
        id: 'add-block',
        goal: 'install one capability block into a clean workspace',
        gate: 'resolve compose adapt verify lock explain',
        scoreFocus: ['success-rate', 'files-touched', 'verification-status']
      },
      {
        id: 'repair-slot',
        goal: 'repair one slot issue within task-envelope write bounds',
        gate: 'repair verify',
        scoreFocus: ['repairability', 'attempt-count', 'verification-status']
      },
      {
        id: 'policy-violation',
        goal: 'detect and explain one project policy violation',
        gate: 'verify explain',
        scoreFocus: ['diagnostic-precision', 'explainability']
      },
      {
        id: 'upgrade-dry-run',
        goal: 'preview one governed block upgrade and impact summary',
        gate: 'upgrade --dry-run explain',
        scoreFocus: ['upgrade-safety', 'impact-coverage']
      },
      {
        id: 'override-conflict',
        goal: 'surface one override conflict during upgrade planning',
        gate: 'upgrade --dry-run',
        scoreFocus: ['conflict-detection', 'machine-recoverability']
      }
    ],
    scoreDimensions: [
      'success-rate',
      'attempt-count',
      'wall-time',
      'files-touched',
      'verification-status',
      'explainability',
      'repairability',
      'upgrade-safety',
      'machine-recoverability'
    ]
  };
}

function commandPath(binPath: string, base: string): string {
  return path.join(binPath, process.platform === 'win32' ? `${base}.exe` : base);
}

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

async function withRootDependencyBridge<T>(nodeModulesPath: string, callback: () => Promise<T>): Promise<T> {
  const rootNodeModulesPath = path.join(compilerRoot, 'node_modules');
  const hadRootNodeModules = await pathExists(rootNodeModulesPath);

  if (!hadRootNodeModules) {
    await fs.symlink(nodeModulesPath, rootNodeModulesPath, 'junction');
  }

  try {
    return await callback();
  } finally {
    if (!hadRootNodeModules) {
      await fs.rm(rootNodeModulesPath, { recursive: true, force: true });
    }
  }
}

function getTestWorkspaceTempRoot(): string {
  return path.join(compilerRoot, '.tmp', 'test-workspaces');
}

async function cleanTestWorkspaces(): Promise<void> {
  await fs.rm(getTestWorkspaceTempRoot(), { recursive: true, force: true });
}

function runDevCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: compilerRoot,
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          ...env
        }).filter(([, value]) => value !== undefined)
      ) as NodeJS.ProcessEnv,
      shell: false,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main(): Promise<void> {
  const [target, ...args] = process.argv.slice(2);
  if (!target) {
    usage();
  }

  if (target === 'clean-test-workspaces') {
    await cleanTestWorkspaces();
    return;
  }

  if (target === 'test-budget') {
    console.log(JSON.stringify(testBudgetContract(), null, 2));
    return;
  }

  if (target === 'benchmark-contract') {
    console.log(JSON.stringify(benchmarkContract(), null, 2));
    return;
  }

  if (target === 'reference-clean') {
    const code = await runDevCommand('npm', ['run', 'demo:quickstart'], process.env);
    if (code !== 0) {
      process.exitCode = code;
      return;
    }
    process.exitCode = await runDevCommand('git', ['diff', '--exit-code', '--', 'project'], process.env);
    return;
  }

  const sharedDeps = await ensureSharedDepsReady();
  const binPath = path.join(sharedDeps.nodeModulesPath, '.bin');
  const envPathKey = pathEnvKey();
  const env = {
    [envPathKey]: `${binPath}${path.delimiter}${process.env[envPathKey] ?? ''}`
  };

  await withRootDependencyBridge(sharedDeps.nodeModulesPath, async () => {
    const code =
      target === 'typecheck'
        ? await runDevCommand(commandPath(binPath, 'tsc'), ['--noEmit', '-p', 'tsconfig.json', ...args], env)
        : target === 'test'
          ? await runDevCommand(commandPath(binPath, 'vitest'), ['run', ...args], env)
          : target === 'contract-freeze'
            ? await runContractFreeze()
            : usage();

    process.exitCode = code;
  });
}

await main();
