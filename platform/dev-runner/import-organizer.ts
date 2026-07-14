import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import ts from 'typescript';

import { compilerRoot, relativePosixPath } from '../shared/paths.ts';

type ImportSelectionEnvironment = Record<string, string | undefined>;

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${relativePosixPath(compilerRoot, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
}

function loadProjectConfig(): ts.ParsedCommandLine {
  const configPath = ts.findConfigFile(compilerRoot, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) {
    throw new Error('tsconfig.json not found');
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(formatDiagnostic(configFile.error));
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, compilerRoot, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(formatDiagnostic).join('\n'));
  }

  return parsed;
}

const importFormatOptions: ts.FormatCodeSettings = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  indentStyle: ts.IndentStyle.Smart,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
  insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
  insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  placeOpenBraceOnNewLineForControlBlocks: false,
  placeOpenBraceOnNewLineForFunctions: false,
  semicolons: ts.SemicolonPreference.Insert
};

const importPreferences: ts.UserPreferences = {
  quotePreference: 'single'
};

function sourceNewLine(source: string): '\n' | '\r\n' {
  const firstLineFeed = source.indexOf('\n');
  return firstLineFeed > 0 && source[firstLineFeed - 1] === '\r' ? '\r\n' : '\n';
}

function normalizeNewLines(value: string, newLine: '\n' | '\r\n'): string {
  return value.replace(/\r\n?|\n/gu, newLine);
}

function applyTextChanges(source: string, changes: readonly ts.TextChange[]): string {
  const newLine = sourceNewLine(source);
  return [...changes]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((updated, change) => (
      `${updated.slice(0, change.span.start)}${normalizeNewLines(change.newText, newLine)}${updated.slice(change.span.start + change.span.length)}`
    ), source);
}

export function applyImportTextChangesForTests(source: string, changes: readonly ts.TextChange[]): string {
  return applyTextChanges(source, changes);
}

export function selectChangedImportsOnly(env: ImportSelectionEnvironment = process.env): boolean {
  if (env.SEC_IMPORTS_CHANGED_ONLY === '1') return true;
  if (env.SEC_IMPORTS_CHANGED_ONLY === '0') return false;
  return env.CI === 'true' && env.GITHUB_EVENT_NAME === 'pull_request';
}

export function resolveImportDiffBase(env: ImportSelectionEnvironment = process.env): string {
  if (env.SEC_CHANGED_BASE) return env.SEC_CHANGED_BASE;
  if (env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_BASE_REF) {
    return `origin/${env.GITHUB_BASE_REF}`;
  }
  return 'HEAD^1';
}

function changedTypeScriptFiles(env: ImportSelectionEnvironment = process.env): Set<string> | null {
  const baseRef = resolveImportDiffBase(env);
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', baseRef, 'HEAD'], {
    cwd: compilerRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return null;
  }

  return new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/\\/g, '/'))
      .filter((line) => /\.[cm]?tsx?$/u.test(line))
  );
}

function selectedFileNames(config: ts.ParsedCommandLine): string[] {
  if (!selectChangedImportsOnly()) {
    return config.fileNames;
  }

  const changedFiles = changedTypeScriptFiles();
  if (!changedFiles) {
    return config.fileNames;
  }

  return config.fileNames.filter((fileName) => changedFiles.has(relativePosixPath(compilerRoot, fileName)));
}

export async function runImportOrganizer(options: { check: boolean }): Promise<number> {
  const config = loadProjectConfig();
  const projectFileNames = config.fileNames;
  const targetFileNames = selectedFileNames(config);
  if (targetFileNames.length === 0) {
    console.log('No TypeScript import targets selected.');
    return 0;
  }

  const files = new Map<string, { version: number; content: string }>(
    await Promise.all(targetFileNames.map(async (fileName): Promise<[string, { version: number; content: string }]> => [
      fileName,
      {
        version: 0,
        content: await fs.readFile(fileName, 'utf8')
      }
    ]))
  );
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => projectFileNames,
    getScriptVersion: (fileName) => `${files.get(fileName)?.version ?? 0}`,
    getScriptSnapshot: (fileName) => {
      const file = files.get(fileName);
      const content = file?.content ?? ts.sys.readFile(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCompilationSettings: () => config.options,
    getCurrentDirectory: () => compilerRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    readFile: ts.sys.readFile,
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n'
  };
  const service = ts.createLanguageService(host);
  const changedFiles: string[] = [];

  for (const fileName of targetFileNames) {
    const file = files.get(fileName);
    if (!file) {
      continue;
    }

    const edits = service
      .organizeImports(
        { type: 'file', fileName, mode: ts.OrganizeImportsMode.All },
        importFormatOptions,
        importPreferences
      )
      .flatMap((change) => change.fileName === fileName ? change.textChanges : []);
    if (edits.length === 0) {
      continue;
    }

    const updated = applyTextChanges(file.content, edits);
    if (updated === file.content) {
      continue;
    }

    changedFiles.push(relativePosixPath(compilerRoot, fileName));
    if (!options.check) {
      await fs.writeFile(fileName, updated, 'utf8');
      file.content = updated;
      file.version += 1;
    }
  }

  if (changedFiles.length === 0) {
    console.log('Imports are organized.');
    return 0;
  }

  const fileList = changedFiles.map((fileName) => `- ${fileName}`).join('\n');
  if (options.check) {
    console.error(`Imports need organizing in ${changedFiles.length} file(s):\n${fileList}\nRun bun run imports:organize.`);
    return 1;
  }

  console.log(`Organized imports in ${changedFiles.length} file(s):\n${fileList}`);
  return 0;
}
