import path from 'node:path';
import {
  Node,
  Project,
  SyntaxKind,
  type ImportDeclaration,
  type SourceFile
} from 'ts-morph';

import { CompilerError } from '../../shared/errors.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { resolvePathInside } from '../../shared/paths.ts';
import {
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowOrdinaryFileEntryV1,
  PhysicalNoFollowError
} from '../../shared/physical-no-follow.ts';

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

function lintFailure(code: string, message: string, details: Record<string, unknown> = {}): CompilerError {
  return new CompilerError(
    code,
    `${message} Static capability lint fails closed; this result is not a physical security proof.`,
    details
  );
}

function activeSlotTasks(lock: LockFile) {
  return lock.slotTasks.filter((task) => task.status === 'filled' || task.status === 'verified');
}

function inspectActiveSlotSource(workspaceRoot: string, task: LockFile['slotTasks'][number]): string {
  if (!task.sourcePath) {
    throw lintFailure(
      'SLOT-LINT-001',
      `Active Custom Slot "${task.id}" has no sourcePath.`,
      { slotId: task.id, reason: 'missing-source-path' }
    );
  }
  const fullPath = resolvePathInside(workspaceRoot, task.sourcePath);
  if (!fullPath) {
    throw lintFailure(
      'SLOT-LINT-001',
      `Active Custom Slot "${task.id}" sourcePath escapes the workspace.`,
      { slotId: task.id, sourcePath: task.sourcePath, reason: 'source-path-escape' }
    );
  }
  try {
    const parent = inspectNoFollowDirectoryChainV1(
      path.dirname(fullPath),
      `Custom Slot ${task.id} source parent`
    ).target;
    const leaf = inspectNoFollowOrdinaryFileEntryV1(parent, path.basename(fullPath));
    if (leaf === null || leaf.kind !== 'file') {
      throw lintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" source is missing or is not one ordinary file.`,
        { slotId: task.id, sourcePath: task.sourcePath, reason: 'non-ordinary-source-file' }
      );
    }
    return fullPath;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    if (error instanceof PhysicalNoFollowError) {
      throw lintFailure(
        'SLOT-LINT-001',
        `Active Custom Slot "${task.id}" source cannot be retained without following links.`,
        { slotId: task.id, sourcePath: task.sourcePath, reason: error.code }
      );
    }
    throw error;
  }
}

function collectActiveSlotFiles(workspaceRoot: string, lock: LockFile): string[] {
  return activeSlotTasks(lock).map((task) => inspectActiveSlotSource(workspaceRoot, task));
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

function importIsErasedTypeOnly(importDecl: ImportDeclaration): boolean {
  const clause = importDecl.compilerNode.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  if (!bindings || bindings.kind !== SyntaxKind.NamedImports) return false;
  return bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
}

function validateImports(sourceFile: SourceFile, relativeName: string): void {
  for (const importDecl of sourceFile.getImportDeclarations()) {
    if (importIsErasedTypeOnly(importDecl)) continue;
    const moduleSpecifier = importDecl.getModuleSpecifierValue().trim();
    if (isKnownHostRuntimeModule(moduleSpecifier)) {
      throw lintFailure(
        'SLOT-LINT-002',
        `Host runtime module import "${moduleSpecifier}" is not authorized in Custom Slot file "${relativeName}".`,
        { source: relativeName, moduleSpecifier, reason: 'host-runtime-module' }
      );
    }
    throw lintFailure(
      'SLOT-LINT-005',
      `Runtime import "${moduleSpecifier}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier, reason: 'unresolved-runtime-import' }
    );
  }

  for (const importEquals of sourceFile.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
    throw lintFailure(
      'SLOT-LINT-005',
      `Import-equals declaration "${importEquals.getText()}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, reason: 'unresolved-import-equals' }
    );
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (moduleSpecifier === undefined || exportDecl.compilerNode.isTypeOnly) continue;
    throw lintFailure(
      'SLOT-LINT-005',
      `Runtime re-export "${moduleSpecifier}" in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier, reason: 'unresolved-runtime-reexport' }
    );
  }
}

function validateRequireCalls(sourceFile: SourceFile, relativeName: string): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== 'require') continue;
    const firstArg = callExpr.getArguments()[0];
    const stringValue = firstArg ? extractStringLiteralValue(firstArg) : null;
    if (stringValue === null) {
      throw lintFailure(
        'SLOT-LINT-003',
        `Dynamic require() without one literal target was found in Custom Slot file "${relativeName}".`,
        { source: relativeName, reason: 'dynamic-require' }
      );
    }
    if (isKnownHostRuntimeModule(stringValue)) {
      throw lintFailure(
        'SLOT-LINT-002',
        `Host runtime require("${stringValue}") is not authorized in Custom Slot file "${relativeName}".`,
        { source: relativeName, moduleSpecifier: stringValue, reason: 'host-runtime-module' }
      );
    }
    throw lintFailure(
      'SLOT-LINT-005',
      `Runtime require("${stringValue}") in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier: stringValue, reason: 'unresolved-runtime-require' }
    );
  }
}

function validateDynamicImports(sourceFile: SourceFile, relativeName: string): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (expression.getKind() !== SyntaxKind.ImportKeyword) continue;
    const firstArg = callExpr.getArguments()[0];
    const stringValue = firstArg ? extractStringLiteralValue(firstArg) : null;
    if (stringValue === null) {
      throw lintFailure(
        'SLOT-LINT-003',
        `Dynamic import() without one literal target was found in Custom Slot file "${relativeName}".`,
        { source: relativeName, reason: 'dynamic-import' }
      );
    }
    if (isKnownHostRuntimeModule(stringValue)) {
      throw lintFailure(
        'SLOT-LINT-002',
        `Host runtime dynamic import("${stringValue}") is not authorized in Custom Slot file "${relativeName}".`,
        { source: relativeName, moduleSpecifier: stringValue, reason: 'host-runtime-module' }
      );
    }
    throw lintFailure(
      'SLOT-LINT-005',
      `Dynamic runtime import("${stringValue}") in Custom Slot file "${relativeName}" has no explicit capability/transitive-effect proof.`,
      { source: relativeName, moduleSpecifier: stringValue, reason: 'unresolved-dynamic-import' }
    );
  }
}

function validateEffectfulGlobals(sourceFile: SourceFile, relativeName: string): void {
  for (const callExpr of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = callExpr.getExpression();
    if (!Node.isIdentifier(expression) || !EFFECTFUL_GLOBAL_FUNCTIONS.has(expression.getText())) continue;
    throw lintFailure(
      'SLOT-LINT-004',
      `Effectful global function "${expression.getText()}()" is not authorized in Custom Slot file "${relativeName}".`,
      { source: relativeName, capability: expression.getText(), reason: 'effectful-global' }
    );
  }

  for (const kind of [SyntaxKind.PropertyAccessExpression, SyntaxKind.ElementAccessExpression] as const) {
    for (const access of sourceFile.getDescendantsOfKind(kind)) {
      const root = access.getExpression().getText();
      if (!UNRESOLVED_CAPABILITY_ROOTS.has(root)) continue;
      throw lintFailure(
        'SLOT-LINT-004',
        `Runtime capability root "${root}" is not authorized in Custom Slot file "${relativeName}".`,
        { source: relativeName, capability: root, reason: 'runtime-capability-root' }
      );
    }
  }

  for (const newExpr of sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const expression = newExpr.getExpression();
    if (!Node.isIdentifier(expression) || !EFFECTFUL_GLOBAL_CONSTRUCTORS.has(expression.getText())) continue;
    throw lintFailure(
      'SLOT-LINT-004',
      `Effectful global constructor "${expression.getText()}" is not authorized in Custom Slot file "${relativeName}".`,
      { source: relativeName, capability: expression.getText(), reason: 'effectful-global-constructor' }
    );
  }
}

/**
 * Static authoring lint only. Passing this lint means the inspected source did
 * not expose an unproven runtime capability under this finite AST policy. It
 * never proves sandboxing, transitive dependency safety, runtime isolation, or
 * physical security; those require an explicit capability/effect provider.
 */
export async function lintSlotCapabilities(workspaceRoot: string, lock: LockFile): Promise<void> {
  const activeSlotFiles = collectActiveSlotFiles(workspaceRoot, lock);
  if (activeSlotFiles.length === 0) return;
  const project = createAnalysisProject(activeSlotFiles);
  for (const sourceFile of project.getSourceFiles()) {
    const relativeName = path.relative(workspaceRoot, sourceFile.getFilePath());
    validateImports(sourceFile, relativeName);
    validateRequireCalls(sourceFile, relativeName);
    validateDynamicImports(sourceFile, relativeName);
    validateEffectfulGlobals(sourceFile, relativeName);
  }
}
