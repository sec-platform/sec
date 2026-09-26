import path from 'node:path';
import ts from 'typescript';
import { parseContainedTypeScriptProjectConfig, parseTypeScriptProjectConfiguration } from './workspace-typescript-config.ts';
import { createTypeScriptSnapshotDirectoryReader, TYPESCRIPT_SNAPSHOT_DIRECTORY_SEMANTICS } from '../../toolchain/typescript/snapshot-directory.ts';
import { sha256, compareCodeUnits, rawSha256 } from '../../../contracts/canonical.ts';
import type { RetainedNoFollowProvenDirectoryGeneration } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { normalizeRepositoryModulePath } from '../architecture/contract.ts';
import { assertPhysicalWorkspaceSourceSnapshot, assertWorkspaceSourceSnapshot, type PhysicalWorkspaceSourceSnapshot, type WorkspaceSourceSnapshot } from './workspace-source-authority.ts';
import type { WorkspaceSourceFile } from './workspace-source-content.ts';

const workspaceTypeScriptProjectInputBrand: unique symbol = Symbol('workspace-typescript-project-input');

const issuedWorkspaceTypeScriptProjectInputs = new WeakSet<object>();

const typeScriptProjectGenerationEvidenceBrand: unique symbol = Symbol(
  'workspace-typescript-project-generation-evidence'
);

const issuedTypeScriptProjectGenerationEvidence = new WeakSet<object>();

type WorkspaceTypeScriptSourceFact = Readonly<{
  path: string;
  contentDigest: `sha256:${string}`;
  moduleId: string | null;
  moduleDigest: `sha256:${string}`;
}>;

type WorkspaceTypeScriptExternalSourceFact = Readonly<{
  kind: 'default-library' | 'dependency-generation';
  path: string;
  contentDigest: `sha256:${string}`;
}>;

type WorkspaceTypeScriptExecutionConfigContainmentReceipt = Readonly<{
  status: 'contained';
  projectConfigPath: string;
  projectConfigDigest: `sha256:${string}`;
  workspaceSnapshotIdentityDigest: `sha256:${string}`;
  dependencyGenerationDigest: `sha256:${string}` | null;
  compilerRevision: string;
  resolvedConfigDigest: `sha256:${string}`;
  containmentDigest: `sha256:${string}`;
}>;

export interface TypeScriptProjectInput {
  readonly [workspaceTypeScriptProjectInputBrand]: true;
  readonly sourceRevision: string;
  readonly snapshotDigest: `sha256:${string}`;
  readonly workspaceSnapshotIdentityDigest: `sha256:${string}`;
  readonly moduleMembershipDigest: `sha256:${string}`;
  readonly moduleGraphDigest: `sha256:${string}`;
  readonly projectConfigPath: string;
  readonly projectConfigDigest: `sha256:${string}`;
  readonly dependencyGenerationDigest: `sha256:${string}` | null;
  readonly executionConfigContainment: WorkspaceTypeScriptExecutionConfigContainmentReceipt;
  readonly sourceFacts: readonly WorkspaceTypeScriptSourceFact[];
  readonly externalSourceFacts: readonly WorkspaceTypeScriptExternalSourceFact[];
  readonly orderedSourceFactsDigest: `sha256:${string}`;
  readonly projectInputDigest: `sha256:${string}`;
  readonly observationDigest: `sha256:${string}`;
}

export interface TypeScriptProjectFactIdentity {
  readonly projectConfigDigest: `sha256:${string}`;
  readonly projectFactDigest: `sha256:${string}`;
  readonly rootSourceFacts: readonly WorkspaceTypeScriptSourceFact[];
}

function typeScriptProjectFactDigest(input: Readonly<{
  projectConfigPath: string;
  projectConfigDigest: `sha256:${string}`;
  dependencyGenerationDigest: `sha256:${string}` | null;
  rootSourceFacts: readonly WorkspaceTypeScriptSourceFact[];
}>): `sha256:${string}` {
  return sha256(Object.freeze({
    identity: 'typescript-project-root-source-facts',
    directorySemantics: TYPESCRIPT_SNAPSHOT_DIRECTORY_SEMANTICS,
    compilerRevision: ts.version,
    ...input
  })) as `sha256:${string}`;
}

export function projectTypeScriptProjectFactIdentity(
  projectInput: TypeScriptProjectInput
): TypeScriptProjectFactIdentity {
  assertTypeScriptProjectInput(projectInput);
  const rootSourceFacts = Object.freeze(projectInput.sourceFacts.filter(({ path: sourcePath }) => (
    sourcePath !== projectInput.projectConfigPath
  )));
  return Object.freeze({
    projectConfigDigest: projectInput.projectConfigDigest,
    projectFactDigest: typeScriptProjectFactDigest({
      projectConfigPath: projectInput.projectConfigPath,
      projectConfigDigest: projectInput.projectConfigDigest,
      dependencyGenerationDigest: projectInput.dependencyGenerationDigest,
      rootSourceFacts
    }),
    rootSourceFacts
  });
}

/**
 * Exact TypeScript root-input identity for Action admission. This parses the
 * canonical project configuration and hashes its selected repository sources
 * and module membership without constructing a TypeScript Program. Physical
 * dependency/provider materialization is represented only by the opaque
 * generation identity issued by its owner.
 */
export function compileTypeScriptProjectFactIdentity(
  snapshot: WorkspaceSourceSnapshot,
  projectConfigPath: string,
  input: Readonly<{
    dependencyGenerationDigest: `sha256:${string}` | null;
  }>
): TypeScriptProjectFactIdentity {
  assertWorkspaceSourceSnapshot(snapshot);
  const projectConfig = snapshot.file(projectConfigPath);
  if (projectConfig === null) {
    throw new Error(`TypeScript project fact config is absent: ${projectConfigPath}`);
  }
  const containedProjectConfig = parseContainedTypeScriptProjectConfig(
    projectConfig.source,
    projectConfigPath
  );
  const virtualRoot = path.resolve(process.cwd(), '.sec-source-program-project-facts');
  const readSnapshotDirectory = createTypeScriptSnapshotDirectoryReader(
    snapshot.files.map(({ path: repositoryPath }) => repositoryPath), virtualRoot
  );
  const virtualConfigPath = path.resolve(virtualRoot, ...projectConfigPath.split('/'));
  const parsed = parseTypeScriptProjectConfiguration(
    virtualConfigPath,
    projectConfig.source,
    containedProjectConfig,
    {
      useCaseSensitiveFileNames: true,
      fileExists: (fileName) => {
        const repositoryPath = pathInside(virtualRoot, fileName);
        return repositoryPath !== null && snapshot.file(repositoryPath) !== null;
      },
      readFile: (fileName) => {
        const repositoryPath = pathInside(virtualRoot, fileName);
        return repositoryPath === null ? undefined : snapshot.file(repositoryPath)?.source;
      },
      readDirectory: (rootDir, extensions, excludes, includes, depth) => readSnapshotDirectory(
        rootDir,
        extensions,
        excludes,
        includes,
        depth
      )
    }
  );
  if (parsed.errors.length > 0) {
    throw new Error(`TypeScript project fact config is invalid: ${ts.flattenDiagnosticMessageText(
      parsed.errors[0]!.messageText,
      '\n'
    )}`);
  }
  const rootSources = new Map<string, WorkspaceSourceFile>();
  const pendingSourcePaths: string[] = [];
  const virtualFile = (repositoryPath: string): string => path.resolve(
    virtualRoot,
    ...repositoryPath.split('/')
  );
  const repositoryFile = (fileName: string): WorkspaceSourceFile | null => {
    const repositoryPath = pathInside(virtualRoot, fileName);
    return repositoryPath === null ? null : snapshot.file(repositoryPath);
  };
  const repositoryDirectoryExists = (directoryName: string): boolean => {
    const repositoryPath = pathInside(virtualRoot, directoryName);
    if (repositoryPath === null) return false;
    const prefix = repositoryPath.length === 0 ? '' : `${repositoryPath}/`;
    return snapshot.files.some(({ path: sourcePath }) => sourcePath.startsWith(prefix));
  };
  const moduleResolutionHost: ts.ModuleResolutionHost = {
    directoryExists: repositoryDirectoryExists,
    fileExists: (fileName) => repositoryFile(fileName) !== null,
    getCurrentDirectory: () => virtualRoot,
    getDirectories: (directoryName) => {
      const repositoryPath = pathInside(virtualRoot, directoryName);
      if (repositoryPath === null) return [];
      const prefix = repositoryPath.length === 0 ? '' : `${repositoryPath}/`;
      return [...new Set(snapshot.files.flatMap(({ path: sourcePath }) => {
        if (!sourcePath.startsWith(prefix)) return [];
        const remainder = sourcePath.slice(prefix.length);
        const separator = remainder.indexOf('/');
        return separator === -1 ? [] : [remainder.slice(0, separator)];
      }))].map((entry) => path.resolve(directoryName, entry));
    },
    readFile: (fileName) => repositoryFile(fileName)?.source,
    realpath: (fileName) => fileName,
    useCaseSensitiveFileNames: true
  };
  const moduleResolutionCache = ts.createModuleResolutionCache(
    virtualRoot,
    (fileName) => fileName,
    parsed.options
  );
  const typeReferenceResolutionCache = ts.createTypeReferenceDirectiveResolutionCache(
    virtualRoot,
    (fileName) => fileName,
    parsed.options,
    moduleResolutionCache
  );
  const admitSource = (fileName: string): void => {
    const repositoryPath = pathInside(virtualRoot, fileName);
    const source = repositoryPath === null ? null : snapshot.file(repositoryPath);
    if (repositoryPath === null || source === null) {
      throw new Error(`TypeScript project fact source is outside its snapshot: ${fileName}`);
    }
    if (rootSources.has(repositoryPath)) return;
    rootSources.set(repositoryPath, source);
    pendingSourcePaths.push(repositoryPath);
  };
  parsed.fileNames.forEach(admitSource);
  while (pendingSourcePaths.length > 0) {
    const repositoryPath = pendingSourcePaths.pop()!;
    const source = rootSources.get(repositoryPath)!;
    const containingFile = virtualFile(repositoryPath);
    const impliedNodeFormat = ts.getImpliedNodeFormatForFile(
      containingFile,
      moduleResolutionCache,
      moduleResolutionHost,
      parsed.options
    );
    const sourceFile = ts.createSourceFile(
      containingFile,
      source.source,
      Object.freeze({
        languageVersion: parsed.options.target ?? ts.ScriptTarget.Latest,
        impliedNodeFormat
      }),
      true,
      typeScriptScriptKind(repositoryPath)
    );
    if (!parsed.options.noResolve) {
      for (const reference of typeScriptModuleSpecifierLiterals(sourceFile)) {
        const resolutionMode = ts.getModeForUsageLocation(sourceFile, reference, parsed.options);
        const resolvedModule = ts.resolveModuleName(
          reference.text,
          containingFile,
          parsed.options,
          moduleResolutionHost,
          moduleResolutionCache,
          undefined,
          resolutionMode
        ).resolvedModule;
        const isJavaScriptSource = resolvedModule?.extension === ts.Extension.Js
          || resolvedModule?.extension === ts.Extension.Jsx
          || resolvedModule?.extension === ts.Extension.Mjs
          || resolvedModule?.extension === ts.Extension.Cjs;
        if (resolvedModule !== undefined
            && (!isJavaScriptSource || parsed.options.allowJs === true)
            && repositoryFile(resolvedModule.resolvedFileName) !== null) {
          admitSource(resolvedModule.resolvedFileName);
        }
      }
      for (const reference of sourceFile.referencedFiles) {
        const referencedFileName = ts.resolveTripleslashReference(
          reference.fileName,
          containingFile
        );
        if (repositoryFile(referencedFileName) !== null) {
          admitSource(referencedFileName);
        }
      }
      for (const reference of sourceFile.typeReferenceDirectives) {
        const resolvedFileName = ts.resolveTypeReferenceDirective(
          reference.fileName,
          containingFile,
          parsed.options,
          moduleResolutionHost,
          undefined,
          typeReferenceResolutionCache,
          ts.getModeForFileReference(reference, sourceFile.impliedNodeFormat)
        ).resolvedTypeReferenceDirective?.resolvedFileName;
        if (resolvedFileName !== undefined && repositoryFile(resolvedFileName) !== null) {
          admitSource(resolvedFileName);
        }
      }
    }
  }
  const rootSourceFacts = Object.freeze([...rootSources.entries()].map(([repositoryPath, source]) => {
    const module = snapshot.moduleMembership.moduleForPath(repositoryPath);
    return Object.freeze({
      path: repositoryPath,
      contentDigest: source.contentDigest as `sha256:${string}`,
      moduleId: module?.moduleId ?? null,
      moduleDigest: sha256(module) as `sha256:${string}`
    });
  }).sort((left, right) => compareCodeUnits(left.path, right.path)));
  const projectConfigDigest = projectConfig.contentDigest as `sha256:${string}`;
  return Object.freeze({
    projectConfigDigest,
    projectFactDigest: typeScriptProjectFactDigest({
      projectConfigPath,
      projectConfigDigest,
      dependencyGenerationDigest: input.dependencyGenerationDigest,
      rootSourceFacts
    }),
    rootSourceFacts
  });
}

/**
 * Process-local evidence binding one exact ProjectInput to the working-tree
 * observation which produced it. It deliberately carries no current/readback
 * method: a post-state check cannot prove which bytes an external process
 * consumed. A durable fact-store receipt cannot manufacture a frozen execution
 * input from this evidence.
 */
export interface TypeScriptProjectGenerationEvidence {
  readonly [typeScriptProjectGenerationEvidenceBrand]: true;
  readonly generationDigest: `sha256:${string}`;
  readonly projectInput: TypeScriptProjectInput;
  readonly sourceFiles: readonly WorkspaceSourceFile[];
}

export function assertTypeScriptProjectGenerationEvidence(
  evidence: TypeScriptProjectGenerationEvidence
): void {
  if (!issuedTypeScriptProjectGenerationEvidence.has(evidence)) {
    throw new Error('TypeScript project generation evidence was not issued by the Source Program owner');
  }
  assertTypeScriptProjectInput(evidence.projectInput);
}

export function assertTypeScriptProjectInput(
  input: TypeScriptProjectInput
): void {
  if (!issuedWorkspaceTypeScriptProjectInputs.has(input)) {
    throw new Error('TypeScript ProjectInput was not issued by the Workspace Source Snapshot owner');
  }
}

export function assertTypeScriptProjectMatchesSnapshot(
  input: TypeScriptProjectInput,
  snapshot: WorkspaceSourceSnapshot
): void {
  assertTypeScriptProjectInput(input);
  assertWorkspaceSourceSnapshot(snapshot);
  if (input.sourceRevision !== snapshot.sourceRevision
      || input.snapshotDigest !== snapshot.snapshotDigest
      || input.workspaceSnapshotIdentityDigest !== snapshot.identityDigest
      || input.moduleMembershipDigest !== snapshot.moduleMembershipDigest
      || input.moduleGraphDigest !== snapshot.moduleGraphDigest) {
    throw new Error('TypeScript ProjectInput does not belong to the Workspace Source Snapshot');
  }
}

function typeScriptScriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(lower)) return ts.ScriptKind.JS;
  if (lower.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function pathInside(root: string, candidate: string): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative === '') return '';
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  return relative.replaceAll('\\', '/');
}

function typeScriptModuleSpecifier(node: ts.Node): string | null {
  return typeScriptModuleSpecifierLiteral(node)?.text ?? null;
}

function typeScriptModuleSpecifierLiteral(node: ts.Node): ts.StringLiteralLike | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }
  if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined
      && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression;
  }
  if (ts.isCallExpression(node) && node.arguments.length >= 1
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      && ts.isStringLiteralLike(node.arguments[0]!)) {
    return node.arguments[0]!;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
      && ts.isStringLiteralLike(node.argument.literal)) {
    return node.argument.literal;
  }
  if (ts.isJSDocImportTag(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier;
  }
  if (ts.isModuleDeclaration(node) && ts.isStringLiteralLike(node.name)) {
    return node.name;
  }
  return null;
}

function typeScriptModuleSpecifierLiterals(sourceFile: ts.SourceFile): readonly ts.StringLiteralLike[] {
  const literals: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    const literal = typeScriptModuleSpecifierLiteral(node);
    if (literal !== null) literals.push(literal);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze(literals);
}

export function compileTypeScriptProjectInput(
  snapshot: WorkspaceSourceSnapshot,
  projectConfigPath: string,
  input: Readonly<{
    dependencyGeneration?: RetainedNoFollowProvenDirectoryGeneration;
    dependencyGenerationDigest?: `sha256:${string}`;
  }> = {}
): TypeScriptProjectInput {
  assertWorkspaceSourceSnapshot(snapshot);
  const canonicalConfigPath = normalizeRepositoryModulePath(projectConfigPath);
  if (canonicalConfigPath !== projectConfigPath || canonicalConfigPath.length === 0) {
    throw new Error('TypeScript ProjectInput config path is not canonical');
  }
  const projectConfig = snapshot.file(projectConfigPath);
  if (projectConfig === null) {
    throw new Error(`TypeScript ProjectInput config is absent: ${projectConfigPath}`);
  }
  const containedProjectConfig = parseContainedTypeScriptProjectConfig(
    projectConfig.source,
    projectConfigPath
  );
  const virtualRoot = path.resolve(process.cwd(), '.sec-source-program-project-input');
  const readSnapshotDirectory = createTypeScriptSnapshotDirectoryReader(
    snapshot.files.map(({ path: repositoryPath }) => repositoryPath), virtualRoot
  );
  const dependencyGeneration = input.dependencyGeneration;
  dependencyGeneration?.assertCurrent();
  const dependencyRoot = dependencyGeneration?.root.path ?? null;
  const dependencyFinalRoot = dependencyGeneration?.root.finalPath ?? null;
  const dependencyGenerationDigest = input.dependencyGenerationDigest ?? null;
  if ((dependencyGeneration === undefined) !== (dependencyGenerationDigest === null)) {
    throw new Error('TypeScript ProjectInput dependency generation authority is incomplete');
  }
  const virtualDependencyRoot = path.resolve(virtualRoot, 'node_modules');
  const defaultLibraryRoot = path.dirname(ts.getDefaultLibFilePath({}));
  const virtualConfigPath = path.resolve(virtualRoot, ...projectConfigPath.split('/'));
  const snapshotFileForAbsolute = (fileName: string): WorkspaceSourceFile | null => {
    const repositoryPath = pathInside(virtualRoot, fileName);
    return repositoryPath === null ? null : snapshot.file(repositoryPath);
  };
  const dependencyHostResolutionPaths = new Map<string, string>();
  const hostPathKey = (fileName: string): string => {
    const resolved = path.resolve(fileName);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const rememberDependencyHostResolution = (
    relative: string,
    ...hostPaths: (string | null)[]
  ): void => {
    for (const hostPath of hostPaths) {
      if (hostPath !== null) dependencyHostResolutionPaths.set(hostPathKey(hostPath), relative);
    }
  };
  const dependencyFileForAbsolute = (fileName: string): string | null => {
    if (dependencyRoot === null) return null;
    const relative = pathInside(virtualDependencyRoot, fileName);
    if (relative === null) return null;
    const lexicalHostPath = path.resolve(dependencyRoot, ...relative.split('/'));
    const finalHostPath = dependencyFinalRoot === null
      ? null
      : path.resolve(dependencyFinalRoot, ...relative.split('/'));
    rememberDependencyHostResolution(relative, lexicalHostPath, finalHostPath);
    return lexicalHostPath;
  };
  const dependencyPathForHostSource = (fileName: string): string | null => {
    const virtualPath = pathInside(virtualDependencyRoot, fileName);
    if (virtualPath !== null) return virtualPath;
    const mappedPath = dependencyHostResolutionPaths.get(hostPathKey(fileName));
    if (mappedPath !== undefined) return mappedPath;
    const lexicalPath = dependencyRoot === null ? null : pathInside(dependencyRoot, fileName);
    if (lexicalPath !== null) return lexicalPath;
    return dependencyFinalRoot === null ? null : pathInside(dependencyFinalRoot, fileName);
  };
  const externalHostPathForRead = (fileName: string): string | null => {
    const virtualDependencyPath = dependencyFileForAbsolute(fileName);
    if (virtualDependencyPath !== null) return virtualDependencyPath;
    if (dependencyPathForHostSource(fileName) !== null) return fileName;
    return pathInside(defaultLibraryRoot, fileName) === null ? null : fileName;
  };
  const externalHostDirectoryForRead = (directoryName: string): string | null => {
    const dependencyDirectory = dependencyFileForAbsolute(directoryName);
    if (dependencyDirectory !== null) return dependencyDirectory;
    if (dependencyPathForHostSource(directoryName) !== null) return directoryName;
    return pathInside(defaultLibraryRoot, directoryName) === null ? null : directoryName;
  };
  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: (fileName) => snapshotFileForAbsolute(fileName) !== null,
    readFile: (fileName) => snapshotFileForAbsolute(fileName)?.source,
    readDirectory: (rootDir, extensions, excludes, includes, depth) => readSnapshotDirectory(
      rootDir,
      extensions,
      excludes,
      includes,
      depth
    )
  };
  const parsed = parseTypeScriptProjectConfiguration(
    virtualConfigPath,
    projectConfig.source,
    containedProjectConfig,
    parseHost
  );
  if (parsed.errors.length > 0) {
    throw new Error(`TypeScript ProjectInput config is invalid: ${ts.flattenDiagnosticMessageText(
      parsed.errors[0]!.messageText,
      '\n'
    )}`);
  }
  const baseHost = ts.createCompilerHost(parsed.options, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    directoryExists: (directoryName) => {
      const externalDirectory = externalHostDirectoryForRead(directoryName);
      if (externalDirectory !== null) {
        return baseHost.directoryExists?.(externalDirectory) ?? false;
      }
      const repositoryPath = pathInside(virtualRoot, directoryName);
      if (repositoryPath !== null) {
        return snapshot.files.some(({ path: sourcePath }) => (
          repositoryPath === '' || sourcePath.startsWith(`${repositoryPath}/`)
        ));
      }
      return false;
    },
    fileExists: (fileName) => {
      if (snapshotFileForAbsolute(fileName) !== null) return true;
      const externalFile = externalHostPathForRead(fileName);
      return externalFile === null ? false : baseHost.fileExists(externalFile);
    },
    getCurrentDirectory: () => virtualRoot,
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = snapshotFileForAbsolute(fileName);
      if (source !== null) {
        return ts.createSourceFile(
          fileName,
          source.source,
          languageVersion,
          true,
          typeScriptScriptKind(source.path)
        );
      }
      const dependencyPath = dependencyPathForHostSource(fileName);
      const externalFile = externalHostPathForRead(fileName);
      if (externalFile === null) return undefined;
      const externalSource = baseHost.getSourceFile(
        externalFile,
        languageVersion,
        onError,
        shouldCreateNewSourceFile
      );
      if (externalSource === undefined || dependencyPath === null) {
        return externalSource;
      }
      const resolvedExternalPath = dependencyPathForHostSource(externalSource.fileName);
      if (dependencyPath !== null && resolvedExternalPath !== dependencyPath) {
        throw new Error(
          `TypeScript dependency host resolved outside its retained generation: ${externalSource.fileName}`
        );
      }
      if (dependencyPath !== null) {
        rememberDependencyHostResolution(
          dependencyPath,
          externalFile,
          externalSource.fileName
        );
      }
      return ts.createSourceFile(
        fileName,
        externalSource.text,
        languageVersion,
        true,
        typeScriptScriptKind(fileName)
      );
    },
    readDirectory: (rootDir, extensions, excludes, includes, depth) => {
      if (pathInside(virtualRoot, rootDir) !== null) {
        const dependencyDirectory = dependencyFileForAbsolute(rootDir);
        if (dependencyDirectory !== null) {
          return baseHost.readDirectory?.(
            dependencyDirectory,
            extensions,
            excludes,
            includes,
            depth
          ) ?? [];
        }
        return readSnapshotDirectory(
          rootDir,
          extensions,
          excludes,
          includes,
          depth
        );
      }
      const externalDirectory = externalHostDirectoryForRead(rootDir);
      return externalDirectory === null
        ? []
        : (baseHost.readDirectory?.(
            externalDirectory,
            extensions,
            excludes,
            includes,
            depth
          ) ?? []);
    },
    readFile: (fileName) => {
      const source = snapshotFileForAbsolute(fileName)?.source;
      if (source !== undefined) return source;
      const externalFile = externalHostPathForRead(fileName);
      return externalFile === null ? undefined : baseHost.readFile(externalFile);
    },
    realpath: (fileName) => {
      const dependencyFile = dependencyFileForAbsolute(fileName);
      if (dependencyFile !== null) return fileName;
      if (pathInside(virtualRoot, fileName) !== null
          || dependencyPathForHostSource(fileName) !== null) return fileName;
      return pathInside(defaultLibraryRoot, fileName) === null
        ? fileName
        : (baseHost.realpath?.(fileName) ?? fileName);
    }
  };
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    host
  });
  const repositorySources = new Map<string, WorkspaceSourceFile>();
  const externalSources: WorkspaceTypeScriptExternalSourceFact[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    const dependencyPath = dependencyPathForHostSource(sourceFile.fileName);
    const repositoryPath = dependencyPath === null
      ? pathInside(virtualRoot, sourceFile.fileName)
      : null;
    if (repositoryPath !== null) {
      const source = snapshot.file(repositoryPath);
      if (source === null || source.source !== sourceFile.text) {
        throw new Error(`TypeScript Program repository source is outside its exact snapshot: ${repositoryPath}`);
      }
      repositorySources.set(repositoryPath, source);
      const visit = (node: ts.Node): void => {
        const specifier = typeScriptModuleSpecifier(node);
        if (specifier !== null && (specifier.includes('\0') || path.isAbsolute(specifier))) {
          throw new Error(`TypeScript ProjectInput contains an absolute or invalid import: ${repositoryPath}`);
        }
        if (specifier !== null && (specifier === '..' || specifier.startsWith('../'))
            && pathInside(virtualRoot, path.resolve(path.dirname(sourceFile.fileName), specifier)) === null) {
          throw new Error(`TypeScript ProjectInput import escapes its snapshot: ${repositoryPath}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
      for (const reference of sourceFile.referencedFiles) {
        if (reference.fileName.includes('\0') || path.isAbsolute(reference.fileName)) {
          throw new Error(`TypeScript ProjectInput contains an absolute triple-slash reference: ${repositoryPath}`);
        }
        const resolvedReference = path.resolve(path.dirname(sourceFile.fileName), reference.fileName);
        if (pathInside(virtualRoot, resolvedReference) === null) {
          throw new Error(`TypeScript ProjectInput triple-slash reference escapes its snapshot: ${repositoryPath}`);
        }
      }
      continue;
    }
    const defaultLibraryPath = pathInside(defaultLibraryRoot, sourceFile.fileName);
    const kind = defaultLibraryPath !== null
      ? 'default-library' as const
      : dependencyPath !== null
        ? 'dependency-generation' as const
        : null;
    const classifiedPath = defaultLibraryPath ?? dependencyPath;
    if (kind === null || classifiedPath === null) {
      throw new Error(`TypeScript Program loaded a foreign source: ${sourceFile.fileName}`);
    }
    externalSources.push(Object.freeze({
      kind,
      path: classifiedPath,
      contentDigest: rawSha256(sourceFile.text)
    }));
  }
  const sourceFacts = Object.freeze([
    projectConfig,
    ...repositorySources.values()
  ].filter((source, index, values) => values.findIndex(({ path: sourcePath }) => (
    sourcePath === source.path
  )) === index).sort((left, right) => compareCodeUnits(left.path, right.path)).map(({
    path: repositoryPath,
    contentDigest
  }) => Object.freeze({
      path: repositoryPath,
      contentDigest: contentDigest as `sha256:${string}`,
      moduleId: snapshot.moduleMembership.moduleForPath(repositoryPath)?.moduleId ?? null,
      moduleDigest: sha256(snapshot.moduleMembership.moduleForPath(repositoryPath)) as `sha256:${string}`
    })));
  const externalSourceFacts = Object.freeze(externalSources.sort((left, right) => (
    compareCodeUnits(left.kind, right.kind) || compareCodeUnits(left.path, right.path)
  )));
  dependencyGeneration?.assertCurrent();
  const orderedSourceFactsDigest = sha256({ sourceFacts, externalSourceFacts }) as `sha256:${string}`;
  const resolvedRootSourcePaths = Object.freeze(parsed.fileNames.map((fileName) => {
    const repositoryPath = pathInside(virtualRoot, fileName);
    if (repositoryPath === null || snapshot.file(repositoryPath) === null) {
      throw new Error(`TypeScript ProjectInput root source is outside its exact snapshot: ${fileName}`);
    }
    return repositoryPath;
  }).sort(compareCodeUnits));
  const resolvedConfigDigest = sha256(Object.freeze({
    directorySemantics: TYPESCRIPT_SNAPSHOT_DIRECTORY_SEMANTICS,
    compilerRevision: ts.version,
    projectConfigPath,
    projectConfigDigest: projectConfig.contentDigest,
    containedProjectConfig,
    resolvedRootSourcePaths,
    orderedSourceFactsDigest,
    dependencyGenerationDigest
  })) as `sha256:${string}`;
  const containmentCanonical = Object.freeze({
    status: 'contained' as const,
    projectConfigPath,
    projectConfigDigest: projectConfig.contentDigest as `sha256:${string}`,
    workspaceSnapshotIdentityDigest: snapshot.identityDigest,
    dependencyGenerationDigest,
    compilerRevision: ts.version,
    resolvedConfigDigest
  });
  const executionConfigContainment: WorkspaceTypeScriptExecutionConfigContainmentReceipt = Object.freeze({
    ...containmentCanonical,
    containmentDigest: sha256(containmentCanonical) as `sha256:${string}`
  });
  const observation = Object.freeze({
    sourceRevision: snapshot.sourceRevision,
    snapshotDigest: snapshot.snapshotDigest,
    workspaceSnapshotIdentityDigest: snapshot.identityDigest,
    moduleMembershipDigest: snapshot.moduleMembershipDigest,
    moduleGraphDigest: snapshot.moduleGraphDigest,
  });
  const semanticInput = Object.freeze({
    projectConfigPath,
    projectConfigDigest: projectConfig.contentDigest as `sha256:${string}`,
    dependencyGenerationDigest,
    executionConfig: Object.freeze({
      status: executionConfigContainment.status,
      projectConfigPath: executionConfigContainment.projectConfigPath,
      projectConfigDigest: executionConfigContainment.projectConfigDigest,
      dependencyGenerationDigest: executionConfigContainment.dependencyGenerationDigest,
      compilerRevision: executionConfigContainment.compilerRevision,
      resolvedConfigDigest: executionConfigContainment.resolvedConfigDigest
    }),
    sourceFacts,
    externalSourceFacts,
    orderedSourceFactsDigest
  });
  const projectInputDigest = sha256(semanticInput) as `sha256:${string}`;
  const projectInput: TypeScriptProjectInput = Object.freeze({
    [workspaceTypeScriptProjectInputBrand]: true as const,
    ...observation,
    projectConfigPath,
    projectConfigDigest: projectConfig.contentDigest as `sha256:${string}`,
    dependencyGenerationDigest,
    executionConfigContainment,
    sourceFacts,
    externalSourceFacts,
    orderedSourceFactsDigest,
    projectInputDigest,
    observationDigest: sha256({
      ...observation,
      projectInputDigest,
      snapshotSubject: snapshot.subjectDigest
    }) as `sha256:${string}`
  });
  issuedWorkspaceTypeScriptProjectInputs.add(projectInput);
  return projectInput;
}

export function issueTypeScriptProjectGenerationEvidence(
  snapshot: PhysicalWorkspaceSourceSnapshot,
  projectInput: TypeScriptProjectInput
): TypeScriptProjectGenerationEvidence {
  assertPhysicalWorkspaceSourceSnapshot(snapshot);
  assertTypeScriptProjectMatchesSnapshot(projectInput, snapshot);
  if (snapshot.subject.provenance.kind !== 'working-tree-observation') {
    throw new Error('TypeScript project generation requires one retained working-tree observation');
  }
  const generationDigest = sha256(Object.freeze({
    projectInputDigest: projectInput.projectInputDigest,
    workspaceSnapshotIdentityDigest: snapshot.identityDigest,
    physicalObservationReceipt: snapshot.physicalObservationReceipt
  })) as `sha256:${string}`;
  const sourceFiles = Object.freeze(projectInput.sourceFacts.map((fact) => {
    const file = snapshot.file(fact.path);
    if (file === null || file.contentDigest !== fact.contentDigest) {
      throw new Error(`TypeScript project generation source differs from ProjectInput: ${fact.path}`);
    }
    return file;
  }));
  const evidence: TypeScriptProjectGenerationEvidence = Object.freeze({
    [typeScriptProjectGenerationEvidenceBrand]: true as const,
    generationDigest,
    projectInput,
    sourceFiles
  });
  issuedTypeScriptProjectGenerationEvidence.add(evidence);
  return evidence;
}
