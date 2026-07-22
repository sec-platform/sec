import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  ensureCompilerDepsReady,
  ensureProjectDependencies,
  ensureSharedDepsReady,
  readRuntimeDepsStamp,
  withProjectDependencyBridge,
  writeRuntimeDepsStamp
} from '../../platform/shared/project-runtime.ts';
import {
  buildRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE
} from '../../platform/shared/runtime-dependency-spec.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { installRuntimeDeps } from './project-runtime-fixtures.ts';

type RuntimePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function installCompilerDependencyFixture(workingDirectory: string, marker: string): Promise<void> {
  const packages = [{ name: 'commander', version: '1.0.0' }, {
    main: 'dist/ts-morph-common.js',
    name: '@ts-morph/common',
    version: '1.0.0'
  }, {
    main: './script/mod.js',
    name: 'code-block-writer',
    version: '1.0.0'
  }, {
    main: 'dist/ts-morph.js',
    name: 'ts-morph',
    version: '1.0.0'
  }, {
    main: './lib/typescript.js',
    name: 'typescript',
    version: '1.0.0'
  }];
  for (const manifest of packages) {
    const packageRoot = path.join(workingDirectory, 'node_modules', manifest.name);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`);
    if (manifest.main) {
      const entryPath = path.join(packageRoot, ...manifest.main.replace(/^\.\//u, '').split('/'));
      await fs.mkdir(path.dirname(entryPath), { recursive: true });
      await fs.writeFile(entryPath, `${marker}:${manifest.name}\n`);
    }
  }
}

async function installRuntimePackageManifestClosure(nodeModulesRoot: string): Promise<void> {
  await Promise.all(RUNTIME_DEPENDENCY_PACKAGE_NAMES.map(async (packageName) => {
    const packageRoot = path.join(nodeModulesRoot, ...packageName.split('/'));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
      name: packageName,
      version: '0.0.0-fixture'
    })}\n`, 'utf8');
  }));
}

async function writeCompilerDependencyRoot(
  root: string,
  lockfile = 'lock-v1\n',
  bunVersion = '1.3.6'
): Promise<void> {
  await Promise.all([
    fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      packageManager: `bun@${bunVersion}`,
      dependencies: { commander: '1.0.0' },
      devDependencies: { 'ts-morph': '1.0.0', typescript: '1.0.0' }
    })}\n`, 'utf8'),
    fs.writeFile(path.join(root, 'bun.lock'), lockfile, 'utf8'),
    fs.writeFile(path.join(root, '.bun-version'), `${bunVersion}\n`, 'utf8')
  ]);
}

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

  test('does not publish readiness for an incomplete runtime package closure', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
      await expect(ensureSharedDepsReady({
        commandRunner: async (_command, _args, options) => {
          await installRuntimeDeps(options.cwd);
          await fs.rm(path.join(options.cwd, 'node_modules', 'react', 'package.json'));
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        sharedDepsRoot
      })).rejects.toThrow('failed complete package validation');
      expect(await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json')))
        .toBeNull();
    }, 'engineering-compiler-shared-deps-incomplete-');
  });
});

describe('compiler dependency installation', () => {
  test('serializes immutable generations and invalidates the binding on lockfile or runtime changes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (_command: string, args: string[], options: { cwd: string }) => {
        installCalls += 1;
        expect(args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
        expect(options.cwd).not.toBe(tempRoot);
        expect(path.basename(options.cwd)).toContain('.staging-');
        await new Promise((resolve) => setTimeout(resolve, 50));
        await installCompilerDependencyFixture(options.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const options = { commandRunner, pollIntervalMs: 10, runtimeVersion: '1.3.6' };

      const first = await Promise.all([
        ensureCompilerDepsReady(options, tempRoot),
        ensureCompilerDepsReady(options, tempRoot)
      ]);

      expect(installCalls).toBe(1);
      expect(first.map(({ source }) => source).sort()).toEqual(['existing', 'installed']);
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n', 'utf8');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'utf8'))
        .toBe('generation-2:typescript\n');

      await expect(ensureCompilerDepsReady({ ...options, runtimeVersion: '1.3.14' }, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-001' });
      expect(installCalls).toBe(2);
      await writeCompilerDependencyRoot(tempRoot, 'lock-v2\n', '1.3.14');
      expect((await ensureCompilerDepsReady({ ...options, runtimeVersion: '1.3.14' }, tempRoot)).source)
        .toBe('installed');
      expect(installCalls).toBe(3);
      expect(await readJson(path.join(
        tempRoot,
        'node_modules',
        '.sec-compiler-deps-binding-v2.json'
      ))).toMatchObject({
        bunVersion: '1.3.14',
        declaredBunVersion: '1.3.14',
        formatVersion: 'compiler-deps-binding-v2'
      });
    }, 'engineering-compiler-dev-deps-');
  });

  test('repairs critical direct and transitive entry corruption before developer commands load dependencies', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const options = {
        commandRunner: async (_command: string, _args: string[], command: { cwd: string }) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        runtimeVersion: '1.3.6'
      };
      await ensureCompilerDepsReady(options, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', '@ts-morph', 'common', 'dist', 'ts-morph-common.js');
      await fs.writeFile(entryPath, 'corrupt\n');

      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:@ts-morph/common\n');
    }, 'engineering-compiler-dev-deps-corruption-');
  });

  test('preserves the active generation when materialization or atomic publish fails', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const commandRunner = async (_command: string, _args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { commandRunner, runtimeVersion: '1.3.6' };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
      const bindingPath = path.join(tempRoot, 'node_modules', '.sec-compiler-deps-binding-v2.json');
      const originalEntry = await fs.readFile(entryPath);
      const originalBinding = await fs.readFile(bindingPath);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        commandRunner: async () => ({ code: 1, stdout: '', stderr: 'injected install failure' })
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-002' });
      expect(await fs.readFile(entryPath)).toEqual(originalEntry);
      expect(await fs.readFile(bindingPath)).toEqual(originalBinding);

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        testCompilerPublishHook: () => {
          throw new Error('injected publish failure');
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(await fs.readFile(entryPath)).toEqual(originalEntry);
      expect(await fs.readFile(bindingPath)).toEqual(originalBinding);
    }, 'engineering-compiler-dev-deps-rollback-');
  });

  test('reclaims a dead compiler install owner instead of timing out future development', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-owner'
      })}\n`);
      let installCalls = 0;

      const ready = await ensureCompilerDepsReady({
        commandRunner: async (_command, _args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'recovered');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        lockTimeoutMs: 1000,
        pollIntervalMs: 10,
        runtimeVersion: '1.3.6'
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(1);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-dev-deps-orphan-');
  });
});

describe('root package scripts', () => {
  test('canonical Bun version is projected into package and every setup workflow', async () => {
    const rootPackage = await readCompilerPackageJson();
    const canonicalVersion = (await readCompilerFile('.bun-version')).trim();
    const workflows = await Promise.all([
      'architecture-tools.yml',
      'compiler-pr-validation.yml',
      'compiler-release-validation.yml',
      'sec-merge-gate.yml'
    ].map((fileName) => readCompilerFile(`.github/workflows/${fileName}`)));

    expect(canonicalVersion).toBe('1.3.14');
    expect(rootPackage.packageManager).toBe(`bun@${canonicalVersion}`);
    for (const workflow of workflows) {
      expect(workflow).toContain('bun-version-file: .bun-version');
      expect(workflow).not.toContain('bun-version: 1.3.6');
    }
  });

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

  test('reference:refresh delegates to the canonical pipeline compiler', async () => {
    const { scripts } = await readCompilerPackageJson();
    const source = await readCompilerFile('scripts/compile-reference-workspace.ts');

    expect(scripts['reference:refresh']).toBe('bun ./scripts/compile-reference-workspace.ts');
    expectContainsAll(source, [
      "import { compileWorkspace } from '../platform/orchestrator.ts';",
      'await compileWorkspace(process.cwd(), {',
      "source: 'reference'"
    ]);
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
    expect(scripts['check:affected']).toBe('bun run imports:prepare && bun run typecheck && bun run test:affected');
    expect(scripts['check:fast']).toBe(
      'bun run imports:prepare && bun run typecheck && bun run docs:doctor && bun run test:fast'
    );
    expect(scripts['check:full']).toBe(
      'bun run imports:prepare && bun run typecheck && bun run docs:doctor && bun run test:full'
    );
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();

    expect(scripts['imports:prepare']).toBe('bun ./platform/dev-runner.ts imports:prepare');
    expect(scripts['imports:organize']).toBe('bun ./platform/dev-runner.ts imports:organize');
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');
    expect(scripts['imports:freeze']).toBe('bun ./platform/dev-runner.ts imports:freeze');
    expect(scripts['imports:staged']).toBe('bun ./platform/dev-runner.ts imports:staged');
    expect(scripts['deps:ensure']).toBe('bun ./platform/dev-runner.ts deps:ensure');
    expect(scripts['hooks:install']).toBe('bun ./scripts/install-git-hooks.ts');
    expect(scripts.postinstall).toBe('bun ./scripts/install-git-hooks.ts --lifecycle');

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
    const runtimeVerificationSource = await readCompilerFile(
      'platform/compiler/verify/run-runtime-verification.ts'
    );

    expectContainsAll(runnerSource, [
      'test:fast'
    ]);
    expectContainsAll(testRunnerSource, [
      'fastTestArgs',
      'ensureTestDependencies',
      'PLAYWRIGHT_BROWSERS_PATH',
      'SEC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    expectContainsAll(setupSource, [
      "process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureTestDependencies',
      'process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath',
      'await fs.rm(lockPath, { recursive: true, force: true });'
    ]);
    expectContainsNone(setupSource, ['ensureDevDependencies', 'ensurePlaywrightBrowserCacheReady']);
    expectContainsAll(runtimeVerificationSource, ['materializePlaywrightBrowserCache']);
    expectContainsNone(runtimeVerificationSource, [
      "path.join(projectRoot, 'node_modules', 'playwright', 'cli.js')",
      "path.join(compilerRoot, '.shared-deps', '.playwright-browsers')"
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
    const scanSource = await readCompilerFile('platform/shared/reference-drift-scan.ts');

    expectContainsAll(source, [
      "command: platformCommand('reference', 'check', '--json')",
      "runnerCommand: 'bun run reference:check'",
      'REFERENCE_TRACKED_DIFF_ARGS',
      'REFERENCE_UNTRACKED_SCAN_ARGS',
      'scanReferenceDrift',
      'failedStage: ReferenceCheckFailedStage'
    ]);
    expectContainsAll(scanSource, [
      "['diff', '--name-only', '--exit-code', '--', ...REFERENCE_PATHS]",
      "['ls-files', '--others', '--exclude-standard', '--', ...REFERENCE_PATHS]"
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
  test('reuses the production build for the Playwright runtime smoke', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);

      const runtimeSpec = await loadRuntimeDependencySpec();
      const { projectPackagePath, projectRoot } = getWorkspacePaths(workspaceRoot);
      const projectPackage = await readJson<RuntimePackageJson & { scripts: Record<string, string> }>(projectPackagePath);
      const playwrightConfig = await fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8');

      expect(runtimeSpec.devDependencies['@playwright/test']).toBeDefined();
      expect(runtimeSpec.devDependencies['ts-morph']).toBeDefined();
      expect(projectPackage.devDependencies['@playwright/test']).toBe(runtimeSpec.devDependencies['@playwright/test']);
      expect(projectPackage.scripts.dev).toBe('next dev --webpack');
      expect(projectPackage.scripts['test:acceptance']).toBe('playwright test --config playwright.config.ts');
      expect(projectPackage.scripts['verify:runtime:full']).toBe('bun run build && bun run test:unit && bun run test:acceptance');
      expect(projectPackage.scripts['test:fast']).not.toContain('playwright');
      expect(playwrightConfig).toContain("trace: 'retain-on-failure'");
      expect(playwrightConfig).toContain('workers: 1');
      expect(playwrightConfig).toContain('next start --hostname 127.0.0.1');
      expect(playwrightConfig).not.toContain('next dev');
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
  test('prebound dependency readiness is constant-work and preserves the plan-owned tree', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const fillerRoot = path.join(nodeModulesRoot, 'synthetic-package');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.mkdir(fillerRoot, { recursive: true });
      await Promise.all([
        fs.writeFile(bindingPath, `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`, 'utf8'),
        ...Array.from({ length: 1024 }, (_, index) =>
          fs.writeFile(path.join(fillerRoot, `${String(index).padStart(4, '0')}.bin`), 'x', 'utf8'))
      ]);
      const beforeRoot = await fs.stat(nodeModulesRoot);
      const beforeSample = await fs.stat(path.join(fillerRoot, '0512.bin'));
      let fenceCalls = 0;
      let installCalls = 0;

      await ensureProjectDependencies(projectRoot, {
        beforeCommit: async () => {
          fenceCalls += 1;
        },
        commandRunner: async () => {
          installCalls += 1;
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      });

      const afterRoot = await fs.stat(nodeModulesRoot);
      const afterSample = await fs.stat(path.join(fillerRoot, '0512.bin'));
      expect(fenceCalls).toBe(2);
      expect(installCalls).toBe(0);
      expect({ dev: afterRoot.dev, ino: afterRoot.ino }).toEqual({ dev: beforeRoot.dev, ino: beforeRoot.ino });
      expect({ dev: afterSample.dev, ino: afterSample.ino })
        .toEqual({ dev: beforeSample.dev, ino: beforeSample.ino });
    }, 'engineering-compiler-runtime-prebound-constant-work-');
  });

  test('prebound dependency readiness rejects incomplete or forged package closure', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      const reactManifest = path.join(nodeModulesRoot, 'react', 'package.json');
      const runtimeSpec = await loadRuntimeDependencySpec();
      await installRuntimePackageManifestClosure(nodeModulesRoot);
      await fs.writeFile(
        bindingPath,
        `${JSON.stringify(buildRuntimeDepsPreboundBinding(runtimeSpec))}\n`,
        'utf8'
      );

      await fs.rm(reactManifest);
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.writeFile(reactManifest, '{"name":"forged-react","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.writeFile(reactManifest, '{"name":"react","version":"0.0.0"}\n', 'utf8');
      await expect(ensureProjectDependencies(projectRoot, { installMode: 'prebound-only' }))
        .resolves.toBeUndefined();
    }, 'engineering-compiler-runtime-prebound-package-closure-');
  });

  test('prebound dependency readiness rejects stale markers without mutation or spawn', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const nodeModulesRoot = path.join(projectRoot, 'node_modules');
      const nextPackageFile = path.join(nodeModulesRoot, 'next', 'package.json');
      const bindingPath = path.join(nodeModulesRoot, RUNTIME_DEPS_PREBOUND_BINDING_FILE);
      await fs.mkdir(path.dirname(nextPackageFile), { recursive: true });
      await fs.writeFile(nextPackageFile, '{"name":"next","version":"0.0.0"}\n', 'utf8');
      await fs.writeFile(bindingPath, JSON.stringify({
        formatVersion: 'runtime-deps-prebound-binding-v1',
        manifestHash: 'stale',
        unexpected: true
      }), 'utf8');
      const before = await fs.stat(nextPackageFile);
      const beforeBytes = await fs.readFile(nextPackageFile);
      let installCalls = 0;

      await expect(ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      })).rejects.toThrow('Plan-bound dependency tree is unavailable');

      await fs.rm(bindingPath, { force: true });
      await expect(ensureProjectDependencies(projectRoot, {
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'prebound-only',
        sharedDepsRoot: path.join(workspaceRoot, 'poison-shared-deps')
      })).rejects.toThrow('Plan-bound dependency tree is unavailable');

      const after = await fs.stat(nextPackageFile);
      expect(installCalls).toBe(0);
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      expect(await fs.readFile(nextPackageFile)).toEqual(beforeBytes);
    }, 'engineering-compiler-runtime-prebound-stale-');
  });

  test('links shared cache without copying when project deps are cold', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const runtimeSpec = await loadRuntimeDependencySpec();

      await ensureProjectBase(workspaceRoot);
      const { projectRoot } = getWorkspacePaths(workspaceRoot);

      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
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

  test('isolated dependency materialization fences a physical preinstalled tree without spawning', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      const sharedBinaryFile = path.join(sharedDepsRoot, 'node_modules', 'seed', 'cache.bin');
      await ensureProjectBase(workspaceRoot);
      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
      await fs.mkdir(path.dirname(sharedBinaryFile), { recursive: true });
      await fs.writeFile(sharedBinaryFile, new Uint8Array([0, 1, 127, 128, 255]));
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const sequence: string[] = [];
      const controller = new AbortController();
      const beforeCommit = async (): Promise<void> => {
        sequence.push('fence');
      };

      await ensureProjectDependencies(projectRoot, {
        beforeCommit,
        commandRunner: async () => {
          sequence.push('unexpected-spawn');
          return { code: 1, stdout: '', stderr: 'unexpected' };
        },
        installMode: 'offline-copy-only',
        rematerialize: true,
        sharedDepsRoot,
        signal: controller.signal,
        skipSharedDepsWarmup: true
      });

      expect(sequence).not.toContain('unexpected-spawn');
      expect(sequence.filter((entry) => entry === 'fence').length).toBeGreaterThanOrEqual(6);
      expect(await fs.readFile(
        path.join(projectRoot, 'node_modules', 'seed', 'cache.bin')
      )).toEqual(Buffer.from([0, 1, 127, 128, 255]));
      expect(await readRuntimeDepsStamp(path.join(projectRoot, '.runtime-deps.stamp.json')))
        .toMatchObject({ packageManager: 'bun' });
    }, 'engineering-compiler-runtime-isolated-fence-');
  });

  test('isolated dependency materialization stops during physical copy when its fence is lost', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const sharedDepsRoot = path.join(workspaceRoot, '.shared-deps');
      await ensureProjectBase(workspaceRoot);
      await installRuntimePackageManifestClosure(path.join(sharedDepsRoot, 'node_modules'));
      const { projectRoot } = getWorkspacePaths(workspaceRoot);
      const targetModulesRoot = path.join(projectRoot, 'node_modules');
      const targetPackageFile = path.join(targetModulesRoot, 'next', 'package.json');
      let installCalls = 0;
      const beforeCommit = async (): Promise<void> => {
        const rootExists = await fs.stat(targetModulesRoot).then(() => true, () => false);
        const fileExists = await fs.stat(targetPackageFile).then(() => true, () => false);
        if (rootExists && !fileExists) throw new Error('injected dependency materialization lease loss');
      };

      await expect(ensureProjectDependencies(projectRoot, {
        beforeCommit,
        commandRunner: async () => {
          installCalls += 1;
          return { code: 0, stdout: 'unexpected', stderr: '' };
        },
        installMode: 'offline-copy-only',
        rematerialize: true,
        sharedDepsRoot,
        skipSharedDepsWarmup: true
      })).rejects.toThrow('injected dependency materialization lease loss');

      expect(installCalls).toBe(0);
      await expect(fs.stat(targetPackageFile)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-runtime-isolated-fence-loss-');
  });
});
