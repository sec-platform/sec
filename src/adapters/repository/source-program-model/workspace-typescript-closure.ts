import path from 'node:path';
import ts from 'typescript';
import { createTypeScriptSnapshotDirectoryReader } from '../../toolchain/typescript/snapshot-directory.ts';
import type { WorkspaceSourceFile } from './workspace-source-content.ts';
import { parseContainedTypeScriptProjectConfig, parseTypeScriptProjectConfiguration } from './workspace-typescript-config.ts';

/** Only configuration interpretation failures. Acquisition can preserve raw
 * source observations; compiler consumers still reject this typed failure. */
export class TypeScriptDeclaredInputConfigurationError extends Error {}

export function typeScriptSnapshotPath(root: string, candidate: string): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return '';
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return null;
  return relative.replaceAll('\\', '/');
}

export function typeScriptScriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(lower)) return ts.ScriptKind.JS;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

export function typeScriptModuleSpecifierLiteral(node: ts.Node): ts.StringLiteralLike | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && node.arguments.length >= 1
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && ts.isStringLiteralLike(node.arguments[0]!)) return node.arguments[0]!;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)) return node.argument.literal;
  if (ts.isJSDocImportTag(node) && ts.isStringLiteralLike(node.moduleSpecifier)) return node.moduleSpecifier;
  if (ts.isModuleDeclaration(node) && ts.isStringLiteralLike(node.name)) return node.name;
  return null;
}

function moduleSpecifierLiterals(source: ts.SourceFile): readonly ts.StringLiteralLike[] {
  const result: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    const literal = typeScriptModuleSpecifierLiteral(node);
    if (literal !== null) result.push(literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

/** Compiler-owned resolution over a sealed census. Missing bytes suspend only
 * the current source; acquisition supplies them through its original owner.
 * This resolver never reads the host or grants permission to acquire a path. */
export function createTypeScriptDeclaredInputClosure(input: Readonly<{
  projectConfigPath: string;
  rootPaths: readonly string[];
  membershipPaths: readonly string[];
  file(repositoryPath: string): WorkspaceSourceFile | null;
}>): Readonly<{
  advance(): readonly string[];
  selectedPaths(): readonly string[];
}> {
  const virtualRoot = path.resolve(process.cwd(), '.sec-source-program-project-facts');
  const membership = new Set(input.membershipPaths);
  const rootDirectory = createTypeScriptSnapshotDirectoryReader(input.rootPaths, virtualRoot);
  const resolutionDirectory = createTypeScriptSnapshotDirectoryReader(input.membershipPaths, virtualRoot);
  const selected = new Set<string>();
  const admitted = new Set<string>();
  const pending: string[] = [];
  const missing = new Set<string>();
  const suspendedRead = Symbol('typescript-input-bytes-required');
  const repositoryPath = (fileName: string): string | null => typeScriptSnapshotPath(virtualRoot, fileName);
  const read = (fileName: string): string | undefined => {
    const relative = repositoryPath(fileName);
    if (relative === null || !membership.has(relative)) return undefined;
    selected.add(relative);
    const file = input.file(relative);
    if (file !== null) return file.source;
    missing.add(relative);
    throw suspendedRead;
  };
  const exists = (fileName: string): boolean => {
    const relative = repositoryPath(fileName);
    return relative !== null && membership.has(relative);
  };
  const virtualFile = (relative: string): string => path.resolve(virtualRoot, ...relative.split('/'));
  const admit = (fileName: string): void => {
    const relative = repositoryPath(fileName);
    if (relative === null || !membership.has(relative)) {
      throw new Error(`TypeScript project fact source is outside its snapshot: ${fileName}`);
    }
    if (admitted.has(relative)) return;
    admitted.add(relative);
    selected.add(relative);
    pending.push(relative);
  };
  let parsed: ts.ParsedCommandLine | null = null;
  return Object.freeze({
    advance: (): readonly string[] => {
      missing.clear();
      if (parsed === null) {
        const config = input.file(input.projectConfigPath);
        if (config === null) throw new Error(`TypeScript project fact config is absent: ${input.projectConfigPath}`);
        let contained: Readonly<Record<string, unknown>>;
        try {
          // This pure parser has no host reads or effects. Do not extend this
          // catch to resolution, acquisition, bounds or physical observation.
          contained = parseContainedTypeScriptProjectConfig(config.source, config.path);
        } catch (cause) {
          throw new TypeScriptDeclaredInputConfigurationError(
            `TypeScript project fact config is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause }
          );
        }
        parsed = parseTypeScriptProjectConfiguration(virtualFile(config.path), config.source, contained, {
          useCaseSensitiveFileNames: true,
          fileExists: exists,
          readFile: read,
          readDirectory: rootDirectory
        }, virtualRoot);
        if (parsed.errors.length > 0) {
          throw new TypeScriptDeclaredInputConfigurationError(`TypeScript project fact config is invalid: ${ts.flattenDiagnosticMessageText(parsed.errors[0]!.messageText, '\n')}`);
        }
        parsed.fileNames.forEach(admit);
      }
      const options = parsed.options;
      const deferred: string[] = [];
      const host: ts.ModuleResolutionHost = {
        directoryExists: resolutionDirectory.directoryExists,
        fileExists: exists,
        getCurrentDirectory: () => virtualRoot,
        getDirectories: resolutionDirectory.getDirectories,
        readFile: read,
        realpath: (fileName) => fileName,
        useCaseSensitiveFileNames: true
      };
      const cache = ts.createModuleResolutionCache(virtualRoot, (fileName) => fileName, options);
      const typeCache = ts.createTypeReferenceDirectiveResolutionCache(virtualRoot, (fileName) => fileName, options, cache);
      while (pending.length > 0) {
        const relative = pending.pop()!;
        const source = input.file(relative);
        if (source === null) {
          missing.add(relative);
          deferred.push(relative);
          continue;
        }
        const containingFile = virtualFile(relative);
        try {
          const impliedNodeFormat = ts.getImpliedNodeFormatForFile(containingFile, cache, host, options);
          const sourceFile = ts.createSourceFile(containingFile, source.source, {
            languageVersion: options.target ?? ts.ScriptTarget.Latest, impliedNodeFormat
          }, true, typeScriptScriptKind(relative));
          const resolvedSources: string[] = [];
          if (!options.noResolve) {
            for (const reference of moduleSpecifierLiterals(sourceFile)) {
              if (reference.text.includes('\0') || path.isAbsolute(reference.text)
                  || ((reference.text === '..' || reference.text.startsWith('../'))
                    && repositoryPath(path.resolve(path.dirname(containingFile), reference.text)) === null)) {
                throw new Error(`TypeScript ProjectInput import escapes its snapshot: ${relative}`);
              }
              const resolved = ts.resolveModuleName(reference.text, containingFile, options, host, cache,
                undefined, ts.getModeForUsageLocation(sourceFile, reference, options)).resolvedModule;
              const javascript = resolved?.extension === ts.Extension.Js || resolved?.extension === ts.Extension.Jsx
                || resolved?.extension === ts.Extension.Mjs || resolved?.extension === ts.Extension.Cjs;
              if (resolved !== undefined && (!javascript || options.allowJs === true)
                  && exists(resolved.resolvedFileName)) resolvedSources.push(resolved.resolvedFileName);
            }
            for (const reference of sourceFile.referencedFiles) {
              const resolved = ts.resolveTripleslashReference(reference.fileName, containingFile);
              if (reference.fileName.includes('\0') || path.isAbsolute(reference.fileName) || repositoryPath(resolved) === null) {
                throw new Error(`TypeScript ProjectInput triple-slash reference escapes its snapshot: ${relative}`);
              }
              if (exists(resolved)) resolvedSources.push(resolved);
            }
            for (const reference of sourceFile.typeReferenceDirectives) {
              const resolved = ts.resolveTypeReferenceDirective(reference.fileName, containingFile, options,
                host, undefined, typeCache, ts.getModeForFileReference(reference, sourceFile.impliedNodeFormat))
                .resolvedTypeReferenceDirective?.resolvedFileName;
              if (resolved !== undefined && exists(resolved)) resolvedSources.push(resolved);
            }
          }
          resolvedSources.forEach(admit);
        } catch (error) {
          if (error !== suspendedRead) throw error;
          deferred.push(relative);
        }
      }
      pending.push(...deferred);
      return Object.freeze([...missing]);
    },
    selectedPaths: () => Object.freeze([...selected])
  });
}
