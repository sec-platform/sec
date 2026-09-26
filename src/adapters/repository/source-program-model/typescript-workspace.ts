import ts from 'typescript';
import type {
  SourceProgramFileInput,
  SourceProgramSpan
} from './contract.ts';
import type {
  SourceProgramCompilationOperation,
  SourceProgramCompilationPhase
} from './compilation-operation.ts';
import {
  sourceProgramCompilationCheckpoint
} from './compilation-operation.ts';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import path from 'node:path';
import {
  resolveRepositoryModuleImportCandidates
} from './module-graph.ts';
import {
  TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
  TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
} from './typescript-profile.ts';
import type {
  TypeScriptSourceProgramFileIdentity
} from './typescript-input.ts';

/** Language-service lifecycle and virtual workspace state; one active service per process. */
function moduleExtensionFor(fileName: string): ts.Extension {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.d.mts')) return ts.Extension.Dmts;
  if (lower.endsWith('.d.cts')) return ts.Extension.Dcts;
  if (lower.endsWith('.d.ts')) return ts.Extension.Dts;
  if (lower.endsWith('.mts')) return ts.Extension.Mts;
  if (lower.endsWith('.cts')) return ts.Extension.Cts;
  if (lower.endsWith('.tsx')) return ts.Extension.Tsx;
  if (lower.endsWith('.jsx')) return ts.Extension.Jsx;
  if (lower.endsWith('.mjs')) return ts.Extension.Mjs;
  if (lower.endsWith('.cjs')) return ts.Extension.Cjs;
  if (lower.endsWith('.js')) return ts.Extension.Js;
  return ts.Extension.Ts;
}

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
  #operation: SourceProgramCompilationOperation | null = null;
  #projectVersion = 0;

  constructor(repositoryRoot: string) {
    this.#repositoryRoot = repositoryRoot;
    const host: ts.LanguageServiceHost = {
      directoryExists: ts.sys.directoryExists,
      fileExists: (fileName) => this.#repositoryPath(fileName) !== null || ts.sys.fileExists(fileName),
      getCompilationSettings: () => TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
      getCurrentDirectory: () => this.#repositoryRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getDirectories: ts.sys.getDirectories,
      getProjectVersion: () => String(this.#projectVersion),
      getScriptFileNames: () => [...this.#files.keys()]
        .sort(compareCodeUnits)
        .map((repositoryPathValue) => path.resolve(this.#repositoryRoot, repositoryPathValue)),
      getScriptSnapshot: (fileName) => {
        this.#checkpoint('program-materialization');
        const repositoryPathValue = this.#repositoryPath(fileName);
        if (repositoryPathValue !== null) return this.#files.get(repositoryPathValue)?.snapshot;
        const source = ts.sys.readFile(fileName);
        return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: (fileName) => {
        const repositoryPathValue = this.#repositoryPath(fileName);
        return repositoryPathValue === null
          ? TYPESCRIPT_WORKSPACE_DEPENDENCY_GENERATION_DIGEST
          : String(this.#files.get(repositoryPathValue)?.version ?? 0);
      },
      readDirectory: ts.sys.readDirectory,
      readFile: (fileName) => {
        const repositoryPathValue = this.#repositoryPath(fileName);
        if (repositoryPathValue === null) return ts.sys.readFile(fileName);
        const snapshot = this.#files.get(repositoryPathValue)?.snapshot;
        return snapshot?.getText(0, snapshot.getLength());
      },
      realpath: ts.sys.realpath,
      resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((moduleName) => {
        this.#checkpoint('program-materialization');
        const containingRepositoryPath = this.#repositoryPath(containingFile);
        if (containingRepositoryPath !== null && moduleName.startsWith('.')) {
          const targetPath = resolveRepositoryModuleImportCandidates(
            containingRepositoryPath,
            moduleName
          ).find((candidate) => this.#files.has(candidate));
          if (targetPath !== undefined) {
            return {
              extension: moduleExtensionFor(targetPath),
              isExternalLibraryImport: false,
              resolvedFileName: path.resolve(this.#repositoryRoot, targetPath)
            };
          }
        }
        // Source Program owns repository-local symbol and capability facts,
        // not package typechecking. Loading external declaration graphs here
        // duplicates the canonical TypeScript checker and turns one repository
        // audit into an unbounded node_modules census. External packages remain
        // explicit opaque dependencies in the model compiled below.
        if (containingRepositoryPath !== null && moduleName !== 'typescript') return undefined;
        return ts.resolveModuleName(
          moduleName,
          containingFile,
          TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS,
          ts.sys
        ).resolvedModule;
      }),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames
    };
    this.#service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }

  compile(
    filesByPath: ReadonlyMap<string, SourceProgramFileInput>,
    sourceFileIdentities: ReadonlyMap<string, TypeScriptSourceProgramFileIdentity>,
    operation: SourceProgramCompilationOperation
  ): ExactTypeScriptProgram {
    this.#operation = operation;
    sourceProgramCompilationCheckpoint(operation, 'program-materialization', 'start');
    const nextPaths = new Set(filesByPath.keys());
    let changed = false;
    for (const repositoryPathValue of this.#files.keys()) {
      if (nextPaths.has(repositoryPathValue)) continue;
      this.#files.delete(repositoryPathValue);
      changed = true;
    }
    for (const [repositoryPathValue, file] of filesByPath) {
      const current = this.#files.get(repositoryPathValue);
      const identityDigest = sourceFileIdentities.get(repositoryPathValue)?.rawFileDigest;
      if (identityDigest === undefined) {
        throw new Error(`TypeScript Program file identity is absent: ${repositoryPathValue}`);
      }
      if (current?.identityDigest === identityDigest) continue;
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
    const program = this.#service.getProgram();
    if (program === undefined) throw new Error('Source Program TypeScript workspace has no Program');
    const rootNames = [...this.#files.keys()]
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
      checker: program.getTypeChecker(),
      program,
      renameAt,
      repositoryPath: (sourceFile) => {
        const repositoryPathValue = this.#repositoryPath(sourceFile.fileName);
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
  operation: SourceProgramCompilationOperation
): ExactTypeScriptProgram {
  const repositoryRoot = process.cwd();
  if (activeTypeScriptWorkspace === null || activeTypeScriptWorkspaceRoot !== repositoryRoot) {
    activeTypeScriptWorkspace?.dispose();
    activeTypeScriptWorkspace = new TypeScriptSourceProgramWorkspace(repositoryRoot);
    activeTypeScriptWorkspaceRoot = repositoryRoot;
  }
  return activeTypeScriptWorkspace.compile(filesByPath, sourceFileIdentities, operation);
}
