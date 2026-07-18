import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import {
  changedTypeScriptFiles,
  organizeImportsInSource,
  resolveImportDiffBase,
  selectChangedImportsOnly
} from '../../platform/dev-runner/import-organizer.ts';

function organizeFixtureImports(source: string): string {
  const fixtureRoot = path.resolve(import.meta.dir, 'import-organizer-newline-fixture');
  const fileName = path.join(fixtureRoot, 'fixture.ts');
  const sources = new Map<string, string>([
    [fileName, source],
    [path.join(fixtureRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;']
  ]);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...sources.keys()],
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
  test('explicit changed-only setting overrides CI context', () => {
    expect(selectChangedImportsOnly({ SEC_IMPORTS_CHANGED_ONLY: '1' })).toBe(true);
    expect(selectChangedImportsOnly({
      SEC_IMPORTS_CHANGED_ONLY: '0',
      SEC_CHANGED_BASE: 'abc123',
      CI: 'true',
      GITHUB_EVENT_NAME: 'repository_dispatch'
    })).toBe(false);
  });

  test('an explicit diff base selects changed files for repository dispatch', () => {
    expect(selectChangedImportsOnly({
      SEC_CHANGED_BASE: 'abc123',
      CI: 'true',
      GITHUB_EVENT_NAME: 'repository_dispatch'
    })).toBe(true);
  });

  test('pull request CI checks changed files while a schedule without a base remains global', () => {
    expect(selectChangedImportsOnly({
      CI: 'true',
      GITHUB_EVENT_NAME: 'pull_request'
    })).toBe(true);
    expect(selectChangedImportsOnly({
      CI: 'true',
      GITHUB_EVENT_NAME: 'schedule'
    })).toBe(false);
    expect(selectChangedImportsOnly({})).toBe(false);
  });

  test('diff base prefers explicit base, then pull request base branch, then previous commit', () => {
    expect(resolveImportDiffBase({
      SEC_CHANGED_BASE: 'abc123',
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main'
    })).toBe('abc123');
    expect(resolveImportDiffBase({
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main'
    })).toBe('origin/main');
    expect(resolveImportDiffBase({})).toBe('HEAD^1');
  });

  test('invalid changed-only bases fail closed instead of selecting the full repository', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-import-base-'));
    try {
      const git = (args: readonly string[]) => {
        const result = spawnSync('git', [...args], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
        if (result.status !== 0) throw new Error(result.stderr);
      };
      git(['init', '--quiet']);
      git(['config', 'user.email', 'tests@example.com']);
      git(['config', 'user.name', 'SEC Tests']);
      await writeFile(path.join(repoRoot, 'fixture.ts'), 'export const fixture = true;\n');
      git(['add', 'fixture.ts']);
      git(['commit', '--quiet', '-m', 'initial']);

      expect(() => changedTypeScriptFiles(repoRoot, { SEC_CHANGED_BASE: 'missing-base' }))
        .toThrow('Import diff base is invalid: missing-base');
      try {
        changedTypeScriptFiles(repoRoot, { SEC_CHANGED_BASE: 'missing-base' });
        throw new Error('expected invalid import base');
      } catch (error) {
        expect(error).toMatchObject({ code: 'IMPORT-AUTHORITY-003' });
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('import organizer newline preservation', () => {
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
