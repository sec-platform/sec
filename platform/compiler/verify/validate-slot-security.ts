import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { Node, Project, SyntaxKind } from 'ts-morph';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';

const KNOWN_HOST_RUNTIME_MODULES = new Set([
  'child_process',
  'fs',
  'fs/promises',
  'os',
  'cluster',
  'net',
  'vm',
  'worker_threads',
  'module'
]);

const EFFECTFUL_GLOBAL_FUNCTIONS = new Set([
  'eval',
  'Function',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'fetch'
]);

const UNRESOLVED_CAPABILITY_ROOTS = new Set([
  'Bun',
  'Deno',
  'global',
  'globalThis',
  'module',
  'process',
  'require'
]);

const EFFECTFUL_GLOBAL_CONSTRUCTORS = new Set([
  'Function',
  'SharedWorker',
  'WebSocket',
  'Worker'
]);

function normalizedRuntimeModule(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
}

function isKnownHostRuntimeModule(specifier: string): boolean {
  return KNOWN_HOST_RUNTIME_MODULES.has(normalizedRuntimeModule(specifier));
}

function extractStringLiteralValue(node: { getText(): string }): string | null {
  const text = node.getText().trim();
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('`') && text.endsWith('`'))) {
    return text.slice(1, -1);
  }
  return null;
}

function staticLintFailure(code: string, message: string, details: Record<string, unknown> = {}): CompilerError {
  return new CompilerError(code, `${message} Static capability lint fails closed; this result is not a physical security proof.`, details);
}

async function collectActiveSlotFiles(workspaceRoot: string, lock: LockFile): Promise<string[]> {
  const { sourceSlotsRoot } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(sourceSlotsRoot))) return [];

  const activeSlotFiles: string[] = [];
  for (const task of lock.slotTasks) {
    if (task.status !== 'filled' && task.status !== 'verified') continue;
    if (!task.sourcePath) {
      throw staticLintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" has no sourcePath.`,
        { slotId: task.id, reason: 'missing-source-path' }
      );
    }
    const fullPath = resolvePathInside(workspaceRoot, task.sourcePath);
    if (!fullPath) {
      throw staticLintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" sourcePath escapes the workspace.`,
        { slotId: task.id, sourcePath: task.sourcePath, reason: 'source-path-escape' }
      );
    }
    if (!(await pathExists(fullPath))) {
      throw staticLintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" source file is missing.`,
        { slotId: task.id, sourcePath: task.sourcePath, reason: 'missing-source-file' }
      );
    }
    const metadata = await lstat(fullPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw staticLintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" source is not one ordinary file.`,
        { slotId: task.id, sourcePath: task.sourcePath, reason: 'non-ordinary-source-file' }
      );
    }
    activeSlotFiles.push(fullPath);
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
  for (const file of files) project.addSourceFileAtPath(file);
  return project;
}

function importIsErasedTypeOnly(
  importDecl: ReturnType<Project['getSourceFiles']>[number]['getImportDeclarations'] extends () => infer T
    ? T extends Array<infer E> ? E : never
    : never
): boolean {
  const clause = importDecl.compilerNode.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (!bindings || bindings.kind !== SyntaxKind.NamedImports) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function validateImportDeclarations(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    if (importIsErasedTypeOnly(importDecl)) continue;
    const moduleSpecifier = importDecl.getModuleSpecifierValue().trim();
    if (isKnownHostRuntimeModule(moduleSpecifier)) {
      throw staticLintFailure(
        'SLOT-LINT-002',
        `Host runtime module import "${moduleSpecifier}" is not authorized in Custom Slot file "${relativeName}".`,
        { source: relativeName, moduleSpecifier, reason: 'host-runtime-module' }
      );
    }
    throw staticLintFailure(
      'SLOT-LINT-005',
      `Runtime import "${moduleSpecifier}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier, reason: 'unresolved-runtime-import' }
    );
  }

  for (const importEquals of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    throw staticLintFailure(
      'SLOT-LINT-005',
      `Import-equals declaration "${importEquals.getText()}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, reason: 'unresolved-import-equals' }
    );
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    if (!exportDecl.hasModuleSpecifier()) continue;
    if (exportDecl.compilerNode.isTypeOnly) continue;
    const moduleSpecifier = exportDecl.getModuleSpecifierValue() ?? '';
    throw staticLintFailure(
      'SLOT-LINT-005',
      `Runtime re-export "${moduleSpecifier}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier, reason: 'unresolved-runtime-reexport' }
    );
  }
}

function validateRequireCalls(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'require') continue;
    const firstArg = callExpr.getArguments()[0];
    if (!firstArg) {
      throw staticLintFailure('SLOT-LINT-003', `require() without one literal target was found in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        reason: 'dynamic-require'
      });
    }
    const stringValue = extractStringLiteralValue(firstArg);
    if (stringValue === null) {
      throw staticLintFailure('SLOT-LINT-003', `Dynamic require() with a non-literal target was found in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        reason: 'dynamic-require'
      });
    }
    if (isKnownHostRuntimeModule(stringValue)) {
      throw staticLintFailure('SLOT-LINT-002', `Host runtime require("${stringValue}") is not authorized in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        moduleSpecifier: stringValue,
        reason: 'host-runtime-module'
      });
    }
    throw staticLintFailure('SLOT-LINT-005', `Runtime require("${stringValue}") in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`, {
      source: relativeName,
      moduleSpecifier: stringValue,
      reason: 'unresolved-runtime-require'
    });
  }
}

function validateDynamicImports(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (expression.getKind() !== SyntaxKind.ImportKeyword) continue;
    const firstArg = callExpr.getArguments()[0];
    const stringValue = firstArg ? extractStringLiteralValue(firstArg) : null;
    if (stringValue === null) {
      throw staticLintFailure('SLOT-LINT-003', `Dynamic import() with a non-literal target was found in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        reason: 'dynamic-import'
      });
    }
    if (isKnownHostRuntimeModule(stringValue)) {
      throw staticLintFailure('SLOT-LINT-002', `Host runtime dynamic import("${stringValue}") is not authorized in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        moduleSpecifier: stringValue,
        reason: 'host-runtime-module'
      });
    }
    throw staticLintFailure('SLOT-LINT-005', `Dynamic runtime import("${stringValue}") in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`, {
      source: relativeName,
      moduleSpecifier: stringValue,
      reason: 'unresolved-dynamic-import'
    });
  }
}

function validateEffectfulGlobals(
  sourceFile: ReturnType<Project['getSourceFiles']>[number],
  relativeName: string
): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (Node.isIdentifier(expression) && EFFECTFUL_GLOBAL_FUNCTIONS.has(expression.getText())) {
      throw staticLintFailure('SLOT-LINT-004', `Effectful global function "${expression.getText()}()" is not authorized in Custom Slot file "${relativeName}".`, {
        source: relativeName,
        capability: expression.getText(),
        reason: 'effectful-global'
      });
    }
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const root = access.getExpression().getText();
    if (!UNRESOLVED_CAPABILITY_ROOTS.has(root)) continue;
    throw staticLintFailure('SLOT-LINT-004', `Runtime capability root "${root}" is not authorized in Custom Slot file "${relativeName}".`, {
      source: relativeName,
      capability: root,
      reason: 'runtime-capability-root'
    });
  }

  for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const root = access.getExpression().getText();
    if (!UNRESOLVED_CAPABILITY_ROOTS.has(root)) continue;
    throw staticLintFailure('SLOT-LINT-004', `Runtime capability root "${root}" is not authorized in Custom Slot file "${relativeName}".`, {
      source: relativeName,
      capability: root,
      reason: 'runtime-capability-root'
    });
  }

  for (const newExpr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expression = newExpr.getExpression();
    if (!Node.isIdentifier(expression) || !EFFECTFUL_GLOBAL_CONSTRUCTORS.has(expression.getText())) continue;
    throw staticLintFailure('SLOT-LINT-004', `Effectful global constructor "${expression.getText()}" is not authorized in Custom Slot file "${relativeName}".`, {
      source: relativeName,
      capability: expression.getText(),
      reason: 'effectful-global-constructor'
    });
  }
}

/**
 * Static authoring lint only. Passing this lint means the inspected source did
 * not expose an unproven runtime capability under this finite AST policy. It
 * never proves sandboxing, transitive dependency safety, runtime isolation, or
 * physical security; those require an explicit capability/effect provider.
 */
export async function lintSlotCapabilities(workspaceRoot: string, lock: LockFile): Promise<void> {
  const activeSlotFiles = await collectActiveSlotFiles(workspaceRoot, lock);
  if (activeSlotFiles.length === 0) return;
  const project = createAnalysisProject(activeSlotFiles);
  for (const sourceFile of project.getSourceFiles()) {
    const relativeName = path.relative(workspaceRoot, sourceFile.getFilePath());
    validateImportDeclarations(sourceFile, relativeName);
    validateRequireCalls(sourceFile, relativeName);
    validateDynamicImports(sourceFile, relativeName);
    validateEffectfulGlobals(sourceFile, relativeName);
  }
}

/**
 * Temporary compatibility entrypoint for the existing Verification caller.
 * Semantics are static capability lint only; this alias must retire when that
 * caller moves to the explicit capability/effect verification boundary.
 */
export const validateSlotSecurity = lintSlotCapabilities;
