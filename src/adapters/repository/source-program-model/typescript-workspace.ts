import path from 'node:path';
import ts from 'typescript';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import { createTypeScriptSnapshotDirectoryReader } from '../../toolchain/typescript/snapshot-directory.ts';
import type { RepositoryModuleRuntimeRelation } from '../architecture/contract.ts';
import type {
  SourceProgramCompilationOperation,
  SourceProgramCompilationPhase
} from './compilation-operation.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import type {
  SourceProgramFileInput,
  SourceProgramSpan
} from './contract.ts';
import {
  SOURCE_EXTENSION,
  type TypeScriptSourceProgramFileIdentity
} from './typescript-input.ts';
import {
  directTypeScriptPackageImportAddress,
  directTypeScriptSourceAddress,
  observeTypeScriptImportLoader
} from './typescript-module-loader.ts';
import {
  TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
  TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
} from './typescript-profile.ts';

export type TypeScriptResolutionSnapshot = Readonly<{
  files: readonly SourceProgramFileInput[];
  membershipPaths: readonly string[];
}>;

export type TypeScriptModuleResolutionObservation = Readonly<{
  status: 'resolved' | 'unresolved' | 'external';
  resolvedTarget: string | null;
  runtime: Exclude<RepositoryModuleRuntimeRelation, Readonly<{ kind: 'none' }>>;
  lookupPaths: readonly string[];
  missingInputs: readonly string[];
}>;

const unresolvedModule = Object.freeze({
  status: 'unresolved' as const,
  resolvedTarget: null,
  runtime: Object.freeze({ kind: 'unresolved' as const }),
  lookupPaths: Object.freeze([] as string[]),
  missingInputs: Object.freeze([] as string[])
});

function resolutionKey(sourcePath: string, literal: ts.StringLiteralLike): string {
  return JSON.stringify([sourcePath, literal.pos, literal.end, literal.text]);
}

type ResolutionGeneration = Readonly<{
  snapshot: ReadonlyMap<string, SourceProgramFileInput>;
  members: ReadonlyMap<string, string>;
  directory: ReturnType<typeof createTypeScriptSnapshotDirectoryReader>;
  operation: SourceProgramCompilationOperation;
  facts: Map<string, TypeScriptModuleResolutionObservation>;
}>;

interface SourceProgramTypeScriptRenameLocation {
  readonly path: string;
  readonly span: SourceProgramSpan;
  readonly prefixText: string;
  readonly suffixText: string;
}

export type TypeScriptRenameObservation = Readonly<{
  readonly status: 'resolved';
  readonly canRename: boolean;
  readonly rejectionReason: string | null;
  readonly locations: readonly SourceProgramTypeScriptRenameLocation[];
  readonly observationDigest: `sha256:${string}`;
}> | Readonly<{
  readonly status: 'unresolved';
  readonly reason:
    | 'exact-generation-unavailable'
    | 'generation-stale'
    | 'position-unresolved'
    | 'rename-location-outside-generation';
  readonly observationDigest: `sha256:${string}`;
}>;

export type ExactTypeScriptProgram = Readonly<{
  checker: ts.TypeChecker;
  program: ts.Program;
  renameAt(repositoryPath: string, position: number): TypeScriptRenameObservation;
  repositoryPath(sourceFile: ts.SourceFile): string;
  sourceFiles: readonly ts.SourceFile[];
  moduleResolutionAt(sourceFile: ts.SourceFile, literal: ts.StringLiteralLike): TypeScriptModuleResolutionObservation;
}>;

/**
 * One process owns one exact TypeScript workspace. LanguageService only reuses
 * immutable compiler snapshots; repository facts remain owned by the canonical
 * SourceProgramModel produced below. There is no watcher, daemon or second AST.
 */
class TypeScriptSourceProgramWorkspace {
  readonly #repositoryRoot: string;
  readonly #service: ts.LanguageService;
  readonly #files = new Map<string, Readonly<{
    identityDigest: string;
    snapshot: ts.IScriptSnapshot;
    version: number;
  }>>();
  #canonicalByAbsolute = new Map<string, string>();
  #rootPaths = new Set<string>();
  #operation: SourceProgramCompilationOperation | null = null;
  #projectVersion = 0;
  #snapshot = new Map<string, SourceProgramFileInput>();
  #members = new Map<string, string>();
  #directory: ReturnType<typeof createTypeScriptSnapshotDirectoryReader>;
  #resolutionDigest = '';
  #resolutionFacts = new Map<string, TypeScriptModuleResolutionObservation>();
  #resolutionGeneration: ResolutionGeneration | null = null;
  readonly #libraryRoot = path.dirname(ts.sys.getExecutingFilePath());

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = repositoryRoot;
    this.#directory = createTypeScriptSnapshotDirectoryReader([], repositoryRoot);
    const host: ts.LanguageServiceHost = {
      directoryExists: (directoryName) => this.#isLibraryPath(directoryName)
        ? ts.sys.directoryExists(directoryName) : this.#directory.directoryExists(directoryName),
      fileExists: (fileName) => this.#isLibraryPath(fileName)
        ? ts.sys.fileExists(fileName) : this.#memberPath(fileName) !== null,
      getCompilationSettings: () => TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
      getCurrentDirectory: () => this.#repositoryRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getDirectories: (directoryName) => this.#isLibraryPath(directoryName)
        ? ts.sys.getDirectories(directoryName) : this.#directory.getDirectories(directoryName),
      getProjectVersion: () => String(this.#projectVersion),
      getScriptFileNames: () => [...this.#rootPaths]
        .sort(compareCodeUnits)
        .map((repositoryPathValue) => path.resolve(this.#repositoryRoot, repositoryPathValue)),
      getScriptSnapshot: (fileName) => {
        this.#checkpoint('program-materialization');
        const repositoryPathValue = this.#repositoryPath(fileName);
        if (repositoryPathValue !== null) return this.#files.get(repositoryPathValue)?.snapshot;
        const source = this.#readSource(fileName);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: (fileName) => {
        const repositoryPathValue = this.#repositoryPath(fileName);
        return repositoryPathValue === null
          ? TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
          : String(this.#files.get(repositoryPathValue)?.version ?? 0);
      },
      readDirectory: (directoryName, extensions, excludes, includes, depth) => this.#isLibraryPath(directoryName)
        ? ts.sys.readDirectory(directoryName, extensions, excludes, includes, depth)
        : this.#directory(directoryName, extensions, excludes, includes, depth),
      readFile: (fileName) => this.#readSource(fileName),
      realpath: (fileName) => this.#isLibraryPath(fileName)
        ? ts.sys.realpath?.(fileName) ?? fileName : path.resolve(fileName),
      resolveModuleNameLiterals: (literals, containingFile, redirectedReference, options, sourceFile) => (
        literals.map((literal) => this.#resolveModule(sourceFile, literal, containingFile, options, redirectedReference))
      ),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
    };
    this.#service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  compile(
    filesByPath: ReadonlyMap<string, SourceProgramFileInput>,
    sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>,
    operation: SourceProgramCompilationOperation,
    resolutionSnapshot: TypeScriptResolutionSnapshot
  ): ExactTypeScriptProgram {
    this.#operation = operation;
    sourceProgramCompilationCheckpoint(operation, 'program-materialization', 'start');
    const membership = [...new Set(resolutionSnapshot.membershipPaths)].sort(compareCodeUnits);
    const directory = createTypeScriptSnapshotDirectoryReader(membership, this.#repositoryRoot);
    const snapshot = new Map<string, SourceProgramFileInput>();
    const members = new Map(membership.map((repositoryPathValue) => [
      this.#absoluteKey(path.resolve(this.#repositoryRoot, repositoryPathValue)), repositoryPathValue
    ]));
    const membershipSet = new Set(membership);
    for (const file of resolutionSnapshot.files) {
      if (!membershipSet.has(file.path) || snapshot.has(file.path)) {
        throw new Error(`TypeScript resolution snapshot has invalid file membership: ${file.path}`);
      }
      snapshot.set(file.path, Object.freeze({ ...file }));
    }
    for (const [repositoryPathValue, file] of filesByPath) {
      const retained = snapshot.get(repositoryPathValue);
      if (retained === undefined || retained.source !== file.source || retained.contentDigest !== file.contentDigest) {
        throw new Error(`TypeScript Program root differs from its resolution snapshot: ${repositoryPathValue}`);
      }
    }
    const resolutionDigest = sha256({
      membership,
      capturedPaths: [...snapshot.keys()].sort(compareCodeUnits),
      metadata: [...snapshot.values()].filter((file) => !SOURCE_EXTENSION.test(file.path))
        .sort((left, right) => compareCodeUnits(left.path, right.path))
    });
    const resolutionChanged = resolutionDigest !== this.#resolutionDigest;
    const unchangedSources = new Set([...snapshot].filter(([sourcePath, file]) => (
      this.#snapshot.get(sourcePath)?.source === file.source
    )).map(([sourcePath]) => sourcePath));
    // Facts belong to the captured generation. Only unchanged occurrences in
    // an unchanged resolution environment may seed the next generation.
    this.#resolutionFacts = resolutionChanged ? new Map() : new Map(
      [...this.#resolutionFacts].filter(([key]) => unchangedSources.has(JSON.parse(key)[0]))
    );
    this.#snapshot = snapshot;
    this.#members = members;
    this.#directory = directory;
    if (resolutionChanged) {
      this.#resolutionDigest = resolutionDigest;
    }
    const resolutionGeneration: ResolutionGeneration = Object.freeze({
      snapshot, members, directory, operation, facts: this.#resolutionFacts
    });
    this.#resolutionGeneration = resolutionGeneration;
    const nextRoots = new Set(filesByPath.keys());
    const rootsChanged = nextRoots.size !== this.#rootPaths.size
      || [...nextRoots].some((sourcePath) => !this.#rootPaths.has(sourcePath));
    this.#rootPaths = nextRoots;
    const nextPaths = new Set(snapshot.keys());
    let changed = resolutionChanged || rootsChanged;
    for (const repositoryPathValue of this.#files.keys()) {
      if (nextPaths.has(repositoryPathValue)) continue;
      this.#files.delete(repositoryPathValue);
      changed = true;
    }
    for (const [repositoryPathValue, file] of snapshot) {
      const current = this.#files.get(repositoryPathValue);
      const rootIdentity = sourceFileIdentities.get(repositoryPathValue)?.rawFileDigest;
      if (nextRoots.has(repositoryPathValue) && rootIdentity === undefined) {
        throw new Error(`TypeScript Program file identity is absent: ${repositoryPathValue}`);
      }
      const identityDigest = rootIdentity ?? sha256({ source: file.source, contentDigest: file.contentDigest });
      if (current?.identityDigest === identityDigest && !resolutionChanged) continue;
      this.#files.set(repositoryPathValue, Object.freeze({
        identityDigest,
        snapshot: ts.ScriptSnapshot.fromString(file.source),
        version: (current?.version ?? 0) + 1
      }));
      changed = true;
    }
    if (changed) {
      this.#canonicalByAbsolute = new Map(
        [...this.#files.keys()].map((repositoryPathValue) => [
          this.#absoluteKey(path.resolve(this.#repositoryRoot, repositoryPathValue)),
          repositoryPathValue
        ] as const)
      );
      this.#projectVersion += 1;
    }
    // Public LanguageService invalidation drops the old Program and its
    // resolutions. The changed project/script versions rebuild from the sealed
    // metadata; ordinary leaf edits keep the incremental Program path.
    if (resolutionChanged) this.#service.cleanupSemanticCache();
    const program = this.#service.getProgram();
    if (program === undefined) throw new Error('Source Program TypeScript workspace has no Program');
    const rootNames = [...this.#rootPaths]
      .sort(compareCodeUnits)
      .map((repositoryPathValue) => path.resolve(this.#repositoryRoot, repositoryPathValue));
    const sourceFiles = rootNames.map((rootName) => program.getSourceFile(rootName)).filter(
      (sourceFile): sourceFile is ts.SourceFile => sourceFile !== undefined
    );
    if (sourceFiles.length !== rootNames.length) {
      throw new Error(
        `TypeScript Program omitted exact repository roots: expected ${rootNames.length}, got ${sourceFiles.length}`
      );
    }
    const generationProjectVersion = this.#projectVersion;
    const canonicalByAbsolute = this.#canonicalByAbsolute;
    const checker = program.getTypeChecker();
    const resolutionFacts = resolutionGeneration.facts;
    const sourceFileByRepositoryPath = new Map(sourceFiles.map((sourceFile) => [
      this.#repositoryPath(sourceFile.fileName)!,
      sourceFile
    ] as const));
    const renameAt = (
      repositoryPathValue: string,
      position: number
    ): TypeScriptRenameObservation => {
      const unresolved = (
        reason: Extract<TypeScriptRenameObservation, { status: 'unresolved' }>['reason']
      ): TypeScriptRenameObservation => Object.freeze({
        status: 'unresolved' as const,
        reason,
        observationDigest: sha256({
          status: 'unresolved',
          reason,
          generationProjectVersion,
          repositoryPath: repositoryPathValue,
          position
        }) as `sha256:${string}`
      });
      if (this.#projectVersion !== generationProjectVersion) return unresolved('generation-stale');
      const sourceFile = sourceFileByRepositoryPath.get(repositoryPathValue);
      if (sourceFile === undefined || position < 0 || position >= sourceFile.text.length) {
        return unresolved('position-unresolved');
      }
      const absolutePath = path.resolve(this.#repositoryRoot, repositoryPathValue);
      const renameInfo = this.#service.getRenameInfo(absolutePath, position, {
        allowRenameOfImportPath: false
      });
      const rawLocations = renameInfo.canRename
        ? this.#service.findRenameLocations(absolutePath, position, false, false, true) ?? []
        : [];
      const locations: SourceProgramTypeScriptRenameLocation[] = [];
      for (const location of rawLocations) {
        const locationPath = this.#repositoryPath(location.fileName);
        const locationSource = locationPath === null
          ? undefined
          : sourceFileByRepositoryPath.get(locationPath);
        if (locationPath === null || locationSource === undefined) {
          return unresolved('rename-location-outside-generation');
        }
        const start = location.textSpan.start;
        const end = start + location.textSpan.length;
        if (start < 0 || end < start || end > locationSource.text.length) {
          return unresolved('position-unresolved');
        }
        const startLocation = locationSource.getLineAndCharacterOfPosition(start);
        const endLocation = locationSource.getLineAndCharacterOfPosition(end);
        locations.push(Object.freeze({
          path: locationPath,
          span: Object.freeze({
            start,
            end,
            startLine: startLocation.line + 1,
            startColumn: startLocation.character + 1,
            endLine: endLocation.line + 1,
            endColumn: endLocation.character + 1
          }),
          prefixText: location.prefixText ?? '',
          suffixText: location.suffixText ?? ''
        }));
      }
      locations.sort((left, right) => compareCodeUnits(left.path, right.path)
        || left.span.start - right.span.start);
      const canonical = Object.freeze({
        status: 'resolved' as const,
        canRename: renameInfo.canRename,
        rejectionReason: renameInfo.canRename ? null : renameInfo.localizedErrorMessage,
        locations: Object.freeze(locations),
        generationProjectVersion,
        repositoryPath: repositoryPathValue,
        position
      });
      return Object.freeze({
        status: canonical.status,
        canRename: canonical.canRename,
        rejectionReason: canonical.rejectionReason,
        locations: canonical.locations,
        observationDigest: sha256(canonical) as `sha256:${string}`
      });
    };
    sourceProgramCompilationCheckpoint(operation, 'program-materialization', 'complete');
    return Object.freeze({
      checker,
      program,
      moduleResolutionAt: (sourceFile: ts.SourceFile, literal: ts.StringLiteralLike) => {
        if (program.getSourceFile(sourceFile.fileName) !== sourceFile || literal.getSourceFile() !== sourceFile) {
          return unresolvedModule;
        }
        const sourcePath = path.relative(this.#repositoryRoot, sourceFile.fileName).replaceAll('\\', '/');
        const key = resolutionKey(sourcePath, literal);
        if (!resolutionFacts.has(key)) {
          this.#resolveModule(sourceFile, literal, sourceFile.fileName,
            program.getCompilerOptions(), undefined, resolutionGeneration);
        }
        return resolutionFacts.get(key) ?? unresolvedModule;
      },
      renameAt,
      repositoryPath: (sourceFile) => {
        const repositoryPathValue = canonicalByAbsolute.get(this.#absoluteKey(path.resolve(sourceFile.fileName))) ?? null;
        if (repositoryPathValue === null) {
          throw new Error(`TypeScript Program source escaped exact repository census: ${sourceFile.fileName}`);
        }
        return repositoryPathValue;
      },
      sourceFiles: Object.freeze(sourceFiles)
    });
  }

  dispose(): void {
    this.#service.cleanupSemanticCache();
    this.#service.dispose();
    this.#files.clear();
    this.#canonicalByAbsolute.clear();
    this.#projectVersion += 1;
  }

  #absoluteKey(value: string): string {
    const normalized = value.replaceAll('\\', '/');
    return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
  }

  #isLibraryPath(fileName: string): boolean {
    const relative = path.relative(this.#libraryRoot, path.resolve(fileName));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
  }

  #memberPath(fileName: string): string | null {
    return this.#members.get(this.#absoluteKey(path.resolve(fileName))) ?? null;
  }

  #readSource(fileName: string): string | undefined {
    this.#checkpoint('program-materialization');
    if (this.#isLibraryPath(fileName)) return ts.sys.readFile(fileName);
    const repositoryPathValue = this.#memberPath(fileName);
    return repositoryPathValue === null ? undefined : this.#snapshot.get(repositoryPathValue)?.source;
  }

  #resolveModule(
    sourceFile: ts.SourceFile,
    literal: ts.StringLiteralLike,
    containingFile: string,
    options: ts.CompilerOptions,
    redirectedReference: ts.ResolvedProjectReference | undefined,
    generation: ResolutionGeneration | null = this.#resolutionGeneration
  ): ts.ResolvedModuleWithFailedLookupLocations {
    if (generation === null) throw new Error('TypeScript resolution generation is unavailable');
    const checkpoint = () => sourceProgramCompilationCheckpoint(generation.operation, 'program-materialization');
    checkpoint();
    const memberPath = (fileName: string) => generation.members.get(this.#absoluteKey(path.resolve(fileName))) ?? null;
    const sourcePath = memberPath(containingFile);
    if (sourcePath === null) return { resolvedModule: undefined };
    const lookupPaths = new Set<string>();
    const missingInputs = new Set<string>();
    let nearestManifest: SourceProgramFileInput | null = null;
    const missingInput = Symbol('typescript-resolution-input-required');
    const repositoryPath = (fileName: string): string | null => {
      const relative = path.relative(this.#repositoryRoot, path.resolve(fileName));
      return relative !== '' && !path.isAbsolute(relative) && relative !== '..'
        && !relative.startsWith(`..${path.sep}`) ? relative.replaceAll('\\', '/') : null;
    };
    const observe = (fileName: string): string | null => {
      checkpoint();
      const relative = repositoryPath(fileName);
      if (relative !== null) lookupPaths.add(relative);
      return relative;
    };
    const host: ts.ModuleResolutionHost = {
      fileExists: (fileName) => {
        observe(fileName);
        return memberPath(fileName) !== null;
      },
      readFile: (fileName) => {
        const relative = observe(fileName);
        if (relative === null || memberPath(fileName) === null) return undefined;
        const file = generation.snapshot.get(relative);
        if (file === undefined) {
          missingInputs.add(relative);
          throw missingInput;
        }
        if (nearestManifest === null && path.posix.basename(relative) === 'package.json') {
          const directory = path.posix.dirname(relative);
          const fromDirectory = path.posix.relative(directory, path.posix.dirname(sourcePath));
          if (fromDirectory === '' || (fromDirectory !== '..' && !fromDirectory.startsWith('../'))) {
            nearestManifest = file;
          }
        }
        return file.source;
      },
      // Leave directoryExists absent so the public resolver issues file probes
      // even below absent directories. Each negative file lookup then belongs
      // to this snapshot without depending on private TS result fields.
      getDirectories: (directoryName) => generation.directory.getDirectories(directoryName),
      getCurrentDirectory: () => this.#repositoryRoot,
      realpath: (fileName) => path.resolve(fileName),
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames
    };
    let result: ts.ResolvedModuleWithFailedLookupLocations = { resolvedModule: undefined };
    let status: TypeScriptModuleResolutionObservation['status'] = 'unresolved';
    let target: string | null = null;
    const local = literal.text.startsWith('.') || literal.text.startsWith('#');
    let operand: ts.Node = literal;
    while (ts.isParenthesizedExpression(operand.parent) || ts.isAsExpression(operand.parent)
        || ts.isTypeAssertionExpression(operand.parent) || ts.isNonNullExpression(operand.parent)
        || ts.isSatisfiesExpression(operand.parent)) operand = operand.parent;
    let mode = ts.getModeForUsageLocation(sourceFile, literal, options);
    if (ts.isCallExpression(operand.parent) && operand.parent.arguments.includes(operand as ts.Expression)) {
      // The load observer owns recognition of indirect require calls. For its
      // requested literal, call syntax supplies the compiler's resolution mode.
      mode = operand.parent.expression.kind === ts.SyntaxKind.ImportKeyword
        ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS;
    }
    try {
      if (local) {
        // The same compiler determines package mode before resolving this usage.
        // A present but unread package cannot be treated as an absent boundary.
        ts.getImpliedNodeFormatForFile(containingFile, undefined, host, options);
        result = ts.resolveModuleName(literal.text, containingFile, options, host, undefined,
          redirectedReference, mode);
        const resolved = result.resolvedModule;
        if (resolved !== undefined) {
          target = repositoryPath(resolved.resolvedFileName);
          if (target !== null) {
            lookupPaths.add(target);
            if (!generation.snapshot.has(target)) missingInputs.add(target);
            else if (memberPath(resolved.resolvedFileName) !== null) status = 'resolved';
          }
        }
      } else {
        status = 'external';
        // Preserve the existing qualified compiler API dependency, without
        // enrolling arbitrary external package declaration graphs.
        if (literal.text === 'typescript') {
          result = ts.resolveModuleName(literal.text, containingFile, options, ts.sys, undefined,
            redirectedReference, mode);
          if (result.resolvedModule !== undefined && !this.#isLibraryPath(result.resolvedModule.resolvedFileName)) {
            result = { resolvedModule: undefined };
          }
        }
      }
    } catch (error) {
      if (error !== missingInput) throw error;
    }
    if (status !== 'resolved' && local) {
      target = null;
      result = { resolvedModule: undefined };
    }
    const loader = observeTypeScriptImportLoader(literal, sourceFile);
    let runtime: TypeScriptModuleResolutionObservation['runtime'] = Object.freeze({ kind: 'unresolved' });
    if (loader !== 'unresolved') {
      if (status === 'external') {
        runtime = Object.freeze({ kind: 'external' });
      } else {
        const direct = literal.text.startsWith('#')
          ? nearestManifest === null ? null : directTypeScriptPackageImportAddress(nearestManifest, literal.text, loader)
          : directTypeScriptSourceAddress(path.posix.dirname(sourcePath), literal.text, loader);
        if (loader === 'file' && direct !== null) {
          lookupPaths.add(direct);
          if (generation.snapshot.has(direct) && generation.members.has(this.#absoluteKey(path.resolve(this.#repositoryRoot, direct)))) {
            runtime = Object.freeze({ kind: 'asset', target: direct });
          } else if (generation.members.has(this.#absoluteKey(path.resolve(this.#repositoryRoot, direct)))) {
            missingInputs.add(direct);
          }
        } else if (status === 'resolved' && target !== null && missingInputs.size === 0 && direct === target) {
          runtime = Object.freeze({ kind: 'module', target });
        }
      }
    }
    generation.facts.set(resolutionKey(sourcePath, literal), Object.freeze({
      status,
      resolvedTarget: target,
      runtime,
      lookupPaths: Object.freeze([...lookupPaths].sort(compareCodeUnits)),
      missingInputs: Object.freeze([...missingInputs].sort(compareCodeUnits))
    }));
    return result;
  }

  #repositoryPath(fileName: string): string | null {
    return this.#canonicalByAbsolute.get(this.#absoluteKey(path.resolve(fileName))) ?? null;
  }

  #checkpoint(phase: SourceProgramCompilationPhase): void {
    if (this.#operation !== null) sourceProgramCompilationCheckpoint(this.#operation, phase);
  }
}

let activeTypeScriptWorkspace: TypeScriptSourceProgramWorkspace | null = null;

let activeTypeScriptWorkspaceRoot: string | null = null;

/** Release one process-local edit snapshot after its compact evidence is sealed. */
export function releaseTypeScriptWorkspace(): void {
  activeTypeScriptWorkspace?.dispose();
  activeTypeScriptWorkspace = null;
  activeTypeScriptWorkspaceRoot = null;
}

export function compileExactTypeScriptProgram(
  filesByPath: ReadonlyMap<string, SourceProgramFileInput>,
  sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>,
  operation: SourceProgramCompilationOperation,
  resolutionSnapshot: TypeScriptResolutionSnapshot
): ExactTypeScriptProgram {
  const repositoryRoot = process.cwd();
  if (activeTypeScriptWorkspace === null || activeTypeScriptWorkspaceRoot !== repositoryRoot) {
    activeTypeScriptWorkspace?.dispose();
    activeTypeScriptWorkspace = new TypeScriptSourceProgramWorkspace(repositoryRoot);
    activeTypeScriptWorkspaceRoot = repositoryRoot;
  }
  return activeTypeScriptWorkspace.compile(filesByPath, sourceFileIdentities, operation, resolutionSnapshot);
}
