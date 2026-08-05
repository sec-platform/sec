/**
 * sec-tcb-closure-lock — generated exact TCB closure lock.
 *
 * This module is the single canonical source for the trusted-runtime closure
 * builder, the frozen TCB closure lock identity, and the lock verifier.
 *
 * The lock binds the exact reviewed modules, their edges, Git blob SHA-1s,
 * raw content SHA-256 digests, reviewed external imports, reviewed process
 * dispatchers, and the single trust revision.  The lock is generated from
 * the trusted-runtime closure logic — it is not hand-maintained.
 *
 * The verifier runtime import closure test asserts against the generated lock
 * identity instead of a hard-coded module count.  Any unauthorized expansion,
 * contraction, substitution, or edge addition causes the lock to break.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import {
  CodexDevelopmentTrustRootPathPrefixesV1,
  CodexDevelopmentTrustRootPathsV1
} from '../../scripts/codex/merge-gate.ts';
import { compilerRoot } from './paths.ts';

// ---------------------------------------------------------------------------
// TCB closure constants (canonical source — moved from sec-merge-gate.test.ts)
// ---------------------------------------------------------------------------

export const TCB_RUNTIME_ENTRYPOINTS = [
  'docs/scripts/docs-doctor.ts',
  'platform/dev-runner.ts',
  'platform/shared/ci-contract.ts',
  'platform/shared/ci-evidence-contract.ts',
  'platform/shared/ci-git-changed-files.ts',
  'platform/shared/ci-pr-risk-selection.ts',
  'platform/shared/ci-verification-plan.ts',
  'platform/shared/test-budget-contract.ts',
  'platform/shared/test-impact-contract.ts',
  'platform/shared/test-ownership-contract.ts',
  'scripts/ci-pr-risk.ts',
  'scripts/ci-verification.ts',
  'scripts/ci-workspace-fast.ts',
  'scripts/codex/exact-git-blob.ts',
  'scripts/codex/merge-gate.ts',
  'scripts/codex/work-package-contract.ts',
  'tests/setup/runtime-deps.setup.ts'
] as const;

export const TCB_REVIEWED_SUT_EDGES = new Set([
  // ci-workspace-fast is trusted orchestration, while the orchestrator is the product under test.
  // Traversing past this edge would freeze ordinary product/runtime work behind manual bootstrap.
  'scripts/ci-workspace-fast.ts -> platform/orchestrator.ts'
]);

export const TCB_REVIEWED_EXTERNAL_IMPORTS = new Set([
  'platform/shared/heavy-verification-gate-lease.ts -> bun:ffi'
]);

export const TCB_APPROVED_EXTERNAL_IMPORTS = new Set([
  'globby',
  'lodash-es',
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:os',
  'node:path',
  'node:url',
  'p-limit',
  'ts-morph',
  'typescript',
  'yaml'
]);

const TCB_CLASSIFIED_EXTERNAL_IMPORTS = new Set([
  'bun',
  'node:child_process',
  'node:module',
  'node:worker_threads'
]);

const TCB_BUN_SAFE_IMPORTS = new Set([
  'Glob'
]);

export const TCB_REVIEWED_PROCESS_DISPATCHERS = new Set([
  'platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
  'platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1',
  'platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
  'scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1',
  'scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1',
  'scripts/codex/merge-gate.ts::function-declaration:mergeGateGitResolvers>const-arrow:run::spawnSync#1',
  'scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1'
]);

const TCB_CHILD_PROCESS_LOADERS = new Set([
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'spawn',
  'spawnSync'
]);

const TCB_BUN_PROCESS_LOADERS = new Set([
  'Bun.spawn',
  'Bun.spawnSync'
]);

const TCB_BUN_SAFE_GLOBAL_MEMBERS = new Set([
  'version'
]);

const TCB_GLOBAL_THIS_RUNTIME_LOADERS = new Set([
  'eval',
  'Function',
  'importScripts',
  'require',
  'Worker'
]);

const TCB_IMPORT_META_SAFE_MEMBERS = new Set([
  'dir',
  'main',
  'url'
]);

const TCB_FORBIDDEN_GLOBAL_ALIASES = new Set([
  'global',
  'self'
]);

export const TCB_PROCESS_SAFE_MEMBERS = new Set([
  'arch',
  'argv',
  'cwd',
  'env',
  'execPath',
  'exit',
  'exitCode',
  'kill',
  'pid',
  'platform',
  'stderr',
  'stdout',
  'versions'
]);

// ---------------------------------------------------------------------------
// TCB closure logic (canonical source — moved from sec-merge-gate.test.ts)
// ---------------------------------------------------------------------------

export function runtimeRelativeImportsFromSource(
  repositoryPath: string,
  source: string,
  reviewedProcessDispatchers: Set<string> = new Set(),
  reviewedExternalImports: Set<string> = new Set(),
  observedExternalImports: Set<string> = new Set()
): string[] {
  const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const bunProcessBindings = new Map<string, string>();
  const childProcessBindings = new Map<string, string>();
  const childProcessNamespaces = new Set<string>();
  const rejectUnmodeledLoader = (loader: string): never => {
    throw new Error(
      `TCB runtime loader is outside the relative ESM closure model: ${repositoryPath} (${loader}).`
    );
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      if (
        clause?.namedBindings
        && ts.isNamedImports(clause.namedBindings)
        && clause.name === undefined
        && clause.namedBindings.elements.every((element) => element.isTypeOnly)
      ) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      const namedBindings = clause?.namedBindings;
      const namespaceBindings = [
        clause?.name?.text,
        namedBindings && ts.isNamespaceImport(namedBindings) ? namedBindings.name.text : undefined
      ].filter((binding): binding is string => binding !== undefined);
      const runtimeNamedImports = namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.filter((element) => !element.isTypeOnly)
        : [];
      if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(moduleSpecifier)) {
        const runtimeClause = clause ?? rejectUnmodeledLoader(`side-effect ${moduleSpecifier} import`);
        if (moduleSpecifier === 'bun') {
          if (runtimeClause.name || (namedBindings && ts.isNamespaceImport(namedBindings))) {
            rejectUnmodeledLoader('bun default/namespace import');
          }
          if (runtimeNamedImports.length === 0) {
            rejectUnmodeledLoader('bun import without a classified runtime binding');
          }
          for (const element of runtimeNamedImports) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (TCB_BUN_SAFE_IMPORTS.has(importedName)) continue;
            const loader = `Bun.${importedName}`;
            if (!TCB_BUN_PROCESS_LOADERS.has(loader)) {
              rejectUnmodeledLoader(`unclassified bun binding ${importedName}`);
            }
            bunProcessBindings.set(element.name.text, loader);
          }
          continue;
        }
        if (moduleSpecifier === 'node:child_process') {
          if (namespaceBindings.length === 0 && runtimeNamedImports.length === 0) {
            rejectUnmodeledLoader('node:child_process import without a classified runtime binding');
          }
          for (const binding of namespaceBindings) childProcessNamespaces.add(binding);
          for (const element of runtimeNamedImports) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (!TCB_CHILD_PROCESS_LOADERS.has(importedName)) {
              rejectUnmodeledLoader(`unclassified node:child_process binding ${importedName}`);
            }
            childProcessBindings.set(element.name.text, importedName);
          }
          continue;
        }
        rejectUnmodeledLoader(`runtime ${moduleSpecifier} import`);
      }
      specifiers.push(moduleSpecifier);
    }
    if (
      ts.isExportDeclaration(statement)
      && !statement.isTypeOnly
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const hasRuntimeExport = !statement.exportClause
        || !ts.isNamedExports(statement.exportClause)
        || statement.exportClause.elements.some((element) => !element.isTypeOnly);
      if (hasRuntimeExport) {
        if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(statement.moduleSpecifier.text)) {
          rejectUnmodeledLoader(`runtime ${statement.moduleSpecifier.text} re-export`);
        }
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
  }

  const bunNamespaceName = (expression: ts.Expression): 'Bun' | 'globalThis.Bun' | null => {
    if (ts.isIdentifier(expression) && expression.text === 'Bun') return 'Bun';
    if (
      ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === 'globalThis'
      && expression.name.text === 'Bun'
    ) return 'globalThis.Bun';
    return null;
  };
  const isImportMeta = (node: ts.Node): node is ts.MetaProperty => (
    ts.isMetaProperty(node)
    && node.keywordToken === ts.SyntaxKind.ImportKeyword
    && node.name.text === 'meta'
  );
  const loaderName = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) {
      if (expression.text === 'require') return 'require';
      if (expression.text === 'importScripts') return 'importScripts';
      if (expression.text === 'eval') return 'eval';
      if (expression.text === 'Function') return 'Function';
      if (expression.text === 'Worker') return 'Worker';
      return bunProcessBindings.get(expression.text) ?? childProcessBindings.get(expression.text) ?? null;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const bunNamespace = bunNamespaceName(expression.expression);
      const member = expression.name.text;
      if (bunNamespace && TCB_BUN_PROCESS_LOADERS.has(`Bun.${member}`)) return `Bun.${member}`;
      if (!ts.isIdentifier(expression.expression)) return null;
      const owner = expression.expression.text;
      if (childProcessNamespaces.has(owner) && TCB_CHILD_PROCESS_LOADERS.has(member)) return member;
      if (owner === 'globalThis' && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(member)) {
        return member;
      }
      if (member === 'require') return 'require';
    }
    return null;
  };
  type LexicalOwnerChunk = {
    node: ts.FunctionLikeDeclaration;
    segments: string[];
  };
  const variableDeclarationKind = (declaration: ts.VariableDeclaration): 'const' | 'let' | 'var' | null => {
    if (!ts.isVariableDeclarationList(declaration.parent)) return null;
    if ((declaration.parent.flags & ts.NodeFlags.Const) !== 0) return 'const';
    if ((declaration.parent.flags & ts.NodeFlags.Let) !== 0) return 'let';
    return 'var';
  };
  const lexicalOwnerSegments = (node: ts.FunctionLikeDeclaration): string[] | null => {
    if (ts.isFunctionDeclaration(node)) {
      if (!node.body) return [];
      return node.name ? [`function-declaration:${node.name.text}`] : null;
    }
    if (ts.isMethodDeclaration(node)) {
      return ts.isIdentifier(node.name) ? [`method-declaration:${node.name.text}`] : null;
    }
    if (ts.isArrowFunction(node)) {
      if (!ts.isVariableDeclaration(node.parent) || node.parent.initializer !== node) return [];
      if (!ts.isIdentifier(node.parent.name)) return null;
      const declarationKind = variableDeclarationKind(node.parent);
      return declarationKind ? [`${declarationKind}-arrow:${node.parent.name.text}`] : null;
    }
    if (ts.isFunctionExpression(node)) {
      if (ts.isVariableDeclaration(node.parent) && node.parent.initializer === node) {
        if (!ts.isIdentifier(node.parent.name)) return null;
        const declarationKind = variableDeclarationKind(node.parent);
        if (!declarationKind) return null;
        return [
          `${declarationKind}-function-expression:${node.parent.name.text}`,
          ...(node.name ? [`function-expression:${node.name.text}`] : [])
        ];
      }
      return node.name ? [`function-expression:${node.name.text}`] : [];
    }
    return null;
  };
  const isLexicalFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration => (
    ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node)
  );
  const lexicalOwnerChunks = (node: ts.Node, includeSelf = false): LexicalOwnerChunk[] | null => {
    const reversedChunks: LexicalOwnerChunk[] = [];
    for (
      let current: ts.Node | undefined = includeSelf ? node : node.parent;
      current && current !== sourceFile;
      current = current.parent
    ) {
      if (!isLexicalFunctionLike(current)) continue;
      const segments = lexicalOwnerSegments(current);
      if (segments === null) return null;
      if (segments.length > 0) reversedChunks.push({ node: current, segments });
    }
    return reversedChunks.reverse();
  };
  const isCanonicalRootOwner = (node: ts.FunctionLikeDeclaration): boolean => {
    if (ts.isFunctionDeclaration(node)) return node.parent === sourceFile;
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      && ts.isVariableDeclaration(node.parent)
      && ts.isVariableDeclarationList(node.parent.parent)
      && ts.isVariableStatement(node.parent.parent.parent)
    ) return node.parent.parent.parent.parent === sourceFile;
    return false;
  };
  const ownerChainCounts = new Map<string, number>();
  const countNamedOwnerChains = (node: ts.Node): void => {
    if (isLexicalFunctionLike(node)) {
      const ownSegments = lexicalOwnerSegments(node);
      const chunks = ownSegments && ownSegments.length > 0 ? lexicalOwnerChunks(node, true) : null;
      if (chunks && chunks.length > 0 && isCanonicalRootOwner(chunks[0]!.node)) {
        const chain = chunks.flatMap((chunk) => chunk.segments).join('>');
        ownerChainCounts.set(chain, (ownerChainCounts.get(chain) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, countNamedOwnerChains);
  };
  ts.forEachChild(sourceFile, countNamedOwnerChains);
  const processDispatchOrdinals = new Map<string, number>();
  const reviewProcessDispatch = (node: ts.CallExpression, loader: string): void => {
    const chunks = lexicalOwnerChunks(node)
      ?? rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    const rootChunk = chunks[0]
      ?? rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    if (!isCanonicalRootOwner(rootChunk.node)) {
      rejectUnmodeledLoader('process dispatcher without a canonical named lexical owner');
    }
    const segments: string[] = [];
    for (const chunk of chunks) {
      segments.push(...chunk.segments);
      const chainPrefix = segments.join('>');
      if (ownerChainCounts.get(chainPrefix) !== 1) {
        rejectUnmodeledLoader(`ambiguous process dispatcher owner ${chainPrefix}`);
      }
    }
    const chain = segments.join('>');
    const ordinalKey = `${repositoryPath}::${chain}::${loader}`;
    const ordinal = (processDispatchOrdinals.get(ordinalKey) ?? 0) + 1;
    processDispatchOrdinals.set(ordinalKey, ordinal);
    const identity = `${ordinalKey}#${ordinal}`;
    if (!TCB_REVIEWED_PROCESS_DISPATCHERS.has(identity)) {
      rejectUnmodeledLoader(`unreviewed process dispatcher ${identity}`);
    }
    reviewedProcessDispatchers.add(identity);
  };

  const isImportBindingDeclaration = (identifier: ts.Identifier): boolean => (
    (ts.isImportClause(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isImportSpecifier(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isNamespaceImport(identifier.parent) && identifier.parent.name === identifier)
  );
  const isPropertyName = (identifier: ts.Identifier): boolean => (
    (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertyAssignment(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isMethodDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertyDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isPropertySignature(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isGetAccessorDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isSetAccessorDeclaration(identifier.parent) && identifier.parent.name === identifier)
    || (ts.isBindingElement(identifier.parent) && identifier.parent.propertyName === identifier)
  );
  const isTypeOnlyIdentifier = (identifier: ts.Identifier): boolean => {
    for (let current: ts.Node | undefined = identifier.parent; current; current = current.parent) {
      if (ts.isTypeNode(current)) return true;
      if (ts.isImportClause(current) && current.isTypeOnly) return true;
      if (ts.isImportSpecifier(current) && current.isTypeOnly) return true;
      if (ts.isExportSpecifier(current) && current.isTypeOnly) return true;
      if (ts.isStatement(current)) return false;
    }
    return false;
  };

  function visitRuntimeLoaders(node: ts.Node): void {
    if (
      ts.isIdentifier(node)
      && TCB_FORBIDDEN_GLOBAL_ALIASES.has(node.text)
      && !isPropertyName(node)
    ) rejectUnmodeledLoader(`unapproved global namespace ${node.text}`);
    if (
      ts.isIdentifier(node)
      && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(node.text)
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
    ) {
      const isDirectInvocation = (
        (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectInvocation) rejectUnmodeledLoader(`indirect global loader ${node.text}`);
    }
    if (
      ts.isIdentifier(node)
      && node.text === 'module'
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
    ) {
      const isDirectRequireOwner = (
        ts.isPropertyAccessExpression(node.parent)
        && node.parent.expression === node
        && node.parent.name.text === 'require'
      );
      if (!isDirectRequireOwner) rejectUnmodeledLoader('escaped module loader namespace');
    }
    if (isImportMeta(node)) {
      if (ts.isElementAccessExpression(node.parent) && node.parent.expression === node) {
        rejectUnmodeledLoader('computed import.meta member');
      }
      if (
        !ts.isPropertyAccessExpression(node.parent)
        || node.parent.expression !== node
        || !TCB_IMPORT_META_SAFE_MEMBERS.has(node.parent.name.text)
      ) rejectUnmodeledLoader('escaped or unclassified import.meta namespace');
    }
    if (ts.isIdentifier(node) && node.text === 'Bun' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('indirect Bun namespace Bun');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'globalThis' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('escaped globalThis namespace');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'process' && !isPropertyName(node)) {
      const isDirectMemberOwner = (
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      );
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent)) {
        rejectUnmodeledLoader('escaped process namespace');
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (
        node.name.text === 'require'
        && !(
          (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
          && node.parent.expression === node
        )
      ) rejectUnmodeledLoader(`indirect require member ${node.getText(sourceFile)}`);
      const bunNamespace = bunNamespaceName(node.expression);
      if (bunNamespace) {
        const member = node.name.text;
        const isDirectBuiltinYamlParse = (
          bunNamespace === 'Bun'
          && member === 'YAML'
          && node.questionDotToken === undefined
          && ts.isPropertyAccessExpression(node.parent)
          && node.parent.expression === node
          && node.parent.name.text === 'parse'
          && node.parent.questionDotToken === undefined
          && ts.isCallExpression(node.parent.parent)
          && node.parent.parent.expression === node.parent
          && node.parent.parent.questionDotToken === undefined
        );
        const isDirectBuiltinSemverSatisfies = (
          bunNamespace === 'Bun'
          && member === 'semver'
          && node.questionDotToken === undefined
          && ts.isPropertyAccessExpression(node.parent)
          && node.parent.expression === node
          && node.parent.name.text === 'satisfies'
          && node.parent.questionDotToken === undefined
          && ts.isCallExpression(node.parent.parent)
          && node.parent.parent.expression === node.parent
          && node.parent.parent.questionDotToken === undefined
        );
        const isDirectBuiltinTranspilerConstruction = (
          bunNamespace === 'Bun'
          && member === 'Transpiler'
          && node.questionDotToken === undefined
          && ts.isNewExpression(node.parent)
          && node.parent.expression === node
        );
        if (TCB_BUN_PROCESS_LOADERS.has(`Bun.${member}`)) {
          if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) {
            rejectUnmodeledLoader(`indirect Bun process loader ${bunNamespace}.${member}`);
          }
        } else if (
          !isDirectBuiltinYamlParse
          && !isDirectBuiltinSemverSatisfies
          && !isDirectBuiltinTranspilerConstruction
          && !TCB_BUN_SAFE_GLOBAL_MEMBERS.has(member)
        ) {
          rejectUnmodeledLoader(`unclassified Bun namespace member ${bunNamespace}.${member}`);
        }
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'globalThis') {
        const member = node.name.text;
        if (member !== 'Bun') {
          if (!TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(member)) {
            rejectUnmodeledLoader(`unclassified globalThis member ${member}`);
          }
          const isDirectInvocation = (
            (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
            && node.parent.expression === node
          );
          if (!isDirectInvocation) rejectUnmodeledLoader(`indirect globalThis loader ${member}`);
        }
      }
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'process'
        && !TCB_PROCESS_SAFE_MEMBERS.has(node.name.text)
      ) rejectUnmodeledLoader(`unclassified process member ${node.name.text}`);
    }
    if (
      ts.isPropertyAccessExpression(node)
      && bunNamespaceName(node) === 'globalThis.Bun'
      && !(
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent))
        && node.parent.expression === node
      )
      && !ts.isTypeOfExpression(node.parent)
    ) rejectUnmodeledLoader('indirect Bun namespace globalThis.Bun');
    if (
      ts.isIdentifier(node)
      && bunProcessBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect bun process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect node:child_process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessNamespaces.has(node.text)
      && !isImportBindingDeclaration(node)
    ) {
      const namespaceAccess = ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node
        ? node.parent
        : rejectUnmodeledLoader(`indirect node:child_process namespace ${node.text}`);
      const member = namespaceAccess.name.text;
      if (!TCB_CHILD_PROCESS_LOADERS.has(member)) {
        rejectUnmodeledLoader(`unclassified node:child_process member ${node.text}.${member}`);
      }
      if (!ts.isCallExpression(namespaceAccess.parent) || namespaceAccess.parent.expression !== namespaceAccess) {
        rejectUnmodeledLoader(`indirect node:child_process member ${node.text}.${member}`);
      }
    }
    if (
      ts.isElementAccessExpression(node)
      && bunNamespaceName(node.expression) !== null
    ) rejectUnmodeledLoader(`computed Bun namespace member ${bunNamespaceName(node.expression)}[...]`);
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'globalThis'
    ) rejectUnmodeledLoader('computed globalThis member');
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'process'
    ) rejectUnmodeledLoader('computed process member');
    if (
      ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'module'
    ) rejectUnmodeledLoader('computed module loader member');
    if (
      ts.isElementAccessExpression(node)
      && isImportMeta(node.expression)
    ) rejectUnmodeledLoader('computed import.meta member');
    if (
      ts.isElementAccessExpression(node)
      && (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
      && node.argumentExpression.text === 'require'
    ) rejectUnmodeledLoader('computed require member');
    if (ts.isImportEqualsDeclaration(node)) rejectUnmodeledLoader('import = require');
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (node.arguments.length !== 1 || argument === undefined) {
        throw new Error(`TCB runtime dynamic import is not statically resolvable: ${repositoryPath}.`);
      }
      if (!ts.isStringLiteral(argument)) {
        throw new Error(`TCB runtime dynamic import is not statically resolvable: ${repositoryPath}.`);
      }
      if (TCB_CLASSIFIED_EXTERNAL_IMPORTS.has(argument.text)) {
        rejectUnmodeledLoader(`dynamic ${argument.text} import`);
      }
      specifiers.push(argument.text);
    }
    if (ts.isCallExpression(node)) {
      const name = loaderName(node.expression);
      if (name === 'require') rejectUnmodeledLoader('require');
      if (name === 'createRequire') rejectUnmodeledLoader('createRequire');
      if (name === 'importScripts') rejectUnmodeledLoader('importScripts');
      if (name === 'eval') rejectUnmodeledLoader('eval');
      if (name === 'Function') rejectUnmodeledLoader('Function');
      if (name === 'Worker') rejectUnmodeledLoader('Worker');
      if (name !== null && (TCB_CHILD_PROCESS_LOADERS.has(name) || TCB_BUN_PROCESS_LOADERS.has(name))) {
        reviewProcessDispatch(node, name);
      }
    }
    if (ts.isNewExpression(node)) {
      const name = loaderName(node.expression);
      if (name !== null && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(name)) rejectUnmodeledLoader(name);
    }
    ts.forEachChild(node, visitRuntimeLoaders);
  }
  ts.forEachChild(sourceFile, visitRuntimeLoaders);

  return specifiers.filter((specifier) => {
    if (specifier.startsWith('./') || specifier.startsWith('../')) return true;
    if (TCB_APPROVED_EXTERNAL_IMPORTS.has(specifier)) {
      observedExternalImports.add(specifier);
      return false;
    }
    const reviewedExternalImport = `${repositoryPath} -> ${specifier}`;
    if (TCB_REVIEWED_EXTERNAL_IMPORTS.has(reviewedExternalImport)) {
      reviewedExternalImports.add(reviewedExternalImport);
      observedExternalImports.add(specifier);
      return false;
    }
    throw new Error(
      `TCB runtime import is outside the approved relative/external policy: ${repositoryPath} -> ${specifier}.`
    );
  });
}

export function runtimeRelativeImports(
  repositoryPath: string,
  reviewedProcessDispatchers: Set<string>,
  reviewedExternalImports: Set<string>,
  observedExternalImports: Set<string> = new Set()
): string[] {
  const absolutePath = path.join(compilerRoot, ...repositoryPath.split('/'));
  return runtimeRelativeImportsFromSource(
    repositoryPath,
    readFileSync(absolutePath, 'utf8'),
    reviewedProcessDispatchers,
    reviewedExternalImports,
    observedExternalImports
  );
}

export function resolveRepositoryImport(from: string, specifier: string): string {
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (resolved.endsWith('.js')) resolved = `${resolved.slice(0, -3)}.ts`;
  if (!path.posix.extname(resolved)) resolved = `${resolved}.ts`;
  if (!existsSync(path.join(compilerRoot, ...resolved.split('/')))) {
    throw new Error(`TCB runtime import does not resolve: ${from} -> ${specifier} (${resolved}).`);
  }
  return resolved;
}

export function trustedRuntimeClosure(
  entrypoints: readonly string[] = TCB_RUNTIME_ENTRYPOINTS
): {
  closure: Set<string>;
  reviewedEdges: Set<string>;
  reviewedExternalImports: Set<string>;
  reviewedProcessDispatchers: Set<string>;
  observedExternalImports: Set<string>;
} {
  const closure = new Set<string>();
  const reviewedEdges = new Set<string>();
  const reviewedExternalImports = new Set<string>();
  const reviewedProcessDispatchers = new Set<string>();
  const observedExternalImports = new Set<string>();
  const queue: string[] = [...entrypoints];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const specifier of runtimeRelativeImports(
      current,
      reviewedProcessDispatchers,
      reviewedExternalImports,
      observedExternalImports
    )) {
      const resolved = resolveRepositoryImport(current, specifier);
      const edge = `${current} -> ${resolved}`;
      if (TCB_REVIEWED_SUT_EDGES.has(edge)) {
        reviewedEdges.add(edge);
        continue;
      }
      queue.push(resolved);
    }
  }
  return {
    closure,
    reviewedEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
    observedExternalImports
  };
}

export function matchesCanonicalTrustRoot(repositoryPath: string): boolean {
  return CodexDevelopmentTrustRootPathsV1.some((trustedPath) => (
    trustedPath.endsWith('/') ? repositoryPath.startsWith(trustedPath) : repositoryPath === trustedPath
  )) || CodexDevelopmentTrustRootPathPrefixesV1.some((prefix) => repositoryPath.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// TCB closure lock types
// ---------------------------------------------------------------------------

export interface TcbClosureLockInput {
  readonly closure: Set<string>;
  readonly reviewedEdges: Set<string>;
  readonly reviewedExternalImports: Set<string>;
  readonly reviewedProcessDispatchers: Set<string>;
}

export interface TcbClosureLock {
  readonly schema: 'sec-tcb-closure-lock-v1';
  readonly trustRevision: string;
  readonly moduleCount: number;
  readonly modules: readonly string[];
  readonly reviewedEdges: readonly string[];
  readonly reviewedExternalImports: readonly string[];
  readonly reviewedProcessDispatchers: readonly string[];
  readonly moduleBlobs: Readonly<Record<string, string>>;
  readonly moduleContentDigests: Readonly<Record<string, string>>;
  readonly closureDigest: string;
}

export interface TcbClosureLockVerification {
  readonly status: 'passed' | 'failed';
  readonly failures: readonly string[];
}

// ---------------------------------------------------------------------------
// Git blob and content digest computation
// ---------------------------------------------------------------------------

function computeGitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

function computeContentDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function computeClosureDigest(lock: Omit<TcbClosureLock, 'closureDigest'>): string {
  const canonical = JSON.stringify({
    schema: lock.schema,
    trustRevision: lock.trustRevision,
    moduleCount: lock.moduleCount,
    modules: lock.modules,
    reviewedEdges: lock.reviewedEdges,
    reviewedExternalImports: lock.reviewedExternalImports,
    reviewedProcessDispatchers: lock.reviewedProcessDispatchers,
    moduleBlobs: lock.moduleBlobs,
    moduleContentDigests: lock.moduleContentDigests
  });
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Lock computation and verification
// ---------------------------------------------------------------------------

export function computeTcbClosureLock(input: TcbClosureLockInput, trustRevision: string): TcbClosureLock {
  const modules = [...input.closure].sort();
  const moduleBlobs: Record<string, string> = {};
  const moduleContentDigests: Record<string, string> = {};
  for (const module of modules) {
    const absolutePath = path.join(compilerRoot, ...module.split('/'));
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(absolutePath);
    } catch {
      moduleBlobs[module] = 'missing-file';
      moduleContentDigests[module] = 'sha256:missing-file';
      continue;
    }
    moduleBlobs[module] = computeGitBlobSha(bytes);
    moduleContentDigests[module] = computeContentDigest(bytes);
  }
  const reviewedEdges = [...input.reviewedEdges].sort();
  const reviewedExternalImports = [...input.reviewedExternalImports].sort();
  const reviewedProcessDispatchers = [...input.reviewedProcessDispatchers].sort();
  const partial = {
    schema: 'sec-tcb-closure-lock-v1' as const,
    trustRevision,
    moduleCount: modules.length,
    modules,
    reviewedEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
    moduleBlobs,
    moduleContentDigests
  };
  return { ...partial, closureDigest: computeClosureDigest(partial) };
}

export function verifyTcbClosureLock(input: TcbClosureLockInput): TcbClosureLockVerification {
  const actual = computeTcbClosureLock(input, TCB_CLOSURE_TRUST_REVISION);
  const expected = TCB_CLOSURE_LOCK;
  const failures: string[] = [];

  if (actual.moduleCount !== expected.moduleCount) {
    failures.push(`module count: expected ${expected.moduleCount}, actual ${actual.moduleCount}`);
  }

  const expectedModules = new Set(expected.modules);
  const actualModules = new Set(actual.modules);
  for (const module of actualModules) {
    if (!expectedModules.has(module)) {
      failures.push(`expansion: unexpected module ${module}`);
    }
  }
  for (const module of expectedModules) {
    if (!actualModules.has(module)) {
      failures.push(`contraction: missing module ${module}`);
    }
  }

  for (const module of expected.modules) {
    if (actual.moduleBlobs[module] !== expected.moduleBlobs[module]) {
      failures.push(`substitution: blob mismatch for ${module}`);
    }
    if (actual.moduleContentDigests[module] !== expected.moduleContentDigests[module]) {
      failures.push(`substitution: content digest mismatch for ${module}`);
    }
  }

  const expectedEdges = new Set(expected.reviewedEdges);
  const actualEdges = new Set(actual.reviewedEdges);
  for (const edge of actualEdges) {
    if (!expectedEdges.has(edge)) {
      failures.push(`edge addition: unexpected edge ${edge}`);
    }
  }
  for (const edge of expectedEdges) {
    if (!actualEdges.has(edge)) {
      failures.push(`edge removal: missing edge ${edge}`);
    }
  }

  const expectedExternalImports = new Set(expected.reviewedExternalImports);
  const actualExternalImports = new Set(actual.reviewedExternalImports);
  for (const entry of actualExternalImports) {
    if (!expectedExternalImports.has(entry)) {
      failures.push(`external import addition: unexpected ${entry}`);
    }
  }
  for (const entry of expectedExternalImports) {
    if (!actualExternalImports.has(entry)) {
      failures.push(`external import removal: missing ${entry}`);
    }
  }

  const expectedDispatchers = new Set(expected.reviewedProcessDispatchers);
  const actualDispatchers = new Set(actual.reviewedProcessDispatchers);
  for (const entry of actualDispatchers) {
    if (!expectedDispatchers.has(entry)) {
      failures.push(`process dispatcher addition: unexpected ${entry}`);
    }
  }
  for (const entry of expectedDispatchers) {
    if (!actualDispatchers.has(entry)) {
      failures.push(`process dispatcher removal: missing ${entry}`);
    }
  }

  if (actual.closureDigest !== expected.closureDigest) {
    failures.push(`closure digest: expected ${expected.closureDigest}, actual ${actual.closureDigest}`);
  }

  return { status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export function generateTcbClosureLockForRevision(trustRevision: string): TcbClosureLock {
  const closure = trustedRuntimeClosure();
  return computeTcbClosureLock(closure, trustRevision);
}

// ---------------------------------------------------------------------------
// Frozen lock (generated at trust revision — placeholder, to be filled)
// ---------------------------------------------------------------------------

export const TCB_CLOSURE_TRUST_REVISION = '4b27555bfcaa146e466227beca9f6c7069f68eaf';

// Generated by running generateTcbClosureLockForRevision at trust revision
// 4b27555bfcaa146e466227beca9f6c7069f68eaf.  Do not hand-edit — regenerate.
export const TCB_CLOSURE_LOCK: TcbClosureLock = {
  schema: 'sec-tcb-closure-lock-v1',
  trustRevision: '4b27555bfcaa146e466227beca9f6c7069f68eaf',
  moduleCount: 61,
  modules: [
    'docs/scripts/docs-doctor-ledgers.ts',
    'docs/scripts/docs-doctor-shared.ts',
    'docs/scripts/docs-doctor.ts',
    'platform/dev-runner.ts',
    'platform/dev-runner/check-runner.ts',
    'platform/dev-runner/command-runner.ts',
    'platform/dev-runner/dependency-bootstrap.ts',
    'platform/dev-runner/env-manager.ts',
    'platform/dev-runner/fast-test-policy.ts',
    'platform/dev-runner/import-organizer.ts',
    'platform/dev-runner/test-concurrency-policy.ts',
    'platform/dev-runner/test-runner.ts',
    'platform/dev-runner/typecheck-runner.ts',
    'platform/shared/active-documentation-contract.ts',
    'platform/shared/affected-test-inventory.ts',
    'platform/shared/bun-runtime-version.ts',
    'platform/shared/canonical-primitives.ts',
    'platform/shared/ci-artifact-contract.ts',
    'platform/shared/ci-artifact-types.ts',
    'platform/shared/ci-contract.ts',
    'platform/shared/ci-evidence-composition-policy-registry.ts',
    'platform/shared/ci-evidence-contract.ts',
    'platform/shared/ci-evidence-reuse-contract.ts',
    'platform/shared/ci-execution-environment.ts',
    'platform/shared/ci-git-changed-files.ts',
    'platform/shared/ci-pr-risk-selection.ts',
    'platform/shared/ci-verification-plan.ts',
    'platform/shared/ci-verification-revision.ts',
    'platform/shared/collections.ts',
    'platform/shared/constants.ts',
    'platform/shared/contract-freeze-contract.ts',
    'platform/shared/documentation-authority-contract.ts',
    'platform/shared/errors.ts',
    'platform/shared/fs.ts',
    'platform/shared/heavy-verification-gate-lease.ts',
    'platform/shared/paths.ts',
    'platform/shared/platform-command.ts',
    'platform/shared/process.ts',
    'platform/shared/project-runtime.ts',
    'platform/shared/repository-path-contract.ts',
    'platform/shared/runtime-dependency-spec.ts',
    'platform/shared/runtime-layout.ts',
    'platform/shared/test-budget-contract.ts',
    'platform/shared/test-impact-contract.ts',
    'platform/shared/test-impact-rules/governance.ts',
    'platform/shared/test-impact-rules/pipeline.ts',
    'platform/shared/test-impact-rules/semantic.ts',
    'platform/shared/test-impact-rules/verification.ts',
    'platform/shared/test-ownership-contract.ts',
    'platform/shared/verification-scope-inventory.ts',
    'platform/shared/workspace-path-contract.ts',
    'scripts/ci-pr-risk.ts',
    'scripts/ci-verification.ts',
    'scripts/ci-workspace-fast.ts',
    'scripts/codex/ci-orchestration-core.ts',
    'scripts/codex/document-control-plane-contract.ts',
    'scripts/codex/exact-git-blob.ts',
    'scripts/codex/merge-gate.ts',
    'scripts/codex/work-package-contract.ts',
    'scripts/install-git-hooks.ts',
    'tests/setup/runtime-deps.setup.ts'
  ],
  reviewedEdges: [
    'scripts/ci-workspace-fast.ts -> platform/orchestrator.ts'
  ],
  reviewedExternalImports: [
    'platform/shared/heavy-verification-gate-lease.ts -> bun:ffi'
  ],
  reviewedProcessDispatchers: [
    'docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1',
    'platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1',
    'platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
    'platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
    'platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
    'platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
    'platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1',
    'platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
    'scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1',
    'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1',
    'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1',
    'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1',
    'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1',
    'scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1',
    'scripts/codex/merge-gate.ts::function-declaration:mergeGateGitResolvers>const-arrow:run::spawnSync#1',
    'scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1'
  ],
  moduleBlobs: {
    'docs/scripts/docs-doctor-ledgers.ts': 'ed34e166ad7fcfed1b661a52a025a4944b2dd2bd',
    'docs/scripts/docs-doctor-shared.ts': 'e966651903ce133eb4f63cc29f08c56d944a1393',
    'docs/scripts/docs-doctor.ts': 'ce43bd7039e980f09bf5c162b33f40ff1ab491c2',
    'platform/dev-runner.ts': 'da85c9ca0caf0abb81756903cad61371963001c4',
    'platform/dev-runner/check-runner.ts': '3fa0834597d89111c49f1295f2bd43e8fe9f4e02',
    'platform/dev-runner/command-runner.ts': '1153ba825e53727c8cc72f6727c2d7308a9df2f9',
    'platform/dev-runner/dependency-bootstrap.ts': '4a241a8dc06e40b17daa19180a2599942fe27217',
    'platform/dev-runner/env-manager.ts': '5c16da78d3b32e84f8a19f315beffd050ad4430f',
    'platform/dev-runner/fast-test-policy.ts': '9160196ca3c1e30447fe12e39a48ea97e58291e9',
    'platform/dev-runner/import-organizer.ts': 'ff2d735a3afd6bfb85ffa02232cf6f69f9c50ac2',
    'platform/dev-runner/test-concurrency-policy.ts': '614dcca876dc8f15dfdcc265fdf33ce54c778e78',
    'platform/dev-runner/test-runner.ts': 'd8d51aa962a430bb03fede7541d6cb20d2092e1a',
    'platform/dev-runner/typecheck-runner.ts': '97ab5927e503b591feb0941917aa6a9e52e88afa',
    'platform/shared/active-documentation-contract.ts': '8f31202b50e18bb8f5ab6ccc79fa9622f1808960',
    'platform/shared/affected-test-inventory.ts': 'ad050f4023960668d91cc57dd8fdcaa8f3d8623f',
    'platform/shared/bun-runtime-version.ts': '5a983232be0c3854a4727ebc6ddc4b4e1e53fcba',
    'platform/shared/canonical-primitives.ts': '960c2fc4cbf4c16034a2414d7c206db1d70d4941',
    'platform/shared/ci-artifact-contract.ts': '137655df96a53e13b54fa1e8d5822b3f51562f72',
    'platform/shared/ci-artifact-types.ts': '2c7aa36d6655be99891ac2ca9f251b09d0aac431',
    'platform/shared/ci-contract.ts': '9d81673a82d7cc88059d2f7e78707a7497e63119',
    'platform/shared/ci-evidence-composition-policy-registry.ts': '440a2ec821b1e816759423ad8de5495875e1c99f',
    'platform/shared/ci-evidence-contract.ts': '278c8fa73c409432ec5d6c57055ec11450368885',
    'platform/shared/ci-evidence-reuse-contract.ts': 'aed4ed0ede7d9aecf960d4a3e1efa00a9595895f',
    'platform/shared/ci-execution-environment.ts': 'd39f1933d5a75cbce5fb7f979703e0a262a0cc7b',
    'platform/shared/ci-git-changed-files.ts': '87a169074164878446dbd74d1cfa3fcbde292fbc',
    'platform/shared/ci-pr-risk-selection.ts': 'bb29ca260ddd9d2ef5b249aa5978e3d4f8c373d6',
    'platform/shared/ci-verification-plan.ts': '661345631d07ce887674bac3077d7fb9030d5d4d',
    'platform/shared/ci-verification-revision.ts': '3fd9a44ce70c9ea0ed5c8bbc0c74ca66b8a61df2',
    'platform/shared/collections.ts': '8f8ecb1395714b83e995bcc560304ab1e0d9617f',
    'platform/shared/constants.ts': '57ac9f46586386d35fb52fcf1e94739c4d35bdc0',
    'platform/shared/contract-freeze-contract.ts': 'cc59a713c690903e641de6aa7858431fce46b4bc',
    'platform/shared/documentation-authority-contract.ts': '7ab1264b65a89580044719efccb0b62228d0e021',
    'platform/shared/errors.ts': '160c3b00d95d8457f59801762ae55c5f89e24784',
    'platform/shared/fs.ts': '5c2ef2ead6c82b407d66fd1193a1f0cf5c7701a6',
    'platform/shared/heavy-verification-gate-lease.ts': '27e4d5942c9b1467cb3a8df9d29b907eadc9be32',
    'platform/shared/paths.ts': '4930d9da248d5e0d043d55aa68ecce2976edc422',
    'platform/shared/platform-command.ts': 'a0a980491300475e57de394d34d7f4393d52e3fc',
    'platform/shared/process.ts': 'e2cc559718816f1876c1130d7d57fbad59073f62',
    'platform/shared/project-runtime.ts': 'a7b651b6c57da078a148bb1c07b91dd9a1b25ffc',
    'platform/shared/repository-path-contract.ts': '01cfed0d551ad216d9ecd722920fd01d7018dc54',
    'platform/shared/runtime-dependency-spec.ts': '26c48ef3c4c03c88aeca354a03955a220cb595c6',
    'platform/shared/runtime-layout.ts': 'c8dd1185d96e5a3409b0eed475a8f6c52e5368f5',
    'platform/shared/test-budget-contract.ts': 'fee1df2782dbd3717a30c3c0b3b0fde3f2d35d8a',
    'platform/shared/test-impact-contract.ts': '277a229bedee5d8aacfb639b5486d81a7a5858ef',
    'platform/shared/test-impact-rules/governance.ts': 'df44c858c6508cf8dcfbd8eb7656433a18a13413',
    'platform/shared/test-impact-rules/pipeline.ts': '3ab033ce1fa8fdc495521798a9376a160dce702b',
    'platform/shared/test-impact-rules/semantic.ts': '332264d379b6472776ccbd40e5e74da8d32bd71c',
    'platform/shared/test-impact-rules/verification.ts': '78e8242073a0f84f31ed8d34f1df6d97ab2d8d9c',
    'platform/shared/test-ownership-contract.ts': 'ff8897254fc782c7b2fa53a62424ae2f6ee22415',
    'platform/shared/verification-scope-inventory.ts': '605a6c078e4f4b53818785d063b5a0d3a7ec3c1c',
    'platform/shared/workspace-path-contract.ts': '31382083b9a49c9e4ef51cefd6573a3a68fd5bf1',
    'scripts/ci-pr-risk.ts': '5958faf87467ce63100e21945951e6d780f25c6e',
    'scripts/ci-verification.ts': '7f3882309588de9d7891708898ca10c0ab665714',
    'scripts/ci-workspace-fast.ts': '4584f98914542879d0a38f254b7ab47269545380',
    'scripts/codex/ci-orchestration-core.ts': 'f9bee9b6f804512402bfbb28c9e6412b1c17a477',
    'scripts/codex/document-control-plane-contract.ts': 'a083df67d9db10c28d456965a6cd065f82620d1c',
    'scripts/codex/exact-git-blob.ts': '12f087d151996407ad371e00597c80e60284834f',
    'scripts/codex/merge-gate.ts': '5408c26ba6219ea4c843001f5df1cefc9c461875',
    'scripts/codex/work-package-contract.ts': '1df8614e030ee29ed24debdcb4b3644ae47205d0',
    'scripts/install-git-hooks.ts': '8b6de634ea3de4f6305a61ad877ce5e1a0352a43',
    'tests/setup/runtime-deps.setup.ts': 'd1abd441ef9fadea1e16c76d407d70250dfadd33'
  },
  moduleContentDigests: {
    'docs/scripts/docs-doctor-ledgers.ts': 'sha256:eab4bf38aed449cd1499abbab16272442ff4da5cf083599331b3d99804dffce2',
    'docs/scripts/docs-doctor-shared.ts': 'sha256:82542760cf1cc3a84f8b3ab7129e96f08b6d4dda59f170e600de3e605450e08d',
    'docs/scripts/docs-doctor.ts': 'sha256:c1cbf4b8ef4409eba7013c12b8ea3c19bcbc91e1677b774113e1e693b71a8d1c',
    'platform/dev-runner.ts': 'sha256:ccac50755423156a4e27a5660516d30dffa725cdb35c4b3d5a9d03ad6bdba6fa',
    'platform/dev-runner/check-runner.ts': 'sha256:48757d6ffd40e868d4a7769efa3de4f28b70b95490462e3cb5c65d9d4c73e48b',
    'platform/dev-runner/command-runner.ts': 'sha256:b45598f646f81bfd06d3ac4c53997d068d17fb3959bf3f5ff75d98da2d63ae2e',
    'platform/dev-runner/dependency-bootstrap.ts': 'sha256:f064e0559c4e9f07a13421fb1db87b41acb3b98b94bb5e17e9f3e63270834b23',
    'platform/dev-runner/env-manager.ts': 'sha256:6d05a77a227f747739fb6054bfaadfc56dbd1c75c952bdef9cb78044dcbb5212',
    'platform/dev-runner/fast-test-policy.ts': 'sha256:a5b8cc4062b5e63069bb182d3a874ab2c23ef787290148a528cce98a6100fde6',
    'platform/dev-runner/import-organizer.ts': 'sha256:f7601322b97f9d31161b6f99d5776390b79696be4118af52d0ea90182a77532b',
    'platform/dev-runner/test-concurrency-policy.ts': 'sha256:b0ae5d1f29a528dadf2bd7d91e703e1753baf4991aeb5d65940c05d4f8cf2e4f',
    'platform/dev-runner/test-runner.ts': 'sha256:da1a9245bbdc34c84eca1f9204e3b70b9e17d48d6039b8f5428c0e5cdf324036',
    'platform/dev-runner/typecheck-runner.ts': 'sha256:3fafdc211c6921751f24bcf843e1b23aad032a3022f983b1740912bc7fb97f26',
    'platform/shared/active-documentation-contract.ts': 'sha256:535a253ac9d6e4376697eeb6d0dd8f426bb3ebefffab49fff039fe158cd099c9',
    'platform/shared/affected-test-inventory.ts': 'sha256:3ba9b0bbd48afb96259be631efec97916eb99c6f89dde4b1479a2f58668f54cd',
    'platform/shared/bun-runtime-version.ts': 'sha256:3902ed6e1f50dbd7d8aee80615222619c3bcbd973a6d1d3eea899cbda05b1df5',
    'platform/shared/canonical-primitives.ts': 'sha256:5bf7be826e00e5becfbfb0d5395cb03d0c1f9adbec64bd536e4ff6e5f62d38a3',
    'platform/shared/ci-artifact-contract.ts': 'sha256:c7a35b35ed7009a56e92bc7a84f0537495683ea1b6d84ca3ae6a0b74d498087d',
    'platform/shared/ci-artifact-types.ts': 'sha256:41fe5443efb2944baf4c04e3cc6f386f621c54f10aafd2da212ff72de932a585',
    'platform/shared/ci-contract.ts': 'sha256:620330d981fd1be13c512ce5b10070c92db99d176652359cc414666062fd2197',
    'platform/shared/ci-evidence-composition-policy-registry.ts': 'sha256:f19706e8b83415e80b44b6e54577500b03994dbb381f374c227ba96a2c53bb5d',
    'platform/shared/ci-evidence-contract.ts': 'sha256:feb48a568351d73ad8ed804980e2e6c5a5df579125d62d2c6952964f8a31c881',
    'platform/shared/ci-evidence-reuse-contract.ts': 'sha256:2f110ec688221ee9206a9e3c50524ebb76b05d83d11f7026f70d66496f6f2bcc',
    'platform/shared/ci-execution-environment.ts': 'sha256:e3b2a04262a2b01d1041173c68a352e60ed6bfe26a43d558c3ecda57544121ab',
    'platform/shared/ci-git-changed-files.ts': 'sha256:5382464c2a2f7eb49e13f68233935fc9fa07ac724306d8a048bb666b4090f81c',
    'platform/shared/ci-pr-risk-selection.ts': 'sha256:110657d20a522eb6f4be4915195929dfae4834b39e849822fc4a33bb6bc72532',
    'platform/shared/ci-verification-plan.ts': 'sha256:9d6f16c8f77ceb4981ef0bbf462b1fb875f32f9a6eff8dace419df377652be88',
    'platform/shared/ci-verification-revision.ts': 'sha256:06de17850afd3744be511c8602ee930ea5ccba30134e34b407b5ea4ccb352c3c',
    'platform/shared/collections.ts': 'sha256:8ff70a8bb6f89ba8355d900648d13caa4cc756542d808b7cf7e25efa5886bed4',
    'platform/shared/constants.ts': 'sha256:a3ad2803edd25c3ac9d5e17e30c0f45ebc979d65251b9901704d5ac8a9ba4449',
    'platform/shared/contract-freeze-contract.ts': 'sha256:d7b2948c1abebbf4ba069c1e6d62d73a115b2cf2c0cca05732053e48d2f84f62',
    'platform/shared/documentation-authority-contract.ts': 'sha256:6dc725edda8635416edb84a2cb7f27fde64305f6a12e8304101d4e7a129dbb15',
    'platform/shared/errors.ts': 'sha256:6f2c91d5dda872f56f6e344d2b18a8cbf00fd1ffe3b46d5d36e48b11344c7e15',
    'platform/shared/fs.ts': 'sha256:b8af766c74a285eeadb1c05dc45637889817bc2ee645ce88170d0bf917eeb750',
    'platform/shared/heavy-verification-gate-lease.ts': 'sha256:381f6de4f81b27e6fa6950bc76153d7dba03a9f38739c142e35bb57009d809a4',
    'platform/shared/paths.ts': 'sha256:7fde1c6e6639fb93bd3baf5f02ff95c1b6f3191a5f1c39999088b5847546c0da',
    'platform/shared/platform-command.ts': 'sha256:e7023a1601111086774a38df1d88fce4397675531f21f51ff2aea1e3b810ea77',
    'platform/shared/process.ts': 'sha256:9e29226e0851192ecefb7d9711c823c798f54b1a32a9faadc811c0e3294c34d5',
    'platform/shared/project-runtime.ts': 'sha256:02b26befcc432bba4055f8b78ffd53f84493b599f51e748a47c44f9e20ee5562',
    'platform/shared/repository-path-contract.ts': 'sha256:a20b2bea1e063477d662d06ec332d3267742d5d332694a84b44470236c78ce80',
    'platform/shared/runtime-dependency-spec.ts': 'sha256:f41eb62d9ed4c8beb3655210719fff1ecd324d44a198bbdad3280959b7210f5d',
    'platform/shared/runtime-layout.ts': 'sha256:451987f7325c51c7b648fcaef0dc2f2afc7093c845f51cb825d22ffd97cd875b',
    'platform/shared/test-budget-contract.ts': 'sha256:0e9ab4a6cbaa7b175f0b74ae81b7ba0ce1853eaf4681c10c2f96dca90a00d58f',
    'platform/shared/test-impact-contract.ts': 'sha256:9d0fb869dfa226a502a06c1fe8b396b528dd977492084f07cd251653f1a122db',
    'platform/shared/test-impact-rules/governance.ts': 'sha256:fc7fdf4c31b815483b4f13cda13a013641225060f07df6d42ea2af390e4263bd',
    'platform/shared/test-impact-rules/pipeline.ts': 'sha256:70497cf80c89aa88a56ef48588e7406186a51a8bc36c6a4e935e5ee6c4e77a63',
    'platform/shared/test-impact-rules/semantic.ts': 'sha256:b44efd091d016b53e5c51935e0f3bdf47db3fd6dd790be4ccd82c9bc2b37c013',
    'platform/shared/test-impact-rules/verification.ts': 'sha256:42958ee369f1732e234a484a61f0a624c040c0d1cf95ea49aca020b158202433',
    'platform/shared/test-ownership-contract.ts': 'sha256:e9f416d543f6677c2d203a57934a5bfca2df0ead99e8bcd2a92d50070821afd6',
    'platform/shared/verification-scope-inventory.ts': 'sha256:12bd788cbf791025d87a3c0b058bbad9ea5fea8e37c59d6bf747a31efd0e1d11',
    'platform/shared/workspace-path-contract.ts': 'sha256:c9f1d7c6de3156dfb05a713fcdc20b0f9d64658eb20ce3d7793f093884665181',
    'scripts/ci-pr-risk.ts': 'sha256:0d410cca260ca1a2431cab2ac2a847941de26b6a2f6c5c087b60e1bdceddddcc',
    'scripts/ci-verification.ts': 'sha256:70d2f878b7ed2b732140050633dc923fbcac14322e6c901311c42e9e7f3e241b',
    'scripts/ci-workspace-fast.ts': 'sha256:7d7088e7129730e7a222a7d29500b28b18f9be78b6396c10d328491bfcaab27b',
    'scripts/codex/ci-orchestration-core.ts': 'sha256:9ed44b861760a388c715af95d7ff8a8096105c6a139aeb47448086fb88308d22',
    'scripts/codex/document-control-plane-contract.ts': 'sha256:398097f2d6c0221f63352c15f718571a1aed4ff16aa535fc67d6c3f1d272c177',
    'scripts/codex/exact-git-blob.ts': 'sha256:cdfd2c3a0ab33af567625cbbb0017cf7346125b6011f24cd98b02361e42e21eb',
    'scripts/codex/merge-gate.ts': 'sha256:dc1adccd3ea83966a639090430ffd3a0d6a8881144a5b1a52bdc6af0d540b390',
    'scripts/codex/work-package-contract.ts': 'sha256:4fefc7a8a8b43b83df17ec227f24e7b3d4fe2dc03d60f972cb454fa112329acd',
    'scripts/install-git-hooks.ts': 'sha256:4e7a9a0a6fd29872187d0b7885062f2c30d7310f60ce069f2b1aba4bc9231a19',
    'tests/setup/runtime-deps.setup.ts': 'sha256:4935081f0d5724aee452cc2011855da40b22f25fa0f476d7ebdcd3ccacf13572'
  },
  closureDigest: 'sha256:54632ace73f10e4b809fb1bb41e595c2d7de6e25aa627a3864eacd0f125e59c2'
};

export const TCB_CLOSURE_LOCK_RECEIPT = {
  schema: 'sec-tcb-closure-lock-receipt-v1' as const,
  trustRevision: TCB_CLOSURE_TRUST_REVISION,
  moduleCount: TCB_CLOSURE_LOCK.moduleCount,
  closureDigest: TCB_CLOSURE_LOCK.closureDigest,
  generatedAt: '2026-08-05T00:00:00.000Z',
  generatedBy: 'tcb-closure-maintainer'
} as const;
