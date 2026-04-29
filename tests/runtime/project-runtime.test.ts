import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp
} from '../../platform/shared/project-runtime.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { loadRuntimeDependencySpec } from '../../platform/shared/runtime-dependency-spec.ts';
import {
  createWorkspace,
  installRuntimeDeps,
  readCompilerFile,
  readCompilerPackageJson,
  expectContainsAll,
  expectContainsNone
} from '../helpers/test-utils.ts';

describe('shared runtime dependency installation', () => {
  test('ensureSharedDepsReady serializes concurrent installs behind one lock', async () => {
    const tempRoot = await createWorkspace('engineering-compiler-shared-deps-');
    const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
    let installCalls = 0;

    const commandRunner = async (_command: string, _args: string[], options: { cwd: string }) => {
      installCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      await installRuntimeDeps(options.cwd);
      return { code: 0, stdout: 'ok', stderr: '' };
    };

    await Promise.all([
      ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot }),
      ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot }),
      ensureSharedDepsReady({ commandRunner, pollIntervalMs: 10, sharedDepsRoot })
    ]);

    expect(installCalls).toBe(1);
    expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'))).toMatchObject({
      packageManager: 'bun'
    });
  });
});

describe('root package scripts', () => {
  test('demo scripts follow the documented platform chain', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['demo:quickstart']).toBe('npm run platform -- init --reset && npm run reference:refresh');
    expect(scripts['demo:governance']).toBe(
      'npm run demo:quickstart && npm run platform -- artifacts --paths --kind governance'
    );
    expect(scripts['demo:closed-loop']).toBe(
      'npm run demo:quickstart && npm run platform -- verify --lane all && npm run platform -- artifacts --paths --kind governance && npm run platform -- explain --json --compact'
    );
  });

  test('dogfood scripts delegate to reference and governance commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['dogfood:reference']).toBe('npm run reference:refresh');
    expect(scripts['dogfood:governance']).toBe(
      'npm run dogfood:reference && npm run platform -- artifacts --paths --json --kind governance'
    );
  });

  test('reference:refresh chains the full pipeline', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['reference:refresh']).toBe(
      [
        'npm run platform -- resolve',
        'npm run platform -- compose',
        'npm run platform -- adapt',
        'npm run platform -- verify --lane all',
        'npm run platform -- lock',
        'npm run platform -- explain'
      ].join(' && ')
    );
  });
});

describe('test budget and benchmark contracts', () => {
  test('root package exposes budget and contract scripts', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts.test).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:all']).toBe('bun ./platform/dev-runner.ts test');
    expect(scripts.check).toBe('npm run typecheck && npm test');
    expect(scripts['check:full']).toBe('npm run typecheck && npm run test:all');
    expect(scripts['test:budget']).toBe('npm run platform -- test budget --json');
    expect(scripts['test:contract-freeze']).toBe('bun ./platform/dev-runner.ts contract-freeze');
    expect(scripts['test:benchmark-contract']).toBe('npm run platform -- benchmark suite --json');
    expect(scripts['reference:check']).toBe('npm run platform -- reference check');
  });

  test('dev-runner does not expose contract subcommands directly', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');

    expectContainsNone(runnerSource, ['reference-clean', 'benchmark-contract']);
  });

  test('fast test runner excludes slow files and skips runtime deps setup', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');
    const setupSource = await readCompilerFile('tests/setup/runtime-deps.setup.ts');

    expectContainsAll(runnerSource, [
      'test:fast'
    ]);
    expectContainsAll(testRunnerSource, [
      'getSlowTestFiles',
      'fastTestArgs',
      'PJC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    expectContainsAll(setupSource, [
      "process.env.PJC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureSharedDepsReady'
    ]);
  });

  test('test budget contract documents lanes and their capabilities', async () => {
    const source = await readCompilerFile('platform/shared/test-budget-contract.ts');

    expectContainsAll(source, [
      "command: 'npm run platform -- test budget --json'",
      "runnerCommand: 'npm run test:budget'",
      'laneCount',
      'slowLaneCount',
      'slowLaneIds',
      'slowTestFiles',
      'getSlowTestFiles',
      "id: 'fast'",
      'nextBuild: false',
      'playwright: false',
      "id: 'all'",
      'nextBuild: true',
      'playwright: true'
    ]);
  });

  test('benchmark contract documents suite metadata and task definitions', async () => {
    const source = await readCompilerFile('platform/shared/benchmark-contract.ts');

    expectContainsAll(source, [
      "suiteId: 'engineering-compiler-core'",
      "command: 'npm run platform -- benchmark suite --json'",
      "runnerCommand: 'npm run test:benchmark-contract'",
      'scoreDimensionCount',
      'artifactPathCount',
      'artifactPaths',
      'scoreFocusCount',
      'scoreFocus',
      "id: 'add-block'",
      "command: 'npm run demo:quickstart'",
      "id: 'repair-slot'",
      'CI_ARTIFACT_FILES.repairPlan',
      "id: 'override-conflict'",
      'CI_ARTIFACT_FILES.upgradeDiagnostics'
    ]);
  });

  test('reference check contract documents drift detection commands', async () => {
    const source = await readCompilerFile('platform/shared/reference-check.ts');

    expectContainsAll(source, [
      "command: 'npm run platform -- reference check --json'",
      "runnerCommand: 'npm run reference:check'",
      "['diff', '--name-only', '--exit-code', '--', 'source', 'project', 'control']",
      "['run', 'reference:refresh']",
      "failedStage: ReferenceCheckFailedStage"
    ]);
  });
});

describe('task envelope schema', () => {
  test('types define input/output type fields', async () => {
    const typesSource = await readCompilerFile('platform/shared/task-envelope-types.ts');

    expectContainsAll(typesSource, ['inputType?: string;', 'outputType?: string;']);
  });

  test('envelope builder wires concrete type annotations and slot constraints', async () => {
    const source = await readCompilerFile('platform/compiler/synthesize/build-task-envelope.ts');

    expectContainsAll(source, [
      "inputType: 'CustomerInput'",
      "outputType: 'NormalizedCustomerInput'",
      "'modify_other_files'",
      "'change_exports'"
    ]);
  });
});

describe('error protocol and developer contracts', () => {
  test('contract scripts bypass dev-runner', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['test:budget']).not.toContain('dev-runner');
    expect(scripts['test:benchmark-contract']).not.toContain('dev-runner');
    expect(scripts['reference:check']).not.toContain('reference-clean');
  });

  test('demo:closed-loop covers verify, artifacts, and explain', async () => {
    const { scripts } = await readCompilerPackageJson();

    expectContainsAll(scripts['demo:closed-loop'], [
      'npm run platform -- verify --lane all',
      'npm run platform -- artifacts --paths --kind governance',
      'npm run platform -- explain --json --compact'
    ]);
  });

  test('roadmap documents delivery themes and governance surface', async () => {
    const routeMap = await readCompilerFile('docs/03-MVP实施计划与路线图.md');

    expectContainsAll(routeMap, [
      '`init/add/resolve/compose/adapt/verify/repair/upgrade/lock/explain`',
      'fast/runtime/all',
      'reference drift',
      'benchmark',
      'contract freeze',
      'platform doctor',
      'platform deps',
      'CI 集成规范',
      'provenance',
      'policy gate',
      'Ticket SaaS',
      '阶段 C',
      '阶段 D',
      '13 个块'
    ]);
  });

  test('compiler spec documents registry source path contract', async () => {
    const spec = await readCompilerFile('docs/05-编译器核心实现规格.md');

    expectContainsAll(spec, [
      '| `registry.sources[].path` | string | 否 | 相对 `location` 根目录；禁止绝对路径、盘符、UNC、NUL 与 `..` 穿越 |',
      'blocks/slots/registry.sources 的 id 不允许重复',
      '`app.stack` 必须与所有块的 `stackProfiles` 兼容'
    ]);
  });

  test('README documents closed-loop and CLI surface', async () => {
    const readme = await readCompilerFile('README.md');

    expectContainsAll(readme, [
      'Run the full product closed loop with `npm run demo:closed-loop`.',
      'npm run platform -- deps status --json --compact',
      'npm run platform -- artifacts --paths --json --compact --kind governance',
      'npm run platform -- contract freeze --json --compact',
      'npm run platform -- contract errors --json --compact',
      'npm run platform -- contract ci --json --compact',
      'per-step produced artifact counts',
      'produced artifact paths',
      'npm run platform -- policy report --json --compact',
      'npm run platform -- acceptance coverage --json --compact',
      'npm run platform -- runtime report --json --compact',
      'npm run platform -- verification report --json --compact',
      'npm run platform -- verify --json --compact',
      'npm run platform -- provenance registry --json --compact',
      'npm run platform -- review summary --json --compact',
      'npm run platform -- review diagnostics --json --compact',
      'npm run platform -- workbench mutations apply --json --compact',
      'source/views/mutations/*.json',
      CI_ARTIFACT_FILES.viewMutationReport,
      'npm run platform -- repair --dry-run --json --compact',
      'npm run platform -- upgrade <block-id> <target-version> --dry-run --json --compact',
      'npm run platform -- test budget --json --compact',
      'npm run platform -- reference check',
      'npm run platform -- reference check --json --compact',
      'npm run platform -- benchmark suite --json --compact',
      'Governance contract freeze currently covers:',
      CI_ARTIFACT_FILES.explainGraph
    ]);
  });

  test('contract freeze contract documents runner wiring', async () => {
    const source = await readCompilerFile('platform/shared/contract-freeze-contract.ts');

    expectContainsAll(source, [
      "command: 'npm run platform -- contract freeze --json'",
      "runnerCommand: 'npm run test:contract-freeze'",
      'buildContractFreezeRunnerInvocations'
    ]);
  });

  test('error protocol defines issue types and code prefixes', async () => {
    const source = await readCompilerFile('platform/shared/error-protocol.ts');

    expectContainsAll(source, [
      "issueType: 'usage' | 'spec' | 'composition' | 'slot' | 'kernel'",
      'artifactPaths: string[]',
      "code.startsWith('VERIFY-BLOCKED-')",
      "code.startsWith('VERIFY-')",
      "code === 'REPAIR-BLOCKED-002'",
      "code.startsWith('REPAIR-')",
      "code.startsWith('UPGRADE-NOOP-')",
      "code.startsWith('UPGRADE-BLOCKED-')",
      "code.startsWith('UPGRADE-MIGRATION-')",
      "code.startsWith('UPGRADE-')"
    ]);
  });

  test('error protocol contract documents error shape and sample IDs', async () => {
    const source = await readCompilerFile('platform/shared/error-protocol-contract.ts');

    expectContainsAll(source, [
      "command: 'npm run platform -- contract errors --json'",
      'issueTypeCount',
      'artifactPathCount',
      'artifactPaths',
      "id: 'verify-blocked-error'",
      "id: 'repair-preflight-error'",
      "id: 'upgrade-conflict-error'"
    ]);
  });

  test('CLI surfaces protocol fields in error output', async () => {
    const cliSource = await readCompilerFile('platform/cli/index.ts');

    expectContainsAll(cliSource, [
      'code: protocol.code',
      'message: protocol.message',
      'recoverable: protocol.recoverable',
      'issueType: protocol.issueType',
      'suggestedActions: protocol.suggestedActions',
      'artifactPaths: protocol.artifactPaths'
    ]);
  });

  test('process module avoids win32 shell detection', async () => {
    const processSource = await readCompilerFile('platform/shared/process.ts');

    expectContainsNone(processSource, ["shell: process.platform === 'win32'"]);
  });
});

describe('project and shared runtime manifests', () => {
  test('derive versions from the root package.json', async () => {
    const workspaceRoot = await createWorkspace('engineering-compiler-runtime-manifest-');
    const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');

    await ensureProjectBase(workspaceRoot);
    await ensureSharedDepsReady({
      commandRunner: async (_command, _args, options) => {
        await installRuntimeDeps(options.cwd);
        return { code: 0, stdout: 'ok', stderr: '' };
      },
      sharedDepsRoot
    });

    const rootPackage = await readCompilerPackageJson();
    const { projectPackagePath } = getWorkspacePaths(workspaceRoot);
    const projectPackage = JSON.parse(await fs.readFile(projectPackagePath, 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const sharedPackage = JSON.parse(await fs.readFile(path.join(sharedDepsRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(projectPackage.dependencies.next).toBe(rootPackage.dependencies?.next);
    expect(projectPackage.dependencies.react).toBe(rootPackage.dependencies?.react);
    expect(projectPackage.devDependencies['@types/node']).toBe(rootPackage.devDependencies?.['@types/node']);
    expect(projectPackage.devDependencies.typescript).toBe(rootPackage.dependencies?.typescript);
    expect(sharedPackage.dependencies).toEqual(projectPackage.dependencies);
    expect(sharedPackage.devDependencies).toEqual(projectPackage.devDependencies);
  });
});

describe('project base', () => {
  test('keeps Playwright traces and serializes runtime acceptance', async () => {
    const workspaceRoot = await createWorkspace('engineering-compiler-runtime-trace-');

    await ensureProjectBase(workspaceRoot);

    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');
    expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
    expect(playwrightConfig).toContain('workers: 1');
  });
});

describe('dependency bridge', () => {
  test('reuses the shared runtime cache when the project has no node_modules', async () => {
    const workspaceRoot = await createWorkspace('engineering-compiler-runtime-bridge-');
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const bridgePath = path.join(projectRoot, 'node_modules');

    await ensureProjectBase(workspaceRoot);
    await withProjectDependencyBridge(projectRoot, async () => {
      const bridgeStats = await fs.lstat(bridgePath);
      expect(bridgeStats.isSymbolicLink()).toBe(true);
      await expect(fs.stat(path.join(bridgePath, 'next', 'package.json'))).resolves.toBeDefined();
    });

    await expect(fs.stat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('ensureProjectDependencies', () => {
  test('links shared cache without copying when project deps are cold', async () => {
    const workspaceRoot = await createWorkspace('engineering-compiler-runtime-link-');
    const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
    const runtimeSpec = await loadRuntimeDependencySpec();

    await ensureProjectBase(workspaceRoot);
    const { projectRoot } = getWorkspacePaths(workspaceRoot);

    await fs.mkdir(path.join(sharedDepsRoot, 'node_modules', 'next'), { recursive: true });
    await fs.writeFile(path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json'), '{\n}\n', 'utf8');
    await writeRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), {
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun',
      installedAt: '2026-01-01T00:00:00.000Z'
    });

    let installCalls = 0;
    await ensureProjectDependencies(projectRoot, {
      commandRunner: async () => {
        installCalls += 1;
        return { code: 0, stdout: 'ok', stderr: '' };
      },
      sharedDepsRoot
    });

    expect(installCalls).toBe(0);
    expect(await fs.realpath(path.join(projectRoot, 'node_modules'))).toBe(
      path.join(sharedDepsRoot, 'node_modules')
    );
  });
});
