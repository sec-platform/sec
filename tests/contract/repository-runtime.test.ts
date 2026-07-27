import { describe, expect, test } from 'bun:test';

import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

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
    expect(scripts['hooks:install']).toBe('bun ./scripts/install-git-hooks.ts');
    expect(scripts.postinstall).toBe('bun ./scripts/install-git-hooks.ts --lifecycle');

    expect(scripts.depcruise).toBe('bunx --bun dependency-cruiser@17.3.10 "platform/**/*.ts" --config .dependency-cruiser.json');
    expect(scripts.jscpd).toBe('bunx --bun jscpd@4.0.9 platform/ scripts/ -o report/jscpd --reporters html,console,json --format typescript,javascript --ignore "**/node_modules/**,**/dist/**,**/*.test.ts,**/*.d.ts,**/upgrade/**,.tmp/**" --min-lines 5 --min-tokens 50 --absolute');
    expect(scripts.discover).toBe('bun scripts/discover-all.ts --json --output report/discover.json');
    expect(scripts['gitnexus:analyze']).toBe('gitnexus analyze --skip-agents-md --no-stats');
    expect(scripts['gitnexus:status']).toBe('gitnexus status');
    expect(scripts['gitnexus:mcp']).toBeUndefined();
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

  test('retired MCP entrypoints stay absent while CLI analysis remains available', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(await Bun.file('.mcp.json').exists()).toBe(false);
    expect(scripts['gitnexus:mcp']).toBeUndefined();
    expect(scripts['gitnexus:analyze']).toBeDefined();
    expect(scripts['gitnexus:status']).toBeDefined();
    expect(scripts.graphify).toBeDefined();
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

});

describe('developer contract entrypoints', () => {
  test('contract scripts bypass dev-runner', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts['test:budget']).not.toContain('dev-runner');
    expect(scripts['test:benchmark-contract']).not.toContain('dev-runner');
    expect(scripts['reference:check']).not.toContain('reference-clean');
  });
});
