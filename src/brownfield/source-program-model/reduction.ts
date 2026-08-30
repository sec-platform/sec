import { createTwoFilesPatch } from 'diff';
import nodePath from 'node:path';
import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramSpan
} from './contract.ts';

export interface SourceProgramRenameLocation {
  readonly path: string;
  readonly span: SourceProgramSpan;
  readonly prefixText: string;
  readonly suffixText: string;
}

export interface SourceProgramVersionSuffixReduction {
  readonly status: 'ready' | 'blocked';
  readonly currentName: string;
  readonly proposedName: string;
  readonly declarationPaths: readonly string[];
  readonly locations: readonly SourceProgramRenameLocation[];
  readonly reason: string | null;
}

export interface SourceProgramVersionSuffixReductionPlan {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly reductions: readonly SourceProgramVersionSuffixReduction[];
}

export interface SourceProgramVersionSuffixReductionPatch {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    path: string;
    beforeDigest: string;
    afterDigest: string;
  }>[];
}

export interface SourceProgramUnusedSymbolEvidence {
  readonly path: string;
  readonly name: string;
  readonly provider: 'knip';
  readonly providerRevision: string;
}

export interface SourceProgramGraphCutReduction {
  readonly status: 'ready' | 'blocked';
  readonly path: string;
  readonly name: string;
  readonly removalSpan: SourceProgramSpan | null;
  readonly reason: string | null;
}

export interface SourceProgramGraphCutReductionPlan {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly evidenceDigest: string;
  readonly reductions: readonly SourceProgramGraphCutReduction[];
}

export interface SourceProgramAggregateImportReduction {
  readonly status: 'ready' | 'blocked';
  readonly path: string;
  readonly moduleSpecifier: string;
  readonly statementSpan: SourceProgramSpan;
  readonly replacementText: string | null;
  readonly targetPaths: readonly string[];
  readonly reason: string | null;
}

export interface SourceProgramAggregateImportReductionPlan {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly reductions: readonly SourceProgramAggregateImportReduction[];
}

export interface SourceProgramAggregateImportReductionPatch {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    path: string;
    beforeDigest: string;
    afterDigest: string;
  }>[];
}

const VERSIONED_DECLARATION_NAME = /^(.*?)(?:_?V)([1-9][0-9]*)$/u;

function spanFor(sourceFile: ts.SourceFile, start: number, end: number): SourceProgramSpan {
  const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
  const endLocation = sourceFile.getLineAndCharacterOfPosition(end);
  return Object.freeze({
    start,
    end,
    startLine: startLocation.line + 1,
    startColumn: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1
  });
}

function declarationNamePosition(
  sourceFile: ts.SourceFile,
  name: string,
  declarationSpan: SourceProgramSpan
): number | null {
  let position: number | null = null;
  const visit = (node: ts.Node): void => {
    if (position !== null || node.getStart(sourceFile, false) > declarationSpan.end
      || node.getEnd() < declarationSpan.start) return;
    const named = node as ts.NamedDeclaration;
    if (named.name && ts.isIdentifier(named.name) && named.name.text === name
      && node.getStart(sourceFile, false) === declarationSpan.start
      && node.getEnd() === declarationSpan.end) {
      position = named.name.getStart(sourceFile, false);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return position;
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isOmittedExpression(element)
    ? []
    : bindingNames(element.name));
}

function sourceFileHasTopLevelBinding(
  sourceFile: ts.SourceFile,
  name: string,
  exceptImport: ts.ImportSpecifier
): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name?.text === name) return true;
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
        return true;
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)
          && bindings.elements.some((element) => element !== exceptImport && element.name.text === name)) {
        return true;
      }
      continue;
    }
    if (ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) =>
          bindingNames(declaration.name).includes(name))) return true;
    const declarationName = (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) ? statement.name : undefined;
    if (declarationName !== undefined && ts.isIdentifier(declarationName)
        && declarationName.text === name) {
      return true;
    }
  }
  return false;
}

function graphCutNode(
  sourceFile: ts.SourceFile,
  name: string,
  declarationSpan: SourceProgramSpan
): ts.Node | null {
  let match: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (match !== null || node.getStart(sourceFile, false) > declarationSpan.end
      || node.getEnd() < declarationSpan.start) return;
    const named = node as ts.NamedDeclaration;
    if (named.name && ts.isIdentifier(named.name) && named.name.text === name
      && node.getStart(sourceFile, false) === declarationSpan.start
      && node.getEnd() === declarationSpan.end) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function graphCutRemovalNode(node: ts.Node): ts.Node | null {
  if (ts.isVariableDeclaration(node)) {
    const list = node.parent;
    const statement = list?.parent;
    return ts.isVariableDeclarationList(list)
      && list.declarations.length === 1
      && statement !== undefined
      && ts.isVariableStatement(statement)
      && ts.isSourceFile(statement.parent)
      ? statement
      : null;
  }
  return (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isModuleDeclaration(node)
  ) && ts.isSourceFile(node.parent)
    ? node
    : null;
}

function graphCutRemovalSpan(sourceFile: ts.SourceFile, node: ts.Node): SourceProgramSpan {
  const tokenStart = node.getStart(sourceFile, false);
  const lineStart = sourceFile.text.lastIndexOf('\n', Math.max(0, tokenStart - 1)) + 1;
  const start = /^\s*$/u.test(sourceFile.text.slice(lineStart, tokenStart))
    ? lineStart
    : tokenStart;
  let end = node.getEnd();
  if (sourceFile.text.startsWith('\r\n', end)) end += 2;
  else if (sourceFile.text[end] === '\n' || sourceFile.text[end] === '\r') end += 1;
  return spanFor(sourceFile, start, end);
}

function relativeModuleSpecifier(fromPath: string, targetPath: string): string {
  const relative = nodePath.posix.relative(nodePath.posix.dirname(fromPath), targetPath);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Resolve broad barrel imports through the compiler-owned symbol graph. The
 * plan never guesses a public path: each imported/exported binding must map to
 * one exact exported declaration. Filesystem segment names do not declare
 * semantic visibility; TypeScript's exported symbol graph does.
 */
export function compileSourceProgramAggregateImportReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[]
): SourceProgramAggregateImportReductionPlan {
  const sourceByPath = new Map(files.map(({ path, source }) => [path, source] as const));
  const declarationById = new Map(model.declarations.map((declaration) =>
    [declaration.observationId, declaration] as const));
  const moduleByPath = new Map(model.files.map((file) => [file.path, file.moduleId] as const));
  const referencesByPath = new Map<string, SourceProgramModel['references'][number][]>();
  for (const reference of model.references) {
    const current = referencesByPath.get(reference.path) ?? [];
    current.push(reference);
    referencesByPath.set(reference.path, current);
  }
  const reductions: SourceProgramAggregateImportReduction[] = [];
  for (const [path, source] of sourceByPath) {
    if (!/\.[cm]?[jt]sx?$/iu.test(path)) continue;
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true);
    for (const statement of sourceFile.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteralLike(statement.moduleSpecifier)
          || !/(?:^|\/)index\.[cm]?[jt]sx?$/u.test(statement.moduleSpecifier.text)) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      const bindings = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings !== undefined
          && ts.isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements
          : null
        : statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements
          : null;
      const statementReferences = (referencesByPath.get(path) ?? []).filter((reference) =>
        reference.moduleSpecifier === moduleSpecifier
        && reference.span.start >= statement.getStart(sourceFile, false)
        && reference.span.end <= statement.getEnd());
      const sourceModuleId = moduleByPath.get(path) ?? null;
      const importedModuleIds = new Set(statementReferences
        .map(({ targetPath }) => targetPath === null ? null : moduleByPath.get(targetPath) ?? null)
        .filter((moduleId): moduleId is string => moduleId !== null));
      if (sourceModuleId !== null && importedModuleIds.size === 1
          && importedModuleIds.has(sourceModuleId)) continue;
      const resolved = new Map<string, { targetPath: string; text: string }[]>();
      let reason: string | null = bindings === null
        ? 'aggregate default, namespace, side-effect, or star imports require an explicit owner surface'
        : null;
      if (bindings !== null) {
        for (const binding of bindings) {
          const reference = statementReferences.find((candidate) =>
            candidate.span.start >= binding.getStart(sourceFile, false)
            && candidate.span.end <= binding.getEnd());
          const declaration = reference?.targetObservationId === null
            || reference?.targetObservationId === undefined
            ? undefined
            : declarationById.get(reference.targetObservationId);
          if (declaration === undefined || declaration.exported !== true || declaration.path === path
              || /(?:^|\/)index\.[cm]?[jt]sx?$/u.test(declaration.path)) {
            reason = 'aggregate binding does not resolve to one exported declaration owner';
            break;
          }
          const entries = resolved.get(declaration.path) ?? [];
          entries.push({ targetPath: declaration.path, text: binding.getText(sourceFile) });
          resolved.set(declaration.path, entries);
        }
      }
      const replacementText = reason !== null ? null : [...resolved]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([targetPath, entries]) => {
          const keyword = ts.isImportDeclaration(statement) ? 'import' : 'export';
          const typeOnly = ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true
            ? ' type' : ts.isExportDeclaration(statement) && statement.isTypeOnly ? ' type' : '';
          return `${keyword}${typeOnly} { ${entries.map(({ text }) => text).join(', ')} } from '${relativeModuleSpecifier(path, targetPath)}';`;
        }).join('\n');
      reductions.push(Object.freeze({
        status: reason === null ? 'ready' : 'blocked',
        path,
        moduleSpecifier,
        statementSpan: spanFor(sourceFile, statement.getStart(sourceFile, false), statement.getEnd()),
        replacementText,
        targetPaths: Object.freeze([...resolved.keys()].sort(compareCodeUnits)),
        reason
      }));
    }
  }
  reductions.sort((left, right) => compareCodeUnits(left.path, right.path)
    || left.statementSpan.start - right.statementSpan.start);
  return Object.freeze({
    sourceRevision: model.sourceRevision,
    planDigest: sha256({ sourceRevision: model.sourceRevision, reductions }),
    reductions: Object.freeze(reductions)
  });
}

export function buildSourceProgramAggregateImportReductionPatch(
  plan: SourceProgramAggregateImportReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramAggregateImportReductionPatch {
  const sourceByPath = new Map(files.map(({ path, source }) => [path, source] as const));
  const editsByPath = new Map<string, SourceProgramAggregateImportReduction[]>();
  for (const reduction of plan.reductions) {
    if (reduction.status !== 'ready') continue;
    const edits = editsByPath.get(reduction.path) ?? [];
    edits.push(reduction);
    editsByPath.set(reduction.path, edits);
  }
  const patches: string[] = [];
  const changedFiles: { path: string; beforeDigest: string; afterDigest: string }[] = [];
  for (const [path, edits] of [...editsByPath].sort(([left], [right]) => compareCodeUnits(left, right))) {
    const source = sourceByPath.get(path);
    if (source === undefined) throw new Error(`aggregate import source is unavailable: ${path}`);
    let replacement = source;
    for (const edit of [...edits].sort((left, right) => right.statementSpan.start - left.statementSpan.start)) {
      replacement = replacement.slice(0, edit.statementSpan.start)
        + edit.replacementText!
        + replacement.slice(edit.statementSpan.end);
    }
    if (replacement === source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, source, replacement, '', '', { context: 3 }));
    changedFiles.push({ path, beforeDigest: rawSha256(source), afterDigest: rawSha256(replacement) });
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}

/**
 * Combines compiler-resolved consumer-zero evidence with Knip's independent
 * unused-export graph. Only complete top-level declarations are reducible;
 * test-only consumers, dynamic frontiers, entrypoint contracts and partial
 * declarations remain blocked instead of being guessed away.
 */
export function compileSourceProgramGraphCutReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[],
  unusedSymbols: readonly SourceProgramUnusedSymbolEvidence[]
): SourceProgramGraphCutReductionPlan {
  const sourceFileByPath = new Map(files
    .filter(({ path }) => /\.[cm]?[jt]sx?$/iu.test(path))
    .map(({ path, source }) => [
      path,
      ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true)
    ] as const));
  const candidateCodes = new Set([
    'production-declaration-without-consumer',
    'identity-token-without-consumer'
  ]);
  const candidateKeys = new Set(model.candidates
    .filter(({ code }) => candidateCodes.has(code))
    .flatMap((candidate) => candidate.paths.map((path) => `${path}\0${candidate.subject}`)));
  const moduleEntrypointPaths = new Set(model.entrypoints
    .filter(({ kind }) => kind === 'module-entrypoint')
    .flatMap(({ targetPaths }) => targetPaths));
  const dynamicFrontierPaths = new Set(model.unknowns
    .filter(({ code }) => code === 'dynamic-module-unresolved'
      || code === 'dynamic-runtime-opaque'
      || code === 'computed-property-unresolved')
    .map(({ path }) => path));
  const evidence = [...unusedSymbols]
    .sort((left, right) => compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.name, right.name));
  const reductions: SourceProgramGraphCutReduction[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    const key = `${item.path}\0${item.name}`;
    if (seen.has(key) || !candidateKeys.has(key)) continue;
    seen.add(key);
    const declaration = model.declarations.find((candidate) =>
      candidate.path === item.path && candidate.name === item.name);
    const sourceFile = sourceFileByPath.get(item.path);
    const declarationNode = declaration === undefined || sourceFile === undefined
      ? null
      : graphCutNode(sourceFile, item.name, declaration.span);
    const removalNode = declarationNode === null ? null : graphCutRemovalNode(declarationNode);
    const reason = moduleEntrypointPaths.has(item.path)
      ? 'module entrypoint exports require an explicit external-consumer retirement'
      : dynamicFrontierPaths.has(item.path)
        ? 'source file has an unresolved dynamic consumer frontier'
        : declaration === undefined || sourceFile === undefined
          ? 'declaration source snapshot is unresolved'
          : removalNode === null
            ? 'declaration is not an independently removable top-level node'
            : null;
    reductions.push(Object.freeze({
      status: reason === null ? 'ready' : 'blocked',
      path: item.path,
      name: item.name,
      removalSpan: reason === null ? graphCutRemovalSpan(sourceFile!, removalNode!) : null,
      reason
    }));
  }
  reductions.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.name, right.name));
  const evidenceDigest = sha256(evidence);
  return Object.freeze({
    sourceRevision: model.sourceRevision,
    evidenceDigest,
    planDigest: sha256({ evidenceDigest, reductions }),
    reductions: Object.freeze(reductions)
  });
}

export function compileSourceProgramVersionSuffixReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[]
): SourceProgramVersionSuffixReductionPlan {
  const sourceByPath = new Map(files
    .filter(({ path }) => /\.[cm]?[jt]sx?$/iu.test(path))
    .map((file) => [file.path, file.source] as const));
  const sourceFileByPath = new Map([...sourceByPath].map(([path, source]) => [
    path,
    ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true)
  ] as const));
  const service = ts.createLanguageService({
    getCompilationSettings: () => ({
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ESNext
    }),
    getCurrentDirectory: () => '.',
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => [...sourceByPath.keys()],
    getScriptSnapshot: (fileName) => {
      const source = sourceByPath.get(fileName) ?? ts.sys.readFile(fileName);
      return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
    },
    getScriptVersion: () => '1',
    fileExists: (fileName) => sourceByPath.has(fileName) || ts.sys.fileExists(fileName),
    readFile: (fileName) => sourceByPath.get(fileName) ?? ts.sys.readFile(fileName),
    readDirectory: ts.sys.readDirectory
  });
  const renameCandidates = model.candidates.filter(({ code }) =>
    code === 'versioned-declaration-without-coexisting-version');
  const candidateKeys = new Set(renameCandidates.flatMap((candidate) =>
    model.declarations
      .filter((declaration) => declaration.name === candidate.subject
        && candidate.paths.includes(declaration.path))
      .map((declaration) => `${declaration.path}\u0000${declaration.name}`)));
  const reductions: SourceProgramVersionSuffixReduction[] = [];
  const processedSymbols = new Set<string>();
  // A local import alias such as `import { canonical as canonicalV1 }` is not
  // a second protocol version. It is a pure compatibility name whose target
  // already proves the canonical identity. Reduce the local binding and every
  // compiler-resolved reference, but block when the canonical local name is
  // already occupied. Export aliases need a distinct public-surface graph cut
  // and are deliberately not rewritten as local bindings here.
  for (const [filePath, sourceFile] of sourceFileByPath) {
    const visitImportAlias = (node: ts.Node): void => {
      if (ts.isImportSpecifier(node) && node.propertyName !== undefined) {
        const match = VERSIONED_DECLARATION_NAME.exec(node.name.text);
        const proposedName = match?.[1] ?? '';
        if (proposedName.length > 0 && node.propertyName.text === proposedName) {
          const candidateKey = `${filePath}\u0000${node.name.text}@${node.name.getStart(sourceFile, false)}`;
          if (!processedSymbols.has(candidateKey)) {
            const conflict = sourceFileHasTopLevelBinding(sourceFile, proposedName, node);
            const position = node.name.getStart(sourceFile, false);
            const renameInfo = conflict
              ? null
              : service.getRenameInfo(filePath, position, { allowRenameOfImportPath: false });
            const rawLocations = renameInfo?.canRename
              ? service.findRenameLocations(filePath, position, false, false, true) ?? []
              : [];
            const locations = rawLocations.map((location) => {
              const locationSource = sourceFileByPath.get(location.fileName);
              if (locationSource === undefined) return null;
              return Object.freeze({
                path: location.fileName,
                span: spanFor(
                  locationSource,
                  location.textSpan.start,
                  location.textSpan.start + location.textSpan.length
                ),
                prefixText: location.prefixText ?? '',
                suffixText: location.suffixText ?? ''
              });
            }).filter((location): location is SourceProgramRenameLocation => location !== null)
              .sort((left, right) => compareCodeUnits(left.path, right.path)
                || left.span.start - right.span.start);
            const ready = !conflict && renameInfo?.canRename === true && locations.length > 0;
            reductions.push(Object.freeze({
              status: ready ? 'ready' : 'blocked',
              currentName: node.name.text,
              proposedName,
              declarationPaths: Object.freeze([filePath]),
              locations: Object.freeze(locations),
              reason: ready
                ? null
                : conflict
                  ? 'canonical import binding already exists in the same module'
                  : renameInfo !== null && !renameInfo.canRename
                    ? renameInfo.localizedErrorMessage
                    : 'import alias rename locations are unresolved'
            }));
            processedSymbols.add(candidateKey);
          }
        }
      }
      ts.forEachChild(node, visitImportAlias);
    };
    visitImportAlias(sourceFile);
  }
  for (const declaration of model.declarations) {
    const candidateKey = `${declaration.path}\u0000${declaration.name}`;
    if (!candidateKeys.has(candidateKey) || processedSymbols.has(candidateKey)) continue;
    const match = VERSIONED_DECLARATION_NAME.exec(declaration.name);
    const proposedName = match?.[1] ?? '';
    const sourceFile = sourceFileByPath.get(declaration.path);
    const position = sourceFile === undefined
      ? null
      : declarationNamePosition(sourceFile, declaration.name, declaration.span);
    if (proposedName.length === 0 || sourceFile === undefined || position === null) {
      reductions.push(Object.freeze({
        status: 'blocked',
        currentName: declaration.name,
        proposedName,
        declarationPaths: Object.freeze([declaration.path]),
        locations: Object.freeze([]),
        reason: 'declaration name position is unresolved'
      }));
      processedSymbols.add(candidateKey);
      continue;
    }
    const renameInfo = service.getRenameInfo(declaration.path, position, {
      allowRenameOfImportPath: false
    });
    const rawLocations = renameInfo.canRename
      ? service.findRenameLocations(declaration.path, position, false, false, true) ?? []
      : [];
    const locations = rawLocations.map((location) => {
      const locationSource = sourceFileByPath.get(location.fileName);
      if (locationSource === undefined) return null;
      return Object.freeze({
        path: location.fileName,
        span: spanFor(
          locationSource,
          location.textSpan.start,
          location.textSpan.start + location.textSpan.length
        ),
        prefixText: location.prefixText ?? '',
        suffixText: location.suffixText ?? ''
      });
    }).filter((location): location is SourceProgramRenameLocation => location !== null)
      .sort((left, right) => compareCodeUnits(left.path, right.path)
        || left.span.start - right.span.start);
    const declarationPaths = [...new Set(locations
      .filter(({ path, span }) => model.declarations.some((candidate) =>
        candidate.path === path
        && candidate.name === declaration.name
        && span.start >= candidate.span.start
        && span.end <= candidate.span.end))
      .map(({ path }) => path))].sort(compareCodeUnits);
    const ready = renameInfo.canRename && locations.length > 0 && declarationPaths.length > 0;
    reductions.push(Object.freeze({
      status: ready ? 'ready' : 'blocked',
      currentName: declaration.name,
      proposedName,
      declarationPaths: Object.freeze(declarationPaths.length > 0
        ? declarationPaths
        : [declaration.path]),
      locations: Object.freeze(locations),
      reason: ready ? null : renameInfo.canRename ? 'rename locations are incomplete' : renameInfo.localizedErrorMessage
    }));
    for (const declarationPath of declarationPaths.length > 0 ? declarationPaths : [declaration.path]) {
      processedSymbols.add(`${declarationPath}\u0000${declaration.name}`);
    }
  }
  reductions.sort((left, right) => compareCodeUnits(left.declarationPaths[0] ?? '', right.declarationPaths[0] ?? '')
    || compareCodeUnits(left.currentName, right.currentName));
  return Object.freeze({
    sourceRevision: model.sourceRevision,
    planDigest: sha256(reductions),
    reductions: Object.freeze(reductions)
  });
}

export function renderSourceProgramVersionSuffixReductionPatch(
  plan: SourceProgramVersionSuffixReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramVersionSuffixReductionPatch {
  const readyReductions = plan.reductions.filter(({ status }) => status === 'ready');
  if (readyReductions.length === 0) {
    throw new Error('Version suffix reduction patch requires at least one ready reduction');
  }
  const fileByPath = new Map(files.map((file) => [file.path, file] as const));
  const editsByPath = new Map<string, Readonly<{
    start: number;
    end: number;
    currentName: string;
    replacement: string;
  }>[]>()
  for (const reduction of readyReductions) {
    for (const location of reduction.locations) {
      const edits = editsByPath.get(location.path) ?? [];
      edits.push(Object.freeze({
        start: location.span.start,
        end: location.span.end,
        currentName: reduction.currentName,
        replacement: `${location.prefixText}${reduction.proposedName}${location.suffixText}`
      }));
      editsByPath.set(location.path, edits);
    }
  }
  const patches: string[] = [];
  const changedFiles: SourceProgramVersionSuffixReductionPatch['files'][number][] = [];
  for (const [path, rawEdits] of [...editsByPath].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    const file = fileByPath.get(path);
    if (file === undefined) throw new Error(`Reduction location has no source snapshot: ${path}`);
    const edits = [...rawEdits].sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index]!;
      const previous = edits[index - 1];
      if (previous && previous.end > edit.start) {
        throw new Error(`Overlapping version reduction edits: ${path}:${previous.start}-${edit.end}`);
      }
      if (file.source.slice(edit.start, edit.end) !== edit.currentName) {
        throw new Error(`Version reduction preimage mismatch: ${path}:${edit.start}-${edit.end}`);
      }
    }
    let nextSource = file.source;
    for (const edit of edits.reverse()) {
      nextSource = `${nextSource.slice(0, edit.start)}${edit.replacement}${nextSource.slice(edit.end)}`;
    }
    if (nextSource === file.source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, file.source, nextSource, '', '', { context: 3 }));
    changedFiles.push(Object.freeze({
      path,
      beforeDigest: file.contentDigest,
      afterDigest: rawSha256(nextSource)
    }));
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}

export function renderSourceProgramGraphCutReductionPatch(
  plan: SourceProgramGraphCutReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramVersionSuffixReductionPatch {
  const ready = plan.reductions.filter((reduction): reduction is SourceProgramGraphCutReduction & {
    readonly status: 'ready';
    readonly removalSpan: SourceProgramSpan;
  } => reduction.status === 'ready' && reduction.removalSpan !== null);
  if (ready.length === 0) throw new Error('Graph-cut patch requires at least one ready reduction');
  const fileByPath = new Map(files.map((file) => [file.path, file] as const));
  const editsByPath = new Map<string, SourceProgramGraphCutReduction[]>();
  for (const reduction of ready) {
    const edits = editsByPath.get(reduction.path) ?? [];
    edits.push(reduction);
    editsByPath.set(reduction.path, edits);
  }
  const patches: string[] = [];
  const changedFiles: SourceProgramVersionSuffixReductionPatch['files'][number][] = [];
  for (const [path, rawEdits] of [...editsByPath].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    const file = fileByPath.get(path);
    if (file === undefined) throw new Error(`Graph-cut location has no source snapshot: ${path}`);
    const edits = [...rawEdits].sort((left, right) =>
      left.removalSpan!.start - right.removalSpan!.start
      || left.removalSpan!.end - right.removalSpan!.end);
    for (let index = 1; index < edits.length; index += 1) {
      if (edits[index - 1]!.removalSpan!.end > edits[index]!.removalSpan!.start) {
        throw new Error(`Overlapping graph-cut edits: ${path}`);
      }
    }
    let nextSource = file.source;
    for (const edit of edits.reverse()) {
      nextSource = `${nextSource.slice(0, edit.removalSpan!.start)}${nextSource.slice(edit.removalSpan!.end)}`;
    }
    if (nextSource.length > 0) nextSource = `${nextSource.replace(/[\t \r\n]+$/u, '')}\n`;
    if (nextSource === file.source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, file.source, nextSource, '', '', { context: 3 }));
    changedFiles.push(Object.freeze({
      path,
      beforeDigest: file.contentDigest,
      afterDigest: rawSha256(nextSource)
    }));
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}
