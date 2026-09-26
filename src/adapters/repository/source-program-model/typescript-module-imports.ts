import ts from 'typescript';
import { createTypeScriptModuleLoadObserver } from './typescript-module-loader.ts';

import { compareCodeUnits } from '../../../contracts/canonical.ts';
import type {
  ModuleImportKind,
  RepositoryModuleGraphImportObservation
} from '../architecture/contract.ts';

type TypeScriptModuleProgram = Readonly<{
  program: ts.Program;
  sourceFiles: readonly ts.SourceFile[];
  repositoryPath(sourceFile: ts.SourceFile): string;
}>;

/** Observations are not a claim that arbitrary JavaScript effects are pure.
 * Computed imports and recognized loaders with unknown resolution roots remain
 * unresolved; callers must not interpret their absent edges as a closed graph.
 */
export type TypeScriptModuleImportFacts = Readonly<{
  imports: readonly RepositoryModuleGraphImportObservation[];
  unresolvedFiles: readonly string[];
}>;

export function typeScriptModuleImportFacts(exact: TypeScriptModuleProgram): TypeScriptModuleImportFacts {
  if (exact.program.getCompilerOptions().verbatimModuleSyntax !== true) {
    throw new Error('Module import observations require the canonical verbatimModuleSyntax compiler profile.');
  }
  const observations: RepositoryModuleGraphImportObservation[] = [];
  const unresolvedFiles = new Set<string>();
  const observeModuleLoad = createTypeScriptModuleLoadObserver(exact.program.getTypeChecker());
  const add = (from: string, kind: ModuleImportKind, specifier: string, typeOnly = false): void => {
    observations.push(Object.freeze({ from, kind, specifier, typeOnly }));
  };
  for (const sourceFile of exact.sourceFiles) {
    const from = exact.repositoryPath(sourceFile);
    if (exact.program.getSyntacticDiagnostics(sourceFile).length > 0) unresolvedFiles.add(from);
    for (const reference of [
      ...sourceFile.referencedFiles, ...sourceFile.typeReferenceDirectives, ...sourceFile.libReferenceDirectives
    ]) add(from, 'static', reference.fileName, true);
    const pending: ts.Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop()!;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
        if (!ts.isStringLiteralLike(node.moduleSpecifier)) unresolvedFiles.add(from);
        else {
          // Inline type specifiers erase bindings, not module evaluation:
          // verbatimModuleSyntax emits import {} / export {} from the target.
          // Only a statement-level type modifier erases that runtime edge.
          const typeOnly = sourceFile.isDeclarationFile || (ts.isImportDeclaration(node)
            ? node.importClause?.isTypeOnly === true : node.isTypeOnly);
          add(from, 'static', node.moduleSpecifier.text, typeOnly);
        }
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (expression !== undefined && ts.isStringLiteralLike(expression)) {
          add(from, 'require', expression.text, sourceFile.isDeclarationFile || node.isTypeOnly);
        } else unresolvedFiles.add(from);
      } else if (ts.isImportTypeNode(node)) {
        if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
          add(from, 'static', node.argument.literal.text, true);
        } else unresolvedFiles.add(from);
      } else if (ts.isCallExpression(node)) {
        const observation = observeModuleLoad(node);
        if (observation.status === 'unresolved') unresolvedFiles.add(from);
        else if (observation.status === 'resolved') add(from, observation.kind, observation.specifier);
      }
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
  }
  const unique = new Map<string, RepositoryModuleGraphImportObservation>();
  for (const observation of observations) {
    const key = `${observation.from}\0${observation.kind}\0${observation.specifier}`;
    const existing = unique.get(key);
    if (existing === undefined || (existing.typeOnly && !observation.typeOnly)) unique.set(key, observation);
  }
  return Object.freeze({
    imports: Object.freeze([...unique.values()].sort((left, right) => compareCodeUnits(left.from, right.from)
      || compareCodeUnits(left.specifier, right.specifier) || compareCodeUnits(left.kind, right.kind))),
    unresolvedFiles: Object.freeze([...unresolvedFiles].sort(compareCodeUnits))
  });
}
