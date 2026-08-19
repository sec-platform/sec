import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import {
  compileImportOperationPlanV1,
  importServiceRootFileNames,
  organizeImportsInSource,
  resolveCandidateImportBase
} from '../../platform/dev-runner/import-organizer.ts';

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
  test('language service roots contain only selected targets and project declarations', () => {
    const projectRoot = path.resolve(import.meta.dir, 'import-organizer-root-fixture');
    const target = path.join(projectRoot, 'target.ts');
    const declaration = path.join(projectRoot, 'ambient.d.ts');
    const moduleDeclaration = path.join(projectRoot, 'runtime.d.mts');
    const unrelated = path.join(projectRoot, 'unrelated.ts');

    expect(importServiceRootFileNames({
      fileNames: [unrelated, declaration, moduleDeclaration, target]
    }, [target])).toEqual([
      declaration,
      moduleDeclaration,
      target
    ].sort());

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

      const candidate = await compileImportOperationPlanV1({}, repoRoot, {});
      expect(candidate.scope).toBe('candidate');
      expect(candidate.candidateBase).toBe(head);
      expect(candidate.targets).toEqual([]);
      expect(candidate.writePaths).toEqual([]);

      const full = await compileImportOperationPlanV1({ scope: 'all' }, repoRoot, {});
      expect(full.scope).toBe('all');
      expect(full.candidateBase).toBeNull();
      expect(full.writePaths).toEqual(['fixture.ts']);
      expect(full.planDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);

      await writeFile(path.join(repoRoot, 'fixture.ts'), [
        "import { beta, alpha } from './values.ts';",
        'export const answer = alpha + beta;',
        'export const changed = answer;',
        ''
      ].join('\n'));
      const changed = await compileImportOperationPlanV1({}, repoRoot, {});
      expect(changed.targets.map((target) => target.relativePath)).toEqual(['fixture.ts']);
      expect(changed.writePaths).toEqual(['fixture.ts']);
      expect((await compileImportOperationPlanV1({}, repoRoot, {})).planDigest)
        .toBe(changed.planDigest);

      expect(() => resolveCandidateImportBase(repoRoot, 'a'.repeat(40), {}))
        .toThrow('git rev-parse failed');
      expect(() => resolveCandidateImportBase(repoRoot, head, { SEC_CHANGED_BASE: 'b'.repeat(40) }))
        .toThrow('Candidate import base conflicts with the exact ambient verification base');
      await expect(compileImportOperationPlanV1({ scope: 'all', candidateBase: head }, repoRoot, {}))
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
      expect(reordered.slice(sortedImports.length)).toBe(body);
      if (newLine === '\r\n') {
        expect(reordered.replaceAll('\r\n', '')).not.toContain('\n');
      }
    });
  }
});
