import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp
} from '../../platform/shared/project-runtime.ts';
import { loadRuntimeDependencySpec } from '../../platform/shared/runtime-dependency-spec.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { installRuntimeDeps } from './project-runtime-fixtures.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe('shared runtime dependency installation', () => {
  test('ensureSharedDepsReady serializes concurrent installs behind one lock', async () => {
    await withTempWorkspace(async (tempRoot) => {
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
    }, 'engineering-compiler-shared-deps-');
  });
});

describe('root package scripts', () => {
  test('demo scripts follow the documented platform chain', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['demo:quickstart']).toBe('bun run sec -- init --reset && bun run reference:refresh');
    expect(scripts['demo:governance']).toBe(
      'bun run demo:quickstart && bun run sec -- artifacts --paths --kind governance'
    );
    expect(scripts['demo:closed-loop']).toBe(
      'bun run demo:quickstart && bun run sec -- verify --lane all && bun run sec -- artifacts --paths --kind governance && bun run sec -- explain --json --compact'
    );
  });

  test('dogfood scripts delegate to reference and governance commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['dogfood:reference']).toBe('bun run reference:refresh');
    expect(scripts['dogfood:governance']).toBe(
      'bun run dogfood:reference && bun run sec -- artifacts --paths --json --kind governance'
    );
  });

  test('reference:refresh chains the full pipeline', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['reference:refresh']).toBe(
      [
        'bun run sec -- resolve',
        'bun run sec -- compose',
        'bun run sec -- adapt',
        'bun run sec -- verify --lane all',
        'bun run sec -- lock',
        'bun run sec -- explain'
      ].join(' && ')
    );
  });
});

describe('test budget and benchmark contracts', () => {
  test('root package exposes budget and contract scripts', async () => {
    const { scripts, devDependencies, trustedDependencies } = await readCompilerPackageJson();

    expect(scripts.sec).toBe('bun ./platform/cli/index.ts');
    expect(scripts.dev).toBe('bun ./platform/dev-runner.ts');
    expect(scripts.typecheck).toBe('bun ./platform/dev-runner.ts typecheck');

    expect(scripts.test).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:affected']).toBe('bun ./platform/dev-runner.ts test:affected');
    expect(scripts['test:fast']).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:slow']).toBe('bun ./platform/dev-runner.ts test:slow');
    expect(scripts['test:full']).toBe('bun ./platform/dev-runner.ts test');

    expect(scripts.check).toBe('bun run check:fast');
    expect(scripts['check:affected']).toBe('bun run typecheck && bun run test:affected');
    expect(scripts['check:fast']).toBe('bun run typecheck && bun run docs:doctor && bun run test:fast');
    expect(scripts['check:full']).toBe('bun run typecheck && bun run docs:doctor && bun run test:full');
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();

    expect(scripts['imports:organize']).toBe('bun ./platform/dev-runner.ts imports:organize');
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');

    expect(scripts.depcruise).toBe('bunx --bun dependency-cruiser@17.3.10 "platform/**/*.ts" --config .dependency-cruiser.json');
    expect(scripts.jscpd).toBe('bunx --bun jscpd@4.0.9 platform/ scripts/ -o report/jscpd --reporters html,console,json --format typescript,javascript --ignore "**/node_modules/**,**/dist/**,**/*.test.ts,**/*.d.ts,**/upgrade/**,.tmp/**" --min-lines 5 --min-tokens 50 --absolute');
    expect(scripts.discover).toBe('bun scripts/discover-all.ts --json --output report/discover.json');
    expect(scripts['gitnexus:analyze']).toBe('gitnexus analyze --skip-agents-md --no-stats');
    expect(scripts['gitnexus:status']).toBe('gitnexus status');
    expect(scripts['gitnexus:mcp']).toBe('gitnexus mcp');
    expect(scripts.graphify).toBe('uvx --from graphifyy==0.7.10 graphify');
    expect(scripts['graphify:update']).toBe('uvx --from graphifyy==0.7.10 graphify update .');
    expect(scripts['graphify:extract']).toBe('uvx --from graphifyy==0.7.10 graphify extract . --out report/graphify --no-cluster');
    expect(devDependencies?.gitnexus).toBe('1.6.3');
    expect(trustedDependencies).toEqual(expect.arrayContaining([
      '@ladybugdb/core',
      'gitnexus',
      'onnxruntime-node',
      'protobufjs'
    ]));
    expect(scripts['arch:check']).toBe('bun run depcruise && bun run jscpd');
    expect(scripts.preflight).toBe('bun run depcruise && bun run jscpd && bun run discover');

    expect(scripts.format).toBeUndefined();
  });

  test('external graph provider caches stay out of version control', async () => {
    const gitignore = await readCompilerFile('.gitignore');

    expectContainsAll(gitignore, ['.gitnexus/', 'graphify-out/']);
  });

  test('MCP config exposes Graph-It-Live and GitNexus servers', async () => {
    const mcpConfig = JSON.parse(await readCompilerFile('.mcp.json')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(mcpConfig.mcpServers['graph-it-live']).toMatchObject({
      command: 'npx',
      args: ['-y', '@magic5644/graph-it-live', 'serve', '--workspace', '.']
    });
    expect(mcpConfig.mcpServers.gitnexus).toEqual({
      command: 'bun',
      args: ['run', 'gitnexus:mcp']
    });
  });

  test('architecture tools workflow delegates to canonical package scripts', async () => {
    const workflow = await readCompilerFile('.github/workflows/architecture-tools.yml');

    expectContainsAll(workflow, [
      'run: bun install --frozen-lockfile',
      'run: bun run depcruise',
      'run: bun run jscpd',
      'run: bun run discover'
    ]);
    expectContainsNone(workflow, [
      'run: bunx --bun dependency-cruiser@17.3.10',
      'run: bunx --bun jscpd@4.0.9'
    ]);
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
      'fastTestArgs',
      'SEC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    expectContainsAll(setupSource, [
      "process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureSharedDepsReady',
      'await fs.rm(lockPath, { recursive: true, force: true });'
    ]);
  });

  test('test budget contract documents lanes and their capabilities', async () => {
    const source = await readCompilerFile('platform/shared/test-budget-contract.ts');

    expectContainsAll(source, [
      "command: platformCommand('test', 'budget', '--json')",
      "runnerCommand: 'bun run test:budget'",
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
      "command: platformCommand('benchmark', 'suite', '--json')",
      "runnerCommand: 'bun run test:benchmark-contract'",
      'scoreDimensionCount',
      'artifactPathCount',
      'artifactPaths',
      'scoreFocusCount',
      'scoreFocus',
      "id: 'add-block'",
      "command: 'bun run demo:quickstart'",
      "id: 'repair-slot'",
      'CI_ARTIFACT_FILES.repairPlan',
      "id: 'override-conflict'",
      'CI_ARTIFACT_FILES.upgradeDiagnostics'
    ]);
  });

  test('reference check contract documents drift detection commands', async () => {
    const source = await readCompilerFile('platform/shared/reference-check.ts');

    expectContainsAll(source, [
      "command: platformCommand('reference', 'check', '--json')",
      "runnerCommand: 'bun run reference:check'",
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
      'inputType: task.inputType',
      'outputType: task.outputType',
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
      'bun run sec -- verify --lane all',
      'bun run sec -- artifacts --paths --kind governance',
      'bun run sec -- explain --json --compact'
    ]);
  });

  test('roadmap documents the active semantic core sequence and expansion boundary', async () => {
    const routeMap = await readCompilerFile('docs/03-MVP实施计划与路线图.md');

    expectContainsAll(routeMap, [
      'v0.3 Semantic Core Foundation',
      'Engineering IR Kernel',
      'Fact Provenance',
      'Ticket Semantic Contract',
      'Architecture View',
      'Scenario View',
      'State View',
      'Semantic Mutation',
      'AI Semantic Operator',
      '当前禁止事项'
    ]);
  });

  test('compiler spec documents workspace ownership and canonical IR boundaries', async () => {
    const spec = await readCompilerFile('docs/05-编译器核心实现规格.md');

    expectContainsAll(spec, [
      'source/code/slots/**',
      'Governed Source',
      '`graph.lock.json`',
      '不是 Engineering IR',
      'platform/compiler/ir/',
      'build-engineering-ir.ts',
      'CodeBuilder'
    ]);
  });

  test('README documents the semantic compiler entry model without duplicating the CLI catalog', async () => {
    const readme = await readCompilerFile('README.md');

    expectContainsAll(readme, [
      '本地优先的工程语义编译器',
      'Authoring Source',
      'Semantic Frontend',
      'Engineering IR',
      'ExplainGraph',
      'bun run sec -- <command>',
      'bun run demo:closed-loop',
      'source/model/**',
      'Task Envelope',
      'Semantic Mutation'
    ]);
    expect(readme).not.toContain('bun run platform --');
  });

  test('contract freeze contract documents runner wiring', async () => {
    const source = await readCompilerFile('platform/shared/contract-freeze-contract.ts');

    expectContainsAll(source, [
      "command: platformCommand('contract', 'freeze', '--json')",
      "runnerCommand: 'bun run test:contract-freeze'",
      'buildContractFreezeRunnerInvocations'
    ]);
  });

  test('error protocol defines issue types and code prefixes', async () => {
    const source = await readCompilerFile('platform/shared/error-protocol.ts');

    expectContainsAll(source, [
      "issueType: 'usage' | 'spec' | 'composition' | 'slot' | 'kernel'",
      'artifactPaths: string[]',
      'const ERROR_PROTOCOL_RULES: ErrorProtocolRule[] = [',
      "prefix: 'VERIFY-BLOCKED-'",
      "prefix: 'VERIFY-'",
      "prefix: 'REPAIR-BLOCKED-002'",
      "prefix: 'REPAIR-'",
      "prefix: 'UPGRADE-NOOP-'",
      "prefix: 'UPGRADE-BLOCKED-'",
      "prefix: 'UPGRADE-MIGRATION-'",
      "prefix: 'UPGRADE-'",
      'ERROR_PROTOCOL_RULES.find((r) => code.startsWith(r.prefix))'
    ]);
  });

  test('error protocol contract documents error shape and sample IDs', async () => {
    const source = await readCompilerFile('platform/shared/error-protocol-contract.ts');

    expectContainsAll(source, [
      "command: platformCommand('contract', 'errors', '--json')",
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
    await withTempWorkspace(async (workspaceRoot) => {
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
      const projectPackage = await readJson<RuntimePackageJson>(projectPackagePath);
      const sharedPackage = await readJson<RuntimePackageJson>(path.join(sharedDepsRoot, 'package.json'));

      expect(projectPackage.dependencies.next).toBe(rootPackage.dependencies?.next as string);
      expect(projectPackage.dependencies.react).toBe(rootPackage.dependencies?.react as string);
      expect(projectPackage.devDependencies['@types/node']).toBe(rootPackage.devDependencies?.['@types/node'] as string);
      expect(projectPackage.devDependencies.typescript).toBe(rootPackage.devDependencies?.typescript as string);
      expect(sharedPackage.dependencies).toEqual(projectPackage.dependencies);
      expect(sharedPackage.devDependencies).toEqual(projectPackage.devDependencies);
    }, 'engineering-compiler-runtime-manifest-');
  });
});

describe('project base', () => {
  test('keeps Playwright as the runtime full browser smoke', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);

      const runtimeSpec = await loadRuntimeDependencySpec();
      const { projectPackagePath, projectRoot } = getWorkspacePaths(workspaceRoot);
      const projectPackage = await readJson<RuntimePackageJson & { scripts: Record<string, string> }>(projectPackagePath);
      const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');

      expect(runtimeSpec.devDependencies['@playwright/test']).toBeDefined();
      expect(projectPackage.devDependencies['@playwright/test']).toBe(runtimeSpec.devDependencies['@playwright/test']);
      expect(projectPackage.scripts['test:acceptance']).toBe('playwright test --config playwright.config.ts');
      expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run build && bun run test:unit && bun run test:acceptance');
      expect(projectPackage.scripts['test:fast']).not.toContain('playwright');
      expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
      expect(playwrightConfig).toContain('workers: 1');
    }, 'engineering-compiler-runtime-trace-');
  });
});

describe('dependency bridge', () => {
  test('reuses the shared runtime cache when the project has no node_modules', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const bridgePath = path.join(projectRoot, 'node_modules');

      await ensureProjectBase(workspaceRoot);
      await withProjectDependencyBridge(projectRoot, async () => {
        const bridgeStats = await fs.lstat(bridgePath);
        expect(bridgeStats.isSymbolicLink()).toBe(true);
        await expect(fs.stat(path.join(bridgePath, 'next', 'package.json'))).resolves.toBeDefined();
      });

      await expect(fs.stat(bridgePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-bridge-');
  });
});

describe('ensureProjectDependencies', () => {
  test('links shared cache without copying when project deps are cold', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const runtimeSpec = await loadRuntimeDependencySpec();

      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      await fs.mkdir(path.join(sharedDepsRoot, 'node_modules', 'next'), { recursive: true });
      await fs.writeFile(
        path.join(sharedDepsRoot, 'node_modules', 'next', 'package.json'),
        '{\n  "name": "next",\n  "version": "0.0.0"\n}\n',
        'utf8'
      );
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
    }, 'engineering-compiler-runtime-link-');
  });
});
