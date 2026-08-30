import path from 'node:path';

import ts from 'typescript';

import type {
  SlotCapabilityObservation,
  SlotCapabilityObservationBatch
} from './slot-capability-contract.ts';

export interface SlotCapabilityTypeScriptSource {
  readonly path: string;
  readonly text: string;
}

type SlotCapabilityObservationWithoutSource =
  | Omit<Extract<SlotCapabilityObservation, { kind: 'runtime-module' }>, 'source'>
  | Omit<Extract<SlotCapabilityObservation, { kind: 'runtime-global' }>, 'source'>;

export class SlotCapabilityTypeScriptProviderError extends Error {
  constructor(
    message: string,
    readonly source: string | null,
    readonly reason: 'source-omitted' | 'syntax-invalid'
  ) {
    super(message);
    this.name = 'SlotCapabilityTypeScriptProviderError';
  }
}

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

const UNPROVEN_GLOBAL_IDENTIFIERS = new Set([
  ...UNRESOLVED_CAPABILITY_ROOTS,
  ...EFFECTFUL_GLOBAL_FUNCTIONS,
  ...EFFECTFUL_GLOBAL_CONSTRUCTORS
]);

function createAnalysisProgram(sources: readonly SlotCapabilityTypeScriptSource[]): Readonly<{
  checker: ts.TypeChecker;
  sourceFiles: readonly ts.SourceFile[];
}> {
  const compilerOptions: ts.CompilerOptions = {
    allowJs: false,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  };
  const sourceByPath = new Map(sources.map((source) => [
    path.resolve(source.path).replaceAll('\\', '/').toLowerCase(),
    source
  ] as const));
  const delegate = ts.createCompilerHost(compilerOptions, true);
  const exactSource = (fileName: string) =>
    sourceByPath.get(path.resolve(fileName).replaceAll('\\', '/').toLowerCase());
  const host: ts.CompilerHost = {
    ...delegate,
    fileExists: (fileName) => exactSource(fileName) !== undefined,
    getSourceFile(fileName, languageVersion) {
      const source = exactSource(fileName);
      return source === undefined
        ? undefined
        : ts.createSourceFile(source.path, source.text, languageVersion, true, ts.ScriptKind.TS);
    },
    readFile: (fileName) => exactSource(fileName)?.text,
    writeFile() {
      throw new Error('Custom Slot capability observation is read-only');
    }
  };
  const rootNames = sources.map(({ path: sourcePath }) => path.resolve(sourcePath));
  const program = ts.createProgram({ host, options: compilerOptions, rootNames });
  const sourceFiles = rootNames.map((rootName) => program.getSourceFile(rootName)).filter(
    (sourceFile): sourceFile is ts.SourceFile => sourceFile !== undefined
  );
  if (sourceFiles.length !== rootNames.length) {
    throw new SlotCapabilityTypeScriptProviderError(
      'TypeScript provider omitted an exact retained Custom Slot source file.',
      null,
      'source-omitted'
    );
  }
  for (const sourceFile of sourceFiles) {
    const diagnostic = program.getSyntacticDiagnostics(sourceFile)[0];
    if (diagnostic === undefined) continue;
    throw new SlotCapabilityTypeScriptProviderError(
      ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      sourceFile.fileName,
      'syntax-invalid'
    );
  }
  return Object.freeze({ checker: program.getTypeChecker(), sourceFiles: Object.freeze(sourceFiles) });
}

function visitTree(node: ts.Node, visitor: (candidate: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => visitTree(child, visitor));
}

function importIsErasedTypeOnly(importDecl: ts.ImportDeclaration): boolean {
  const clause = importDecl.importClause;
  if (clause?.isTypeOnly === true) return true;
  if (clause === undefined || clause.name !== undefined || clause.namedBindings === undefined) {
    return false;
  }
  if (ts.isNamespaceImport(clause.namedBindings)) return false;
  return clause.namedBindings.elements.length > 0
    && clause.namedBindings.elements.every((specifier) => specifier.isTypeOnly);
}

function hasLocalDeclaration(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  checker: ts.TypeChecker
): boolean {
  return checker.getSymbolAtLocation(node)?.declarations?.some((declaration) =>
    declaration.getSourceFile() === sourceFile) === true;
}

function stringLiteralValue(node: ts.Expression | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

function observed(
  sourceFile: ts.SourceFile,
  observation: SlotCapabilityObservationWithoutSource
): SlotCapabilityObservation {
  return Object.freeze({ ...observation, source: sourceFile.fileName }) as SlotCapabilityObservation;
}

function collectSourceObservations(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): readonly SlotCapabilityObservation[] {
  const observations: SlotCapabilityObservation[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || importIsErasedTypeOnly(statement)) continue;
    observations.push(observed(sourceFile, {
      kind: 'runtime-module',
      moduleSpecifier: stringLiteralValue(statement.moduleSpecifier),
      syntax: 'import',
      text: statement.getText(sourceFile)
    }));
  }
  visitTree(sourceFile, (node) => {
    if (!ts.isImportEqualsDeclaration(node)) return;
    observations.push(observed(sourceFile, {
      kind: 'runtime-module',
      moduleSpecifier: null,
      syntax: 'import-equals',
      text: node.getText(sourceFile)
    }));
  });
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined
      || statement.isTypeOnly) continue;
    if (statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length > 0
      && statement.exportClause.elements.every((specifier) => specifier.isTypeOnly)) continue;
    observations.push(observed(sourceFile, {
      kind: 'runtime-module',
      moduleSpecifier: stringLiteralValue(statement.moduleSpecifier),
      syntax: 'reexport',
      text: statement.getText(sourceFile)
    }));
  }
  visitTree(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)
      || node.expression.text !== 'require'
      || hasLocalDeclaration(sourceFile, node.expression, checker)) return;
    observations.push(observed(sourceFile, {
      kind: 'runtime-module',
      moduleSpecifier: stringLiteralValue(node.arguments[0]),
      syntax: 'require',
      text: node.getText(sourceFile)
    }));
  });
  visitTree(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
    observations.push(observed(sourceFile, {
      kind: 'runtime-module',
      moduleSpecifier: stringLiteralValue(node.arguments[0]),
      syntax: 'dynamic-import',
      text: node.getText(sourceFile)
    }));
  });
  visitTree(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)
      || !EFFECTFUL_GLOBAL_FUNCTIONS.has(node.expression.text)
      || hasLocalDeclaration(sourceFile, node.expression, checker)) return;
    observations.push(observed(sourceFile, {
      capability: node.expression.text,
      kind: 'runtime-global',
      syntax: 'call',
      text: node.getText(sourceFile)
    }));
  });
  for (const kind of [ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression]) {
    visitTree(sourceFile, (node) => {
      if (node.kind !== kind
        || (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node))) return;
      const root = node.expression.getText(sourceFile);
      if (!UNRESOLVED_CAPABILITY_ROOTS.has(root)
        || hasLocalDeclaration(sourceFile, node.expression, checker)) return;
      observations.push(observed(sourceFile, {
        capability: root,
        kind: 'runtime-global',
        syntax: 'root',
        text: node.getText(sourceFile)
      }));
    });
  }
  visitTree(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || !UNPROVEN_GLOBAL_IDENTIFIERS.has(node.text)
      || hasLocalDeclaration(sourceFile, node, checker)) return;
    observations.push(observed(sourceFile, {
      capability: node.text,
      kind: 'runtime-global',
      syntax: 'identifier',
      text: node.getText(sourceFile)
    }));
  });
  visitTree(sourceFile, (node) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression)
      || !EFFECTFUL_GLOBAL_CONSTRUCTORS.has(node.expression.text)
      || hasLocalDeclaration(sourceFile, node.expression, checker)) return;
    observations.push(observed(sourceFile, {
      capability: node.expression.text,
      kind: 'runtime-global',
      syntax: 'constructor',
      text: node.getText(sourceFile)
    }));
  });
  return Object.freeze(observations);
}

export function observeTypeScriptSlotCapabilities(
  sources: readonly SlotCapabilityTypeScriptSource[]
): SlotCapabilityObservationBatch {
  const analysis = createAnalysisProgram(sources);
  return Object.freeze({
    observations: Object.freeze(analysis.sourceFiles.flatMap((sourceFile) =>
      collectSourceObservations(sourceFile, analysis.checker))),
    provider: Object.freeze({ id: 'typescript-compiler-api', revision: ts.version })
  });
}
