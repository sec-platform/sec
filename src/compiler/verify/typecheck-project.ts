import path from 'node:path';
import ts from 'typescript';
import { CompilerError } from '../errors.ts';
import { pathExists } from '../../workspace/files.ts';
import { compilerRoot, isPathInside, relativePosixPath } from '../../workspace/paths.ts';
import { withProjectDependencyBridge } from '../../toolchain/dependencies/runtime.ts';

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const filePath = relativePosixPath(process.cwd(), diagnostic.file.fileName);
  return `${filePath}:${position.line + 1}:${position.character + 1} ${message}`;
}

function isolatedSourceEscape(
  dependencyProjectRoot: string,
  sourceFileName: string
): CompilerError {
  const escapedSourcePath = relativePosixPath(
    dependencyProjectRoot,
    sourceFileName
  ).slice(0, 256);
  return new CompilerError(
    'VERIFY-ISOLATION-003',
    `Isolated typecheck resolved a source outside its project and plan-bound dependency roots (${escapedSourcePath})`,
    { sourceFile: escapedSourcePath }
  );
}

function createIsolatedCompilerHost(
  projectRoot: string,
  dependencyProjectRoot: string,
  compilerOptions: ts.CompilerOptions
): Readonly<{
  allowedSourceRoots: readonly string[];
  host: ts.CompilerHost;
}> {
  const dependencyNodeModulesRoot = path.join(dependencyProjectRoot, 'node_modules');
  const baseHost = ts.createCompilerHost(compilerOptions, true);
  const allowedSourceRoots = Object.freeze([
    path.resolve(projectRoot),
    dependencyNodeModulesRoot,
    baseHost.getDefaultLibLocation?.() ??
      path.dirname(baseHost.getDefaultLibFileName(compilerOptions))
  ]);
  const isAllowedSource = (fileName: string): boolean =>
    allowedSourceRoots.some((root) => isPathInside(root, fileName));
  const isPlanBoundDependency = (fileName: string): boolean =>
    isPathInside(dependencyNodeModulesRoot, fileName);
  const isAllowedDirectory = (directoryName: string): boolean =>
    allowedSourceRoots.some((root) =>
      isPathInside(root, directoryName) || isPathInside(directoryName, root));
  const dependencyPackagePath = path.join(dependencyProjectRoot, 'package.json');
  const isAllowedRead = (fileName: string): boolean =>
    isAllowedSource(fileName) || path.resolve(fileName) === path.resolve(dependencyPackagePath);
  const resolutionHost: ts.ModuleResolutionHost = {
    directoryExists: (directoryName) =>
      isAllowedDirectory(directoryName) && (baseHost.directoryExists?.(directoryName) ?? false),
    fileExists: (fileName) => isAllowedRead(fileName) && baseHost.fileExists(fileName),
    getCurrentDirectory: () => dependencyProjectRoot,
    getDirectories: (directoryName) => isAllowedDirectory(directoryName)
      ? (baseHost.getDirectories?.(directoryName) ?? []).filter(isAllowedDirectory)
      : [],
    readFile: (fileName) => isAllowedRead(fileName) ? baseHost.readFile(fileName) : undefined,
    realpath: (fileName) => {
      if (isAllowedRead(fileName)) {
        const resolved = baseHost.realpath?.(fileName) ?? fileName;
        if (!isAllowedRead(resolved)) {
          throw isolatedSourceEscape(dependencyProjectRoot, resolved);
        }
        return resolved;
      }
      const containingRoot = allowedSourceRoots.find((root) => isPathInside(root, fileName));
      if (containingRoot) {
        const resolved = baseHost.realpath?.(fileName) ?? fileName;
        if (!isPathInside(containingRoot, resolved)) {
          throw isolatedSourceEscape(dependencyProjectRoot, resolved);
        }
        return resolved;
      }
      if (!isAllowedDirectory(fileName)) {
        return fileName;
      }
      const resolved = baseHost.realpath?.(fileName) ?? fileName;
      if (!isPathInside(fileName, resolved) || !isPathInside(resolved, fileName)) {
        throw isolatedSourceEscape(dependencyProjectRoot, resolved);
      }
      return resolved;
    }
  };
  const moduleResolutionCache = ts.createModuleResolutionCache(
    dependencyProjectRoot,
    baseHost.getCanonicalFileName,
    compilerOptions
  );
  const typeReferenceResolutionCache = ts.createTypeReferenceDirectiveResolutionCache(
    dependencyProjectRoot,
    baseHost.getCanonicalFileName,
    compilerOptions
  );
  const assertResolvedSource = (
    sourceFileName: string | undefined,
    allowed: (fileName: string) => boolean = isAllowedSource
  ): void => {
    if (sourceFileName === undefined) return;
    if (!allowed(sourceFileName)) throw isolatedSourceEscape(dependencyProjectRoot, sourceFileName);
    const physicalSourceFileName = baseHost.realpath?.(sourceFileName) ?? sourceFileName;
    if (!allowed(physicalSourceFileName)) {
      throw isolatedSourceEscape(dependencyProjectRoot, physicalSourceFileName);
    }
  };
  const host: ts.CompilerHost = {
    ...baseHost,
    directoryExists: resolutionHost.directoryExists!,
    fileExists: resolutionHost.fileExists,
    getCurrentDirectory: resolutionHost.getCurrentDirectory!,
    getDirectories: resolutionHost.getDirectories!,
    getModuleResolutionCache: () => moduleResolutionCache,
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      if (!isAllowedSource(fileName)) {
        throw isolatedSourceEscape(dependencyProjectRoot, fileName);
      }
      assertResolvedSource(fileName);
      return baseHost.getSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile
      );
    },
    readFile: resolutionHost.readFile,
    realpath: resolutionHost.realpath!,
    resolveModuleNameLiterals: (
      moduleLiterals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile
    ) => moduleLiterals.map((moduleLiteral) => {
      const resolution = ts.resolveModuleName(
        moduleLiteral.text,
        containingFile,
        options,
        resolutionHost,
        moduleResolutionCache,
        redirectedReference,
        ts.getModeForUsageLocation(containingSourceFile, moduleLiteral, options)
      );
      assertResolvedSource(
        resolution.resolvedModule?.resolvedFileName,
        ts.isExternalModuleNameRelative(moduleLiteral.text) || path.isAbsolute(moduleLiteral.text)
          ? isAllowedSource
          : isPlanBoundDependency
      );
      return resolution;
    }),
    resolveTypeReferenceDirectiveReferences: (
      typeDirectiveReferences,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile
    ) => typeDirectiveReferences.map((typeDirectiveReference) => {
      const typeDirectiveName = typeof typeDirectiveReference === 'string'
        ? typeDirectiveReference
        : typeDirectiveReference.fileName;
      const resolution = ts.resolveTypeReferenceDirective(
        typeDirectiveName,
        containingFile,
        options,
        resolutionHost,
        redirectedReference,
        typeReferenceResolutionCache,
        ts.getModeForFileReference(
          typeDirectiveReference,
          containingSourceFile?.impliedNodeFormat
        )
      );
      assertResolvedSource(
        resolution.resolvedTypeReferenceDirective?.resolvedFileName,
        ts.isExternalModuleNameRelative(typeDirectiveName) || path.isAbsolute(typeDirectiveName)
          ? isAllowedSource
          : isPlanBoundDependency
      );
      return resolution;
    })
  };
  return Object.freeze({ allowedSourceRoots, host });
}

export async function typecheckProject(
  projectRoot: string,
  options: {
    readonly dependencyProjectRoot?: string;
    readonly isolated?: boolean;
  } = {}
): Promise<void> {
  const dependencyProjectRoot = path.resolve(options.dependencyProjectRoot ?? projectRoot);
  const dependencyNodeModulesRoot = path.join(dependencyProjectRoot, 'node_modules');
  if (options.isolated && !isPathInside(dependencyProjectRoot, projectRoot)) {
    throw new CompilerError(
      'VERIFY-ISOLATION-002',
      'Isolated typecheck project must remain inside its plan-bound dependency project'
    );
  }
  const execute = async (): Promise<void> => {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    if (!(await pathExists(tsconfigPath))) {
      throw new CompilerError('VERIFY-BUILD-001', 'Generated project is missing tsconfig.json');
    }

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (configFile.error) {
      throw new CompilerError(
        'VERIFY-BUILD-003',
        'Failed to read generated project tsconfig',
        formatDiagnostic(configFile.error)
      );
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot, undefined, tsconfigPath);
    if (parsed.errors.length > 0) {
      throw new CompilerError(
        'VERIFY-BUILD-004',
        'Generated project tsconfig is invalid',
        parsed.errors.map(formatDiagnostic)
      );
    }

    const compilerOptions: ts.CompilerOptions = {
      ...parsed.options,
      typeRoots: options.isolated
        ? [path.join(dependencyNodeModulesRoot, '@types'), dependencyNodeModulesRoot]
        : [...new Set([
            ...(parsed.options.typeRoots ?? []),
            path.join(dependencyNodeModulesRoot, '@types'),
            path.join(compilerRoot, 'node_modules', '@types')
          ])]
    };
    const isolatedCompiler = options.isolated
      ? createIsolatedCompilerHost(projectRoot, dependencyProjectRoot, compilerOptions)
      : undefined;
    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: compilerOptions,
      ...(isolatedCompiler ? { host: isolatedCompiler.host } : {})
    });
    if (options.isolated) {
      const allowedSourceRoots = isolatedCompiler!.allowedSourceRoots;
      const escapedSource = program.getSourceFiles().find((sourceFile) =>
        !allowedSourceRoots.some((root) => isPathInside(root, sourceFile.fileName)));
      if (escapedSource) {
        throw isolatedSourceEscape(dependencyProjectRoot, escapedSource.fileName);
      }
    }
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      const primary = diagnostics[0]!;
      const primarySummary = `TS${primary.code}: ${ts.flattenDiagnosticMessageText(
        primary.messageText,
        ' '
      )}`.slice(0, 256);
      throw new CompilerError(
        'VERIFY-BUILD-005',
        `Generated project typecheck failed (${primarySummary})`,
        diagnostics.map(formatDiagnostic)
      );
    }
  };
  if (options.isolated) {
    if (!(await pathExists(path.join(dependencyNodeModulesRoot, 'typescript', 'package.json')))) {
      throw new CompilerError('VERIFY-ISOLATION-002', 'Isolated typecheck dependencies were not materialized physically');
    }
    await execute();
    return;
  }
  await withProjectDependencyBridge(projectRoot, execute);
}
