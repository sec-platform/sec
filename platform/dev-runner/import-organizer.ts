import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import ts from 'typescript';

import { compilerRoot, relativePosixPath } from '../shared/paths.ts';

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

function applyTextChanges(source: string, changes: readonly ts.TextChange[]): string {
  return [...changes]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((updated, change) => (
      `${updated.slice(0, change.span.start)}${change.newText}${updated.slice(change.span.start + change.span.length)}`
    ), source);
}

function changedTypeScriptFiles(): Set<string> | null {
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD^1', 'HEAD'], {
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
  if (process.env.PJC_IMPORTS_CHANGED_ONLY !== '1') {
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
  const fileNames = selectedFileNames(config);
  if (fileNames.length === 0) {
    console.log('No TypeScript import targets selected.');
    return 0;
  }

  const files = new Map<string, { version: number; content: string }>(
    await Promise.all(fileNames.map(async (fileName): Promise<[string, { version: number; content: string }]> => [
      fileName,
      {
        version: 0,
        content: await fs.readFile(fileName, 'utf8')
      }
    ]))
  );
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
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

  for (const fileName of fileNames) {
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
