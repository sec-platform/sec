import path from 'node:path';
import ts from 'typescript';

import {
  canonicalEquals,
  rawSha256
} from '../../system-architecture/foundation/runtime/canonical.ts';

/**
 * Pure TypeScript import-normalization kernel. Snapshot and publication
 * adapters belong to their respective runtime/runner owners; both consume
 * this one compiler implementation and therefore cannot drift semantically.
 */
export type ImportTransformIntent = 'sort-and-combine' | 'remove-unused';

export type ImportCheckOutcome = Readonly<{
  schema: 'sec-import-check-outcome-v1';
  status: 'canonical' | 'needs-import-transform';
  files: readonly string[];
}>;

export type ImmutableImportSnapshotFile = Readonly<{
  relativePath: string;
  source: string;
  contentDigest: `sha256:${string}`;
}>;

export type ImmutableImportSnapshotInputRef = Readonly<{
  path: string;
  digest: `sha256:${string}`;
}>;

export type ImportSourceSnapshot = Readonly<{
  relativePath: string;
  absolutePath: string;
  bytes: Buffer;
  text: string;
}>;

export type NormalizedImportSnapshot = Readonly<{
  source: ImportSourceSnapshot;
  replacementBytes: Buffer;
}>;

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

const importPreferences: ts.UserPreferences = { quotePreference: 'single' };

function sourceNewLine(source: string): '\n' | '\r\n' {
  const firstLineFeed = source.indexOf('\n');
  return firstLineFeed > 0 && source[firstLineFeed - 1] === '\r' ? '\r\n' : '\n';
}

function isSameFilePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function applyTextChanges(source: string, changes: readonly ts.TextChange[]): string {
  return [...changes]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((updated, change) => (
      `${updated.slice(0, change.span.start)}${change.newText}${updated.slice(change.span.start + change.span.length)}`
    ), source);
}

export function organizeImportsInSource(
  service: Pick<ts.LanguageService, 'organizeImports'>,
  fileName: string,
  source: string,
  intent: ImportTransformIntent = 'sort-and-combine'
): string {
  const mode = intent === 'remove-unused'
    ? ts.OrganizeImportsMode.RemoveUnused
    : ts.OrganizeImportsMode.SortAndCombine;
  const edits = service
    .organizeImports(
      { type: 'file', fileName, mode },
      { ...importFormatOptions, newLineCharacter: sourceNewLine(source) },
      importPreferences
    )
    .flatMap((change) => isSameFilePath(change.fileName, fileName) ? change.textChanges : []);
  return applyTextChanges(source, edits);
}

function isTypeScriptDeclarationPath(value: string): boolean {
  return /\.d\.[cm]?ts$/iu.test(value);
}

function isTypeScriptPath(value: string): boolean {
  return /\.[cm]?tsx?$/iu.test(value);
}

export function importServiceRootFileNames(
  config: Pick<ts.ParsedCommandLine, 'fileNames'>,
  targetFileNames: readonly string[]
): readonly string[] {
  const roots = new Set(targetFileNames.map((fileName) => path.resolve(fileName)));
  for (const fileName of config.fileNames) {
    if (isTypeScriptDeclarationPath(fileName)) roots.add(path.resolve(fileName));
  }
  return Object.freeze([...roots].sort());
}

function createImportService(
  config: ts.ParsedCommandLine,
  projectRoot: string,
  projectFileNames: readonly string[],
  files: Map<string, { version: number; content: string }>,
  immutableRepositoryFiles?: ReadonlyMap<string, string>
): ts.LanguageService {
  const repositoryRoot = path.resolve(projectRoot);
  const repositoryContains = (fileName: string): boolean => {
    const relative = path.relative(repositoryRoot, path.resolve(fileName));
    return relative === '' || (!path.isAbsolute(relative)
      && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  };
  const immutableSource = (fileName: string): string | undefined =>
    immutableRepositoryFiles?.get(path.resolve(fileName));
  const readSource = (fileName: string): string | undefined => {
    const edited = files.get(path.resolve(fileName))?.content;
    if (edited !== undefined) return edited;
    const immutable = immutableSource(fileName);
    if (immutable !== undefined) return immutable;
    return immutableRepositoryFiles !== undefined && repositoryContains(fileName)
      ? undefined
      : ts.sys.readFile(fileName);
  };
  const sourceExists = (fileName: string): boolean =>
    files.has(path.resolve(fileName))
    || immutableSource(fileName) !== undefined
    || (immutableRepositoryFiles !== undefined && repositoryContains(fileName)
      ? false
      : ts.sys.fileExists(fileName));
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [...projectFileNames],
    getScriptVersion: (fileName) => `${files.get(path.resolve(fileName))?.version ?? 0}`,
    getScriptSnapshot: (fileName) => {
      const content = readSource(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCompilationSettings: () => config.options,
    getCurrentDirectory: () => projectRoot,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    readFile: readSource,
    fileExists: sourceExists,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => '\n'
  };
  return ts.createLanguageService(host);
}

export function normalizeImportSnapshots(
  config: ts.ParsedCommandLine,
  projectRoot: string,
  sources: readonly ImportSourceSnapshot[],
  intent: ImportTransformIntent = 'sort-and-combine',
  immutableRepositoryFiles?: ReadonlyMap<string, string>
): readonly NormalizedImportSnapshot[] {
  const ordered = [...sources].sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  if (new Set(ordered.map((source) => source.relativePath)).size !== ordered.length) {
    throw new Error('Import normalization received duplicate repository paths');
  }
  const serviceFiles = new Map<string, { version: number; content: string }>(
    ordered.map((source) => [source.absolutePath, { version: 0, content: source.text }])
  );
  const service = createImportService(
    config,
    projectRoot,
    importServiceRootFileNames(config, ordered.map((source) => source.absolutePath)),
    serviceFiles,
    immutableRepositoryFiles
  );
  try {
    return Object.freeze(ordered.map((source) => Object.freeze({
      source,
      replacementBytes: Buffer.from(
        organizeImportsInSource(service, source.absolutePath, source.text, intent),
        'utf8'
      )
    })));
  } finally {
    service.dispose();
  }
}

function canonicalRepositoryPath(projectRoot: string, relativePath: string): string {
  if (relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`Immutable import snapshot path is not repository-relative: ${relativePath}`);
  }
  const segments = relativePath.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Immutable import snapshot path is not canonical: ${relativePath}`);
  }
  const absolutePath = path.resolve(projectRoot, ...segments);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === '' || path.isAbsolute(relative) || relative === '..'
      || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Immutable import snapshot path escapes the repository: ${relativePath}`);
  }
  return absolutePath;
}

function formatDiagnostic(diagnostic: ts.Diagnostic, projectRoot: string): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) return message;
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relative = path.relative(projectRoot, diagnostic.file.fileName).replaceAll('\\', '/');
  return `${relative}:${position.line + 1}:${position.character + 1} ${message}`;
}

export function checkImmutableImportSnapshot(input: Readonly<{
  projectRoot: string;
  files: readonly ImmutableImportSnapshotFile[];
  targetPaths: readonly string[];
  expectedInputClosure: readonly ImmutableImportSnapshotInputRef[];
}>): ImportCheckOutcome {
  const projectRoot = path.resolve(input.projectRoot);
  const ordered = [...input.files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath));
  const immutableFiles = new Map<string, string>();
  for (const file of ordered) {
    const absolutePath = canonicalRepositoryPath(projectRoot, file.relativePath);
    if (immutableFiles.has(absolutePath)) {
      throw new Error(`Immutable import snapshot contains duplicate path: ${file.relativePath}`);
    }
    if (rawSha256(file.source) !== file.contentDigest) {
      throw new Error(`Immutable import snapshot digest differs from its bytes: ${file.relativePath}`);
    }
    immutableFiles.set(absolutePath, file.source);
  }
  const observedInputClosure = ordered.map(({ relativePath, contentDigest }) => ({
    path: relativePath,
    digest: contentDigest
  }));
  if (!canonicalEquals(observedInputClosure, input.expectedInputClosure)) {
    throw new Error('Immutable import observation closure differs from its Action input closure');
  }
  const configPath = path.join(projectRoot, 'tsconfig.json');
  const configSource = immutableFiles.get(configPath);
  if (configSource === undefined) {
    throw new Error('Immutable import snapshot has no exact tsconfig.json bytes');
  }
  const configFile = ts.parseConfigFileTextToJson(configPath, configSource);
  if (configFile.error !== undefined) throw new Error(formatDiagnostic(configFile.error, projectRoot));
  const sourcePaths = ordered
    .filter(({ relativePath }) => isTypeScriptPath(relativePath))
    .map(({ relativePath }) => canonicalRepositoryPath(projectRoot, relativePath));
  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists: (fileName) => immutableFiles.has(path.resolve(fileName))
      || (!path.resolve(fileName).startsWith(`${projectRoot}${path.sep}`) && ts.sys.fileExists(fileName)),
    readFile: (fileName) => immutableFiles.get(path.resolve(fileName))
      ?? (!path.resolve(fileName).startsWith(`${projectRoot}${path.sep}`) ? ts.sys.readFile(fileName) : undefined),
    readDirectory: () => sourcePaths
  };
  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    parseHost,
    projectRoot,
    undefined,
    configPath
  );
  if (config.errors.length > 0) {
    throw new Error(config.errors.map((diagnostic) => formatDiagnostic(diagnostic, projectRoot)).join('\n'));
  }
  const sourceByPath = new Map(ordered.map((file) => [file.relativePath, file]));
  const sources = [...input.targetPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((relativePath): ImportSourceSnapshot => {
      if (!isTypeScriptPath(relativePath)) {
        throw new Error(`Immutable import target is not TypeScript: ${relativePath}`);
      }
      const file = sourceByPath.get(relativePath);
      if (file === undefined) {
        throw new Error(`Immutable import target is absent from the exact snapshot: ${relativePath}`);
      }
      return Object.freeze({
        relativePath: file.relativePath,
        absolutePath: canonicalRepositoryPath(projectRoot, file.relativePath),
        bytes: Buffer.from(file.source, 'utf8'),
        text: file.source
      });
    });
  const normalized = normalizeImportSnapshots(
    config,
    projectRoot,
    sources,
    'sort-and-combine',
    immutableFiles
  );
  const files = Object.freeze(normalized
    .filter(({ source, replacementBytes }) => !replacementBytes.equals(source.bytes))
    .map(({ source }) => source.relativePath));
  return Object.freeze({
    schema: 'sec-import-check-outcome-v1',
    status: files.length === 0 ? 'canonical' : 'needs-import-transform',
    files
  });
}
