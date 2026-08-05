import path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';

const FORBIDDEN_MODULES = new Set([
  'child_process',
  'fs',
  'fs/promises',
  'os',
  'cluster',
  'net',
  'vm',
  'worker_threads'
]);

const DANGEROUS_GLOBAL_FUNCTIONS = new Set([
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'setImmediate'
]);

function isForbiddenModule(specifier: string): boolean {
  if (FORBIDDEN_MODULES.has(specifier)) {
    return true;
  }
  if (specifier.startsWith('node:')) {
    const cleanSpecifier = specifier.replace(/^node:/, '');
    return FORBIDDEN_MODULES.has(cleanSpecifier);
  }
  return false;
}

function extractStringLiteralValue(node: { getText(): string }): string | null {
  const text = node.getText().trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('`') && text.endsWith('`'))) {
    return text.slice(1, -1);
  }
  return null;
}

async function collectActiveSlotFiles(workspaceRoot: string, lock: LockFile): Promise<string[]> {
  const { sourceSlotsRoot } = getWorkspacePaths(workspaceRoot);

  if (!(await pathExists(sourceSlotsRoot))) {
    return [];
  }

  const activeSlotFiles: string[] = [];
  for (const task of lock.slotTasks) {
    if (task.sourcePath && (task.status === 'filled' || task.status === 'verified')) {
      const fullPath = path.resolve(workspaceRoot, task.sourcePath);
      if (!(await pathExists(fullPath))) {
        continue;
      }
      activeSlotFiles.push(fullPath);
    }
  }
  return activeSlotFiles;
}

function createAnalysisProject(files: string[]): Project {
  const project = new Project({
    skipLoadingLibFiles: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: false,
      declaration: false,
      noEmit: true
    }
  });
  for (const file of files) {
    project.addSourceFileAtPath(file);
  }
  return project;
}

function validateImportDeclarations(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue().trim();
    if (isForbiddenModule(moduleSpecifier)) {
      throw new CompilerError(
        'SLOT-SECURITY-002',
        `Forbidden system module import "${moduleSpecifier}" detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
      );
    }
  }
}

function validateRequireCalls(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();

    let isRequireCall = false;
    if (Node.isIdentifier(expression)) {
      isRequireCall = expression.getText() === 'require';
    } else if (Node.isPropertyAccessExpression(expression)) {
      continue;
    }

    if (!isRequireCall) {
      continue;
    }

    const args = callExpr.getArguments();
    if (args.length === 0) continue;

    const firstArg = args[0];
    const stringValue = extractStringLiteralValue(firstArg);
    if (stringValue !== null && isForbiddenModule(stringValue)) {
      throw new CompilerError(
        'SLOT-SECURITY-002',
        `Forbidden dynamic require("${stringValue}") call detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
      );
    }

    if (stringValue === null) {
      throw new CompilerError(
        'SLOT-SECURITY-003',
        `Dynamic require() with non-literal argument detected in Custom Slot file "${relativeName}". Indirect module loading is not allowed for security reasons.`
      );
    }
  }
}

function validateDynamicImports(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (expression.getKind() !== SyntaxKind.ImportKeyword) {
      continue;
    }

    const args = callExpr.getArguments();
    if (args.length === 0) continue;

    const firstArg = args[0];
    const stringValue = extractStringLiteralValue(firstArg);
    if (stringValue !== null && isForbiddenModule(stringValue)) {
      throw new CompilerError(
        'SLOT-SECURITY-002',
        `Forbidden dynamic import("${stringValue}") call detected in Custom Slot file "${relativeName}". Physical security gate enforcement blocked compilation.`
      );
    }

    if (stringValue === null) {
      throw new CompilerError(
        'SLOT-SECURITY-003',
        `Dynamic import() with non-literal argument detected in Custom Slot file "${relativeName}". Indirect module loading is not allowed for security reasons.`
      );
    }
  }
}

function validateDangerousGlobals(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const callExpr of callExpressions) {
    const expression = callExpr.getExpression();
    if (!Node.isIdentifier(expression)) {
      continue;
    }

    const name = expression.getText();
    if (DANGEROUS_GLOBAL_FUNCTIONS.has(name)) {
      throw new CompilerError(
        'SLOT-SECURITY-004',
        `Dangerous global function "${name}()" call detected in Custom Slot file "${relativeName}". Code execution gate enforcement blocked compilation.`
      );
    }
  }
}

function validateNewFunction(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  const newExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression);

  for (const newExpr of newExpressions) {
    const expression = newExpr.getExpression();
    if (Node.isIdentifier(expression) && expression.getText() === 'Function') {
      throw new CompilerError(
        'SLOT-SECURITY-004',
        `Dangerous "new Function()" call detected in Custom Slot file "${relativeName}". Code execution gate enforcement blocked compilation.`
      );
    }
  }
}

export async function validateSlotSecurity(workspaceRoot: string, lock: LockFile): Promise<void> {
  const activeSlotFiles = await collectActiveSlotFiles(workspaceRoot, lock);
  if (activeSlotFiles.length === 0) {
    return;
  }

  const project = createAnalysisProject(activeSlotFiles);

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const relativeName = path.relative(workspaceRoot, filePath);

    validateImportDeclarations(sourceFile, relativeName);
    validateRequireCalls(sourceFile, relativeName);
    validateDynamicImports(sourceFile, relativeName);
    validateDangerousGlobals(sourceFile, relativeName);
    validateNewFunction(sourceFile, relativeName);
  }
}
