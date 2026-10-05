import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import {
  importServiceRootFileNames,
  organizeImportsInSource
} from '../../src/adapters/self-hosting/development/import-normalization/kernel.ts';
import {
  compileImportOperationPlan,
  resolveCandidateImportBase,
  runImportCheck,
  runImportCheckWithPlan
} from '../../src/adapters/self-hosting/development/runner/import-organizer.ts';

function organizeFixtureImports(source: string, roots: 'full' | 'focused' = 'full'): string {
  const fixtureRoot = path.resolve(import.meta.dir, 'import-organizer-newline-fixture');
  const fileName = path.join(fixtureRoot, 'fixture.ts');
  const sources = new Map<string, string>([
    [fileName, source],
    [path.join(fixtureRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;'],
    [path.join(fixtureRoot, 'ambient.d.ts'), 'declare const ambientImportFixture: unique symbol;'],
    [path.join(fixtureRoot, 'unrelated.ts'), 'export const unrelated = true;']
  ]);
  const rootFileNames = roots === 'full'
    ? [...sources.keys()]
    : [...importServiceRootFileNames({ fileNames: [...sources.keys()] }, [fileName])];
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFileNames,
    getScriptVersion: () => '0',
    getScriptSnapshot: (requestedFileName) => {
      const content = sources.get(path.resolve(requestedFileName)) ?? ts.sys.readFile(requestedFileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCompilationSettings: () => ({
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022
    }),
    getCurrentDirectory: () => fixtureRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    readFile: (requestedFileName) => sources.get(path.resolve(requestedFileName)) ?? ts.sys.readFile(requestedFileName),
    fileExists: (requestedFileName) => sources.has(path.resolve(requestedFileName)) || ts.sys.fileExists(requestedFileName),
    getNewLine: () => '\n'
  };

  return organizeImportsInSource(ts.createLanguageService(host), fileName, source);
}

describe('import organizer selection', () => {
  test('exact config content controls plans across same-stat rewrites, errors and workspace switches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-import-config-'));
    try {
      const otherRoot = path.join(root, 'other');
      await mkdir(otherRoot);
      const firstConfig = '{"files":["alpha.ts"],"compilerOptions":{"noLib":true}}\n';
      const secondConfig = '{"files":["bravo.ts"],"compilerOptions":{"noLib":true}}\n';
      for (const workspace of [root, otherRoot]) {
        await writeFile(path.join(workspace, 'alpha.ts'), 'export const alpha = 1;\n');
        await writeFile(path.join(workspace, 'bravo.ts'), 'export const bravo = 2;\n');
      }
      const configPath = path.join(root, 'tsconfig.json');
      const fixedTime = new Date('2020-01-01T00:00:00.000Z');
      await writeFile(configPath, firstConfig);
      await utimes(configPath, fixedTime, fixedTime);
      const initialStat = await stat(configPath);
      const replaceSameStat = async (text: string): Promise<void> => {
        expect(Buffer.byteLength(text)).toBe(initialStat.size);
        await writeFile(configPath, text);
        await utimes(configPath, fixedTime, fixedTime);
        const observed = await stat(configPath);
        expect({ size: observed.size, mtimeMs: observed.mtimeMs })
          .toEqual({ size: initialStat.size, mtimeMs: initialStat.mtimeMs });
      };
      const plan = () => compileImportOperationPlan({ scope: 'all' }, root, {});
      const cold = await plan();
      expect(cold.targets.map((target) => target.relativePath)).toEqual(['alpha.ts']);
      expect(await plan()).toEqual(cold);

      await replaceSameStat(secondConfig);
      const changed = await plan();
      expect(changed.targets.map((target) => target.relativePath)).toEqual(['bravo.ts']);
      expect(changed.projectConfigDigest).not.toBe(cold.projectConfigDigest);

      await replaceSameStat(`!${firstConfig.slice(1)}`);
      await expect(plan()).rejects.toThrow();
      await expect(plan()).rejects.toThrow();
      await replaceSameStat(firstConfig);
      expect(await plan()).toEqual(cold);

      await writeFile(path.join(otherRoot, 'tsconfig.json'), secondConfig);
      expect(await compileImportOperationPlan({ scope: 'all' }, otherRoot, {})).toEqual(changed);
      expect(await plan()).toEqual(cold);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('language service roots contain only selected targets and project declarations', () => {
    const projectRoot = path.resolve(import.meta.dir, 'import-organizer-root-fixture');
    const target = path.join(projectRoot, 'target.ts');
    const declaration = path.join(projectRoot, 'ambient.d.ts');
    const moduleDeclaration = path.join(projectRoot, 'runtime.d.mts');
    const unrelated = path.join(projectRoot, 'unrelated.ts');

    expect(importServiceRootFileNames({
      fileNames: [unrelated, declaration, moduleDeclaration, target]
    }, [target], 'remove-unused')).toEqual([
      declaration,
      moduleDeclaration,
      target
    ].sort());
    expect(importServiceRootFileNames({
      fileNames: [unrelated, declaration, moduleDeclaration, target]
    }, [target])).toEqual([target]);

  });

  test('inherited config inputs stay current while root config bytes remain unchanged', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-import-extends-'));
    try {
      const rootConfig = '{"extends":"./base.json"}\n';
      const baseConfig = '{"files":["alpha.ts"],"compilerOptions":{"target":"ES2021","noLib":true}}\n';
      const configPath = path.join(root, 'tsconfig.json');
      const basePath = path.join(root, 'base.json');
      const fixedTime = new Date('2020-01-01T00:00:00.000Z');
      await writeFile(configPath, rootConfig);
      await writeFile(basePath, baseConfig);
      await utimes(basePath, fixedTime, fixedTime);
      await writeFile(path.join(root, 'alpha.ts'), 'export const alpha = 1;\n');
      await writeFile(path.join(root, 'bravo.ts'), 'export const bravo = 2;\n');
      const initialStat = await stat(basePath);
      const replaceBase = async (text: string): Promise<void> => {
        await writeFile(basePath, text);
        await utimes(basePath, fixedTime, fixedTime);
        const observed = await stat(basePath);
        expect({ size: observed.size, mtimeMs: observed.mtimeMs })
          .toEqual({ size: initialStat.size, mtimeMs: initialStat.mtimeMs });
        expect(await readFile(configPath, 'utf8')).toBe(rootConfig);
      };
      const plan = () => compileImportOperationPlan({ scope: 'all' }, root, {});
      const cold = await plan();
      expect(cold.targets.map((target) => target.relativePath)).toEqual(['alpha.ts']);
      await replaceBase(baseConfig.replace('alpha.ts', 'bravo.ts'));
      const changed = await plan();
      expect(changed.targets.map((target) => target.relativePath)).toEqual(['bravo.ts']);
      expect(changed.projectConfigDigest).not.toBe(cold.projectConfigDigest);
      await replaceBase(baseConfig.replace('alpha.ts', 'bravo.ts').replace('ES2021', 'ES2022'));
      const optionsChanged = await plan();
      expect(optionsChanged.targets).toEqual(changed.targets);
      expect(optionsChanged.projectConfigDigest).not.toBe(changed.projectConfigDigest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('candidate and full scopes compile different immutable exact plans', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-import-base-'));
    try {
      const git = (args: readonly string[]): string => {
        const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
      };
      git(['init', '--quiet']);
      git(['config', 'user.email', 'tests@example.com']);
      git(['config', 'user.name', 'SEC Tests']);
      await writeFile(path.join(repoRoot, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          target: 'ES2022'
        },
        include: ['**/*.ts']
      }, null, 2)}\n`);
      await writeFile(path.join(repoRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;\n');
      await writeFile(path.join(repoRoot, 'fixture.ts'), [
        "import { beta, alpha } from './values.ts';",
        'export const answer = alpha + beta;',
        ''
      ].join('\n'));
      git(['add', '--all']);
      git(['commit', '--quiet', '-m', 'initial']);
      const head = git(['rev-parse', 'HEAD']);
      git(['update-ref', 'refs/remotes/origin/main', head]);

      const candidate = await compileImportOperationPlan({}, repoRoot, {});
      expect(candidate.scope).toBe('candidate');
      expect(candidate.candidateBase).toBe(head);
      expect(candidate.targets).toEqual([]);
      expect(candidate.writePaths).toEqual([]);

      const fixturePath = path.join(repoRoot, 'fixture.ts');
      const originalBytes = await readFile(fixturePath);
      const originalStat = await stat(fixturePath);
      const observed = await runImportCheckWithPlan({}, repoRoot, {});
      expect(observed.plan.candidateBase).toBe(head);
      expect(observed.plan.scope).toBe('candidate');
      expect(observed.plan.intent).toBe('sort-and-combine');
      expect(observed.outcome.status).toBe('canonical');
      expect(await runImportCheck({}, repoRoot, {})).toEqual(observed.outcome);
      expect(await readFile(fixturePath)).toEqual(originalBytes);
      expect((await stat(fixturePath)).mtimeMs).toBe(originalStat.mtimeMs);

      const full = await compileImportOperationPlan({ scope: 'all' }, repoRoot, {});
      expect(full.scope).toBe('all');
      expect(full.candidateBase).toBeNull();
      expect(full.writePaths).toEqual(['fixture.ts']);
      expect(full.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      const fullCheck = await runImportCheckWithPlan({ scope: 'all', intent: 'remove-unused' }, repoRoot, {});
      expect(fullCheck.plan.candidateBase).toBeNull();
      expect(fullCheck.plan.scope).toBe('all');
      expect(fullCheck.plan.intent).toBe('remove-unused');
      // Every import is used: remove-unused does not also sort/combine.
      expect(fullCheck.outcome.status).toBe('canonical');
      expect(await readFile(fixturePath)).toEqual(originalBytes);
      expect((await stat(fixturePath)).mtimeMs).toBe(originalStat.mtimeMs);

      await writeFile(path.join(repoRoot, 'fixture.ts'), [
        "import { beta, alpha } from './values.ts';",
        'export const answer = alpha + beta;',
        'export const changed = answer;',
        ''
      ].join('\n'));
      const changed = await compileImportOperationPlan({}, repoRoot, {});
      expect(changed.targets.map((target) => target.relativePath)).toEqual(['fixture.ts']);
      expect(changed.writePaths).toEqual(['fixture.ts']);
      expect((await compileImportOperationPlan({}, repoRoot, {})).planDigest)
        .toBe(changed.planDigest);

      expect(() => resolveCandidateImportBase(repoRoot, 'a'.repeat(40), {}))
        .toThrow('git rev-parse failed');
      expect(() => resolveCandidateImportBase(repoRoot, head, { SEC_CHANGED_BASE: 'b'.repeat(40) }))
        .toThrow('Candidate import base conflicts with the exact ambient verification base');
      await expect(compileImportOperationPlan({ scope: 'all', candidateBase: head }, repoRoot, {}))
        .rejects.toThrow('Full-repository import scope cannot also select a candidate base');

      git(['update-ref', '-d', 'refs/remotes/origin/main']);
      expect(() => resolveCandidateImportBase(repoRoot, undefined, {}))
        .toThrow('Candidate import base is unavailable');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('import organizer newline preservation', () => {
  test('focused roots produce the same import bytes as the complete project roots', () => {
    const unsorted = [
      "import { beta, alpha } from './values.ts';",
      '',
      'export const answer = alpha + beta;',
      ''
    ].join('\n');

    expect(organizeFixtureImports(unsorted, 'focused')).toBe(organizeFixtureImports(unsorted, 'full'));
  });

  for (const newLine of ['\n', '\r\n'] as const) {
    test(`keeps ${newLine === '\n' ? 'LF' : 'CRLF'} files stable and preserves the body when imports reorder`, () => {
      const sortedImports = [
        'import {',
        '  alpha,',
        '  beta',
        "} from './values.ts';"
      ].join(newLine);
      const body = [
        '',
        '',
        'const answer = alpha + beta;',
        'export { answer };',
        ''
      ].join(newLine);
      const sortedSource = `${sortedImports}${body}`;
      expect(organizeFixtureImports(sortedSource)).toBe(sortedSource);

      const unsortedImports = [
        'import {',
        '  beta,',
        '  alpha',
        "} from './values.ts';"
      ].join(newLine);
      const unsortedSource = `${unsortedImports}${body}`;
      const reordered = organizeFixtureImports(unsortedSource);

      expect(reordered).toBe(sortedSource);
    });
  }
});
