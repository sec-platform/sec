import path from 'node:path';
import ts from 'typescript';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists } from '../../shared/fs.ts';
import { compilerRoot, relativePosixPath } from '../../shared/paths.ts';
import { withProjectDependencyBridge } from '../../shared/project-runtime.ts';

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const filePath = relativePosixPath(process.cwd(), diagnostic.file.fileName);
  return `${filePath}:${position.line + 1}:${position.character + 1} ${message}`;
}

export function formatCompilerFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error instanceof CompilerError && error.details) {
    return `${error.stack ?? error.message}\n${JSON.stringify(error.details, null, 2)}`;
  }

  return error.stack ?? error.message;
}

export async function typecheckProject(projectRoot: string): Promise<void> {
  await withProjectDependencyBridge(projectRoot, async () => {
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

    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: {
        ...parsed.options,
        typeRoots: [
          ...new Set([
            ...(parsed.options.typeRoots ?? []),
            path.join(projectRoot, 'node_modules', '@types'),
            path.join(compilerRoot, 'node_modules', '@types')
          ])
        ]
      }
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length > 0) {
      throw new CompilerError(
        'VERIFY-BUILD-005',
        'Generated project typecheck failed',
        diagnostics.map(formatDiagnostic)
      );
    }
  });
}
