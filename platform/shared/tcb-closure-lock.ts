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

import { compilerRoot } from './paths.ts';
import {
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1,
  matchSecTrustedBootstrapPathV1
} from './tcb-trust-root-contract.ts';

// ---------------------------------------------------------------------------
// TCB closure constants (canonical source — moved from sec-merge-gate.test.ts)
// ---------------------------------------------------------------------------

export const TCB_RUNTIME_ENTRYPOINTS = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.runtimeEntrypoints;

export const TCB_REVIEWED_SUT_EDGES = new Set(
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.reviewedSutEdges
);

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
  'scripts/codex/branch-lifecycle-command.ts::const-arrow:defaultBranchLifecycleCommandRunner::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1',
  'scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1',
  'scripts/codex/merge-gate.ts::function-declaration:mergeGateGitResolvers>const-arrow:run::spawnSync#1',
  'scripts/codex/sec-merge-bootstrap-runtime.ts::const-arrow:defaultShellRunner::spawnSync#1',
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
  return matchSecTrustedBootstrapPathV1(repositoryPath) !== null;
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

/**
 * Normalize CRLF and lone CR to LF before digest computation.
 *
 * `.gitattributes` pins `*.ts text eol=lf`, so the canonical Git blob is
 * always LF-normalized.  A working tree checked out on Windows may carry CRLF
 * (e.g. when files pre-date the rule or were touched by CRLF-emitting tools).
 * Computing digests from raw working-tree bytes would bind the lock to a
 * non-canonical line-ending variant and break verification in any worktree
 * with canonical LF checkout.  Normalizing here makes the lock portable across
 * worktrees and identical to the Git-stored blob identity.
 */
function normalizeTextBytes(bytes: Uint8Array): Uint8Array {
  const text = Buffer.from(bytes).toString('utf-8');
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(normalized, 'utf-8');
}

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
    const normalized = normalizeTextBytes(bytes);
    moduleBlobs[module] = computeGitBlobSha(normalized);
    moduleContentDigests[module] = computeContentDigest(normalized);
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

export const TCB_CLOSURE_TRUST_REVISION = '26dcb43c77c9bdfebee35efc217113c958ed017d';

// Generated from the exact live causal closure under the old trusted revision.
// Do not hand-edit hashes/digests; regenerate with generateTcbClosureLockForRevision().
export const TCB_CLOSURE_LOCK: TcbClosureLock = {
  "schema": "sec-tcb-closure-lock-v1",
  "trustRevision": "26dcb43c77c9bdfebee35efc217113c958ed017d",
  "moduleCount": 78,
  "modules": [
    "docs/scripts/docs-doctor-ledgers.ts",
    "docs/scripts/docs-doctor-shared.ts",
    "docs/scripts/docs-doctor.ts",
    "platform/dev-runner.ts",
    "platform/dev-runner/check-runner.ts",
    "platform/dev-runner/command-runner.ts",
    "platform/dev-runner/dependency-bootstrap.ts",
    "platform/dev-runner/env-manager.ts",
    "platform/dev-runner/fast-test-policy.ts",
    "platform/dev-runner/import-organizer.ts",
    "platform/dev-runner/test-concurrency-policy.ts",
    "platform/dev-runner/test-runner.ts",
    "platform/dev-runner/typecheck-runner.ts",
    "platform/shared/active-documentation-contract.ts",
    "platform/shared/affected-test-inventory.ts",
    "platform/shared/bun-runtime-version.ts",
    "platform/shared/canonical-primitives.ts",
    "platform/shared/ci-artifact-contract.ts",
    "platform/shared/ci-artifact-types.ts",
    "platform/shared/ci-contract.ts",
    "platform/shared/ci-evidence-composition-policy-registry.ts",
    "platform/shared/ci-evidence-contract.ts",
    "platform/shared/ci-evidence-reuse-contract.ts",
    "platform/shared/ci-execution-environment.ts",
    "platform/shared/ci-git-changed-files.ts",
    "platform/shared/ci-pr-risk-selection.ts",
    "platform/shared/ci-verification-plan.ts",
    "platform/shared/ci-verification-revision.ts",
    "platform/shared/collections.ts",
    "platform/shared/constants.ts",
    "platform/shared/contract-freeze-contract.ts",
    "platform/shared/documentation-authority-contract.ts",
    "platform/shared/errors.ts",
    "platform/shared/fs.ts",
    "platform/shared/heavy-verification-gate-lease.ts",
    "platform/shared/paths.ts",
    "platform/shared/platform-command.ts",
    "platform/shared/process.ts",
    "platform/shared/project-runtime.ts",
    "platform/shared/repository-path-contract.ts",
    "platform/shared/runtime-dependency-spec.ts",
    "platform/shared/runtime-layout.ts",
    "platform/shared/tcb-trust-root-contract.ts",
    "platform/shared/test-budget-contract.ts",
    "platform/shared/test-impact-contract.ts",
    "platform/shared/test-impact-rules/governance.ts",
    "platform/shared/test-impact-rules/pipeline.ts",
    "platform/shared/test-impact-rules/semantic.ts",
    "platform/shared/test-impact-rules/verification.ts",
    "platform/shared/test-ownership-contract.ts",
    "platform/shared/verification-scope-inventory.ts",
    "platform/shared/workspace-path-contract.ts",
    "scripts/ci-pr-risk.ts",
    "scripts/ci-verification.ts",
    "scripts/ci-workspace-fast.ts",
    "scripts/codex/branch-closeout-contract.ts",
    "scripts/codex/branch-closeout-receipt.ts",
    "scripts/codex/branch-closeout.ts",
    "scripts/codex/branch-lifecycle-audit.ts",
    "scripts/codex/branch-lifecycle-command.ts",
    "scripts/codex/branch-lifecycle-config.ts",
    "scripts/codex/branch-lifecycle-contract.ts",
    "scripts/codex/branch-lifecycle-health.ts",
    "scripts/codex/branch-lifecycle-inventory.ts",
    "scripts/codex/branch-lifecycle-parsers.ts",
    "scripts/codex/branch-lifecycle-types.ts",
    "scripts/codex/branch-lifecycle.ts",
    "scripts/codex/branch-recovery.ts",
    "scripts/codex/ci-orchestration-core.ts",
    "scripts/codex/document-control-plane-contract.ts",
    "scripts/codex/exact-git-blob.ts",
    "scripts/codex/merge-gate.ts",
    "scripts/codex/sec-merge-bootstrap-contract.ts",
    "scripts/codex/sec-merge-bootstrap-runtime.ts",
    "scripts/codex/sec-merge-bootstrap.ts",
    "scripts/codex/work-package-contract.ts",
    "scripts/install-git-hooks.ts",
    "tests/setup/runtime-deps.setup.ts"
  ],
  "reviewedEdges": [
    "scripts/ci-workspace-fast.ts -> platform/orchestrator.ts"
  ],
  "reviewedExternalImports": [
    "platform/shared/heavy-verification-gate-lease.ts -> bun:ffi"
  ],
  "reviewedProcessDispatchers": [
    "docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1",
    "platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1",
    "platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1",
    "platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1",
    "scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1",
    "scripts/codex/branch-lifecycle-command.ts::const-arrow:defaultBranchLifecycleCommandRunner::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1",
    "scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1",
    "scripts/codex/merge-gate.ts::function-declaration:mergeGateGitResolvers>const-arrow:run::spawnSync#1",
    "scripts/codex/sec-merge-bootstrap-runtime.ts::const-arrow:defaultShellRunner::spawnSync#1",
    "scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1"
  ],
  "moduleBlobs": {
    "docs/scripts/docs-doctor-ledgers.ts": "174fc586ecf6a80bc5b1eab570919fcd17d282ac",
    "docs/scripts/docs-doctor-shared.ts": "5b1aa8ae950b6cfe371f2c86e62a948d62bde911",
    "docs/scripts/docs-doctor.ts": "e217ed5fa2a90dfe40c482b9507745fceaa1c3f9",
    "platform/dev-runner.ts": "accce7aef0a19065d8baba829fc3f803d621b3fc",
    "platform/dev-runner/check-runner.ts": "3fa0834597d89111c49f1295f2bd43e8fe9f4e02",
    "platform/dev-runner/command-runner.ts": "1153ba825e53727c8cc72f6727c2d7308a9df2f9",
    "platform/dev-runner/dependency-bootstrap.ts": "42dba87800b232488e356dd52c6fcd413c900351",
    "platform/dev-runner/env-manager.ts": "67a3397e38b5fd754686787ed2d364828402e87c",
    "platform/dev-runner/fast-test-policy.ts": "9160196ca3c1e30447fe12e39a48ea97e58291e9",
    "platform/dev-runner/import-organizer.ts": "ff2d735a3afd6bfb85ffa02232cf6f69f9c50ac2",
    "platform/dev-runner/test-concurrency-policy.ts": "614dcca876dc8f15dfdcc265fdf33ce54c778e78",
    "platform/dev-runner/test-runner.ts": "d8d51aa962a430bb03fede7541d6cb20d2092e1a",
    "platform/dev-runner/typecheck-runner.ts": "022ab5222723f468ac7ab9d7611e64addfe52b0f",
    "platform/shared/active-documentation-contract.ts": "8894712cc4303fbc0a584029c5b4f6c00acf5ad8",
    "platform/shared/affected-test-inventory.ts": "03032e5d1a4a6a84d3d1c94fc897b6d0c3af31e6",
    "platform/shared/bun-runtime-version.ts": "8f0eb0d85daa5c6f7ddf0255512cee6d9af133ab",
    "platform/shared/canonical-primitives.ts": "960c2fc4cbf4c16034a2414d7c206db1d70d4941",
    "platform/shared/ci-artifact-contract.ts": "08a347391a575bab2e5fb46e5af5d16cc0182f1f",
    "platform/shared/ci-artifact-types.ts": "0b00a3e5f46f56708b4ee96fae3d7e451e5197b9",
    "platform/shared/ci-contract.ts": "482b99f84787bce25c03203ecb44ad9fe6bc909c",
    "platform/shared/ci-evidence-composition-policy-registry.ts": "440a2ec821b1e816759423ad8de5495875e1c99f",
    "platform/shared/ci-evidence-contract.ts": "278c8fa73c409432ec5d6c57055ec11450368885",
    "platform/shared/ci-evidence-reuse-contract.ts": "aed4ed0ede7d9aecf960d4a3e1efa00a9595895f",
    "platform/shared/ci-execution-environment.ts": "d39f1933d5a75cbce5fb7f979703e0a262a0cc7b",
    "platform/shared/ci-git-changed-files.ts": "bf27b8ad4383390a24d93bc41a0a66de7f0ebac4",
    "platform/shared/ci-pr-risk-selection.ts": "4f5c64469299042bee9d1ce8f7b489ad52014fca",
    "platform/shared/ci-verification-plan.ts": "3b498f2063f6e68f9e12c9124b8d0e8000309e95",
    "platform/shared/ci-verification-revision.ts": "92985f151988fdd9a859a71669c3fef15b064659",
    "platform/shared/collections.ts": "8f8ecb1395714b83e995bcc560304ab1e0d9617f",
    "platform/shared/constants.ts": "78e19d1d79f8d6f5e729d66cb9ee74b4c6538088",
    "platform/shared/contract-freeze-contract.ts": "dcc6ea490001f528fda99787a41c81a330d5042d",
    "platform/shared/documentation-authority-contract.ts": "5d703f577d1c58b3812207776f6595be21ed802a",
    "platform/shared/errors.ts": "160c3b00d95d8457f59801762ae55c5f89e24784",
    "platform/shared/fs.ts": "cbf7dae627ff588418da759b581135864a3a2c10",
    "platform/shared/heavy-verification-gate-lease.ts": "27e4d5942c9b1467cb3a8df9d29b907eadc9be32",
    "platform/shared/paths.ts": "9f224ae82ce73ea65691ec316afb3ec0a9a0964f",
    "platform/shared/platform-command.ts": "6a59e27518b3e5d0b8c17d4d2cda67a987d68ff3",
    "platform/shared/process.ts": "b75c14e9f05723ddbf1b82ae22303aa0c3f49def",
    "platform/shared/project-runtime.ts": "a7b651b6c57da078a148bb1c07b91dd9a1b25ffc",
    "platform/shared/repository-path-contract.ts": "0d655f17a56379651ed3da2de59048db43936f91",
    "platform/shared/runtime-dependency-spec.ts": "26c48ef3c4c03c88aeca354a03955a220cb595c6",
    "platform/shared/runtime-layout.ts": "67d597cb2845aaa942e5a5e2d2457275dd17624e",
    "platform/shared/tcb-trust-root-contract.ts": "530219cb8fb1c7008b09d7eabfedbb51626387d5",
    "platform/shared/test-budget-contract.ts": "0d6079e8bd8c0be8b167fabe367906f7c70fe748",
    "platform/shared/test-impact-contract.ts": "277a229bedee5d8aacfb639b5486d81a7a5858ef",
    "platform/shared/test-impact-rules/governance.ts": "81a62e2e0bf666cbe4f072bd14e42118f1474649",
    "platform/shared/test-impact-rules/pipeline.ts": "795ef711b12cf8b631dba3f17c07e20e4ef79c9c",
    "platform/shared/test-impact-rules/semantic.ts": "c5be3c5a69ae34115706a44dceb08b375dd91068",
    "platform/shared/test-impact-rules/verification.ts": "08db36043fcc0aae09aed30cd83bc4d2de15474c",
    "platform/shared/test-ownership-contract.ts": "7f0397e7343dbd9cc69e3420973822e308eb8e0d",
    "platform/shared/verification-scope-inventory.ts": "68c3e1b7511dba0d5c7ee209639f330cdacc342c",
    "platform/shared/workspace-path-contract.ts": "bf0efad0e2f0fe1036880c3aef7ec5c273639ff6",
    "scripts/ci-pr-risk.ts": "30d444e88161f76d45a2af87b26c6add566dcb87",
    "scripts/ci-verification.ts": "b11b9faa75028760f90594dc638cf5d9fdef4a03",
    "scripts/ci-workspace-fast.ts": "053e4ddd2db47e8fed05dd39ed88fdaa1a818c23",
    "scripts/codex/branch-closeout-contract.ts": "67efd2f6a9d366041f7d4f489cd23346170a7d69",
    "scripts/codex/branch-closeout-receipt.ts": "1dda78c61747093d6a61530884e97d67928e625e",
    "scripts/codex/branch-closeout.ts": "f4a2ec8aff9aae6c1accf45a73174824c585f04f",
    "scripts/codex/branch-lifecycle-audit.ts": "2d45069a94ae70c143461798653c7f6c1a3a21ab",
    "scripts/codex/branch-lifecycle-command.ts": "56ad10a248da310fb5cb65ae270286b261ddeaee",
    "scripts/codex/branch-lifecycle-config.ts": "5ec7e64a97316647bdd5a4b696b22090e3fd3e95",
    "scripts/codex/branch-lifecycle-contract.ts": "7be4c7077921505915bd4e6ab53915570ad4dced",
    "scripts/codex/branch-lifecycle-health.ts": "d02460a4df8f2717ed7f23cbadfa180a7d339f6c",
    "scripts/codex/branch-lifecycle-inventory.ts": "331d9661523c49030c0b55e9aff897bd777ec366",
    "scripts/codex/branch-lifecycle-parsers.ts": "a7982dbae959b7f124a8f87ded62ae657181d768",
    "scripts/codex/branch-lifecycle-types.ts": "d0f343c3c4491265e6bfcfe0d096b7ad829a3b0c",
    "scripts/codex/branch-lifecycle.ts": "cf68d4ded003770f007cb36cfc635fd79fba20ef",
    "scripts/codex/branch-recovery.ts": "f7f675d89be2468db6bd62f5af2979a36eda5452",
    "scripts/codex/ci-orchestration-core.ts": "7048c0e36e10a270c4fe646801bf4a2c3834fb91",
    "scripts/codex/document-control-plane-contract.ts": "2d2aa54ccba3237e13ca4cedd419b0c115900da8",
    "scripts/codex/exact-git-blob.ts": "c31f795a85cecf3dc9cc1ed4426ef268b95468ba",
    "scripts/codex/merge-gate.ts": "5f400aedb91ca621dbfcbebb4a29aeadd7f0d207",
    "scripts/codex/sec-merge-bootstrap-contract.ts": "00d6d8ada133f428469deeaa804addf144f25b8a",
    "scripts/codex/sec-merge-bootstrap-runtime.ts": "7bb19f76575db93ff11b3bb0fd599af4c2053993",
    "scripts/codex/sec-merge-bootstrap.ts": "608324dae5ab3158114c710e49cd7776197472b7",
    "scripts/codex/work-package-contract.ts": "21775765b7cfc2fda1063f10672eb803e8e7f418",
    "scripts/install-git-hooks.ts": "23b7f0e5cbe0f50578045546daefd82e7fa3df5e",
    "tests/setup/runtime-deps.setup.ts": "88b15eb0053a2af75bbefb00df3d09a6bd255e08"
  },
  "moduleContentDigests": {
    "docs/scripts/docs-doctor-ledgers.ts": "sha256:52a055b99b245eb6229267b32c11c39328f2b736633674c881a84e4045534cbb",
    "docs/scripts/docs-doctor-shared.ts": "sha256:ecf605db8782097832e6de3ca2336f4311a1519a766962e7677d3fafd0cb2132",
    "docs/scripts/docs-doctor.ts": "sha256:29189c0f49f3b3ac80f29eb8ae6c5e18980b5c2a337972855946e8c0b482ae89",
    "platform/dev-runner.ts": "sha256:fba46a2672f12ac254400364a2dec2e9c35e04973510cb284b2a0406a7b248ee",
    "platform/dev-runner/check-runner.ts": "sha256:48757d6ffd40e868d4a7769efa3de4f28b70b95490462e3cb5c65d9d4c73e48b",
    "platform/dev-runner/command-runner.ts": "sha256:b45598f646f81bfd06d3ac4c53997d068d17fb3959bf3f5ff75d98da2d63ae2e",
    "platform/dev-runner/dependency-bootstrap.ts": "sha256:b4cca12f3e0fe2fa5a8c68500ab8d0b4a157160e1c59d392367a9f2355c751f8",
    "platform/dev-runner/env-manager.ts": "sha256:4d39bc7584603d4bb984a568428bae685d60d2381faaf848935730eef4103f56",
    "platform/dev-runner/fast-test-policy.ts": "sha256:a5b8cc4062b5e63069bb182d3a874ab2c23ef787290148a528cce98a6100fde6",
    "platform/dev-runner/import-organizer.ts": "sha256:f7601322b97f9d31161b6f99d5776390b79696be4118af52d0ea90182a77532b",
    "platform/dev-runner/test-concurrency-policy.ts": "sha256:b0ae5d1f29a528dadf2bd7d91e703e1753baf4991aeb5d65940c05d4f8cf2e4f",
    "platform/dev-runner/test-runner.ts": "sha256:da1a9245bbdc34c84eca1f9204e3b70b9e17d48d6039b8f5428c0e5cdf324036",
    "platform/dev-runner/typecheck-runner.ts": "sha256:3f11a7044ad184445620c3e51362e929c0b2e48d9bcb39b9205a239e8843de8f",
    "platform/shared/active-documentation-contract.ts": "sha256:5990c41ce11be18985b63876c912819240ed9e1f3345e93e1856d43dda1e3e1f",
    "platform/shared/affected-test-inventory.ts": "sha256:a4b85dbc8ac4542b6f0a78e2379aec84a646e0cebdfca0c3ce9d66c67134f421",
    "platform/shared/bun-runtime-version.ts": "sha256:56f352fcbbbc189dba528aaa520086edaaaa54ebe9671be6be234c78d2867434",
    "platform/shared/canonical-primitives.ts": "sha256:5bf7be826e00e5becfbfb0d5395cb03d0c1f9adbec64bd536e4ff6e5f62d38a3",
    "platform/shared/ci-artifact-contract.ts": "sha256:95c4f4ade4a9077f66a98eb5a66c9ea09a15bf4da9d31117f2555f62b93388b0",
    "platform/shared/ci-artifact-types.ts": "sha256:02da37c0130e85dc4289a1ae0aa99d746fa0dac8e541bbe0d86856c2823ca242",
    "platform/shared/ci-contract.ts": "sha256:de3a768c46471694594d9b9b08ff3345851df4841b21c20d13ae0a428ee0ce73",
    "platform/shared/ci-evidence-composition-policy-registry.ts": "sha256:f19706e8b83415e80b44b6e54577500b03994dbb381f374c227ba96a2c53bb5d",
    "platform/shared/ci-evidence-contract.ts": "sha256:feb48a568351d73ad8ed804980e2e6c5a5df579125d62d2c6952964f8a31c881",
    "platform/shared/ci-evidence-reuse-contract.ts": "sha256:2f110ec688221ee9206a9e3c50524ebb76b05d83d11f7026f70d66496f6f2bcc",
    "platform/shared/ci-execution-environment.ts": "sha256:e3b2a04262a2b01d1041173c68a352e60ed6bfe26a43d558c3ecda57544121ab",
    "platform/shared/ci-git-changed-files.ts": "sha256:ca7dd603e05e05fe0e061c1406c8c1f728fac359d3ad8f27501f24f65b458098",
    "platform/shared/ci-pr-risk-selection.ts": "sha256:28fca7c9edf69fac98e6a4aeca9239c9d1898a23f37e2d34a029b36861436848",
    "platform/shared/ci-verification-plan.ts": "sha256:991c830d43f9cf6e00c045906ea01188483c8ef0ee20b2762db6cdc60cc87165",
    "platform/shared/ci-verification-revision.ts": "sha256:c7f112d79d02a0988a3b2fe608b7e84cc212d2113061958fbd0b234634331028",
    "platform/shared/collections.ts": "sha256:8ff70a8bb6f89ba8355d900648d13caa4cc756542d808b7cf7e25efa5886bed4",
    "platform/shared/constants.ts": "sha256:bff35d03ea929d90b6f23a4246919011271bb86f0710cc86f51692ca51af26b5",
    "platform/shared/contract-freeze-contract.ts": "sha256:294ddf1a68d00ac41bff7b117a8e8882f918542e2ea4efe5eb06f8289edceb54",
    "platform/shared/documentation-authority-contract.ts": "sha256:98c98a6a75b3468e4f7657f5077350128edf8e865e717a376a2b6038a209062c",
    "platform/shared/errors.ts": "sha256:6f2c91d5dda872f56f6e344d2b18a8cbf00fd1ffe3b46d5d36e48b11344c7e15",
    "platform/shared/fs.ts": "sha256:a224bb682431c521432c2c35829af3ef8f797a644b176fd9199cf49f6bc4a243",
    "platform/shared/heavy-verification-gate-lease.ts": "sha256:381f6de4f81b27e6fa6950bc76153d7dba03a9f38739c142e35bb57009d809a4",
    "platform/shared/paths.ts": "sha256:82737bda5c4efa4f0338d3c3a3434a23daefd9918f440cddd044da62de2e0d20",
    "platform/shared/platform-command.ts": "sha256:dbb654a1697a0d73892b55bbd488f9fc2006a1fafe80f22fb82b8e0e15ba1a9c",
    "platform/shared/process.ts": "sha256:de6846b34674ba96a409b3769083d3a427939fcacfb9c437b59fe612e7493660",
    "platform/shared/project-runtime.ts": "sha256:02b26befcc432bba4055f8b78ffd53f84493b599f51e748a47c44f9e20ee5562",
    "platform/shared/repository-path-contract.ts": "sha256:262d0d7b19105bb20c232b88e0f71de0987956374034bb80f3548d92e27454ba",
    "platform/shared/runtime-dependency-spec.ts": "sha256:f41eb62d9ed4c8beb3655210719fff1ecd324d44a198bbdad3280959b7210f5d",
    "platform/shared/runtime-layout.ts": "sha256:6b7a07641c2504b9a4a2e588483e9e47fddcab308547df4cc10e9000dc2420d0",
    "platform/shared/tcb-trust-root-contract.ts": "sha256:68c2f6f4265a764f3948a4e031df691f623f5f6546d2835467e75aaf45793250",
    "platform/shared/test-budget-contract.ts": "sha256:7cd98f0183a499779a604238fbfc1ec1b6061f866297507453c025c91f8395c6",
    "platform/shared/test-impact-contract.ts": "sha256:9d0fb869dfa226a502a06c1fe8b396b528dd977492084f07cd251653f1a122db",
    "platform/shared/test-impact-rules/governance.ts": "sha256:bd94d76a53e21e958462440c4040d67f4430768f5e9e32b46650ed5863c6de86",
    "platform/shared/test-impact-rules/pipeline.ts": "sha256:60230c98d9aecf6eade848528a6cf097766f6bdfa38f27b3e584d0a385f23981",
    "platform/shared/test-impact-rules/semantic.ts": "sha256:711d4b45d0bb7d91dc09d7e637e671cf1e6024654f64b3a2dd23b20abdeabb72",
    "platform/shared/test-impact-rules/verification.ts": "sha256:9ff3b8872c9500f7a3bd82d09ebbf8fdba69a9a4a7dd908375f009bac7a55ad5",
    "platform/shared/test-ownership-contract.ts": "sha256:622ab63efb28ce13e2023b7e08da72a63b01b2a1c030b70b221327cd5ffda5c7",
    "platform/shared/verification-scope-inventory.ts": "sha256:94b1fb0e198662868b1a658cc6932fb0f5027784cd585fc01c606e97fa209e59",
    "platform/shared/workspace-path-contract.ts": "sha256:65235f9548e99be1e6b333bb3b018dc7e4eeaf866b7fb052db64b9fdef9df364",
    "scripts/ci-pr-risk.ts": "sha256:47cad822bddd8e10a90e257b92b505ed12fe03597938474dfdbb5b56acd85ed6",
    "scripts/ci-verification.ts": "sha256:b2a8786e2e1b5bfb5665cbd3c0d15c40cadc7cfc14f089bbdff552302b312ead",
    "scripts/ci-workspace-fast.ts": "sha256:a4500b0271ae1251600c1656495a0f970615d229b6ab7cbce885dead0af01d9c",
    "scripts/codex/branch-closeout-contract.ts": "sha256:d3283c8112a78e549725471c9c1a359cd72dc96e9035e43915740c4f3bab8ab4",
    "scripts/codex/branch-closeout-receipt.ts": "sha256:d78046a9a9c027d6b648f7ac0b1eb05d37faa940e314973e46f6e729d1682212",
    "scripts/codex/branch-closeout.ts": "sha256:ca4f06361e721657ff1f083c1d6e7fc39096b1d0ffcba2ad454b9d4907c87111",
    "scripts/codex/branch-lifecycle-audit.ts": "sha256:f8c453575ef58f49613b5cb79f75cc1377c08ef696866b0ca8b42bd950f6571b",
    "scripts/codex/branch-lifecycle-command.ts": "sha256:7964a974577f15ee367398d14c1a23767b82acb4d311cdd04b6d156287dfe866",
    "scripts/codex/branch-lifecycle-config.ts": "sha256:3806c547c3bab603d3cd7fcf8dfcd36e74d96f3f6e7bcc115aeba2a9e0b2611d",
    "scripts/codex/branch-lifecycle-contract.ts": "sha256:c40c8a3474585087f70a5f38200be923ccc9e8f43bc8b811bf14535825758b48",
    "scripts/codex/branch-lifecycle-health.ts": "sha256:4b56e90ac0899279f9637d711d25b403b0a2c23030a6eef1e5d5aa32994811c7",
    "scripts/codex/branch-lifecycle-inventory.ts": "sha256:482f184e6e97c6649e2b8990abfec28f7617bdc49a73531b821d52e749897e9d",
    "scripts/codex/branch-lifecycle-parsers.ts": "sha256:4d18ec803915553ea928dd779de0011174889eaa27b6154a28c6b0bf697b6ad0",
    "scripts/codex/branch-lifecycle-types.ts": "sha256:fff26ea4512d3e8c85092638981b37864a762c93b020400dca564883941b5ec4",
    "scripts/codex/branch-lifecycle.ts": "sha256:14a21bae1d3784c0f4c4ae533b8dc493d890f44d723dc62147fb5b1e0c005c60",
    "scripts/codex/branch-recovery.ts": "sha256:7e20ef21920493da58520ee6b65515d7f624ff1e030b73007b87eb29871fb73a",
    "scripts/codex/ci-orchestration-core.ts": "sha256:0e727c9a4d2530c22a954615af2b77a41b9e2023a7ef203989694fddb60ba336",
    "scripts/codex/document-control-plane-contract.ts": "sha256:4038a5408b4b05093961e0a8df60aa33ed0ab124fc32b41e9edd5e3dcc969034",
    "scripts/codex/exact-git-blob.ts": "sha256:6bd0052de607521e2a6f1d982de8facbdec5def749af5d1749370ebd5f0269b5",
    "scripts/codex/merge-gate.ts": "sha256:593b9b798cae82d69a798baf931672662bf2ddc098fc2d463c0b2892589d28f5",
    "scripts/codex/sec-merge-bootstrap-contract.ts": "sha256:82c58bad4a1654ff6ce19b618fd2ec9b334f9080c814100032bdd81074e3b607",
    "scripts/codex/sec-merge-bootstrap-runtime.ts": "sha256:7a0b72d75f376a8b6d38f9c53737e8da1b6b89cfce9e202166978afaee596aac",
    "scripts/codex/sec-merge-bootstrap.ts": "sha256:904e33e320d9b9fb1224ef40813e8b88fd7a16514d34d7eebdaa06d13e0d3906",
    "scripts/codex/work-package-contract.ts": "sha256:802dbb0f940a4f278d6cccb299cc4f955a162816550314e910a330a9bcaf08f4",
    "scripts/install-git-hooks.ts": "sha256:19f44233a7ed2cd9e897838784ce06a7776efbdf6942a6a04adc144e48808db7",
    "tests/setup/runtime-deps.setup.ts": "sha256:6e6887ffcb8fead51f11fe8b223789f71a9512bd0805313c01035ec035c01441"
  },
  "closureDigest": "sha256:fba338a9c0f0713dcdaa2c569f392ef065b0191d317ae77a134de2c26fbcb06b"
};

export const TCB_CLOSURE_LOCK_RECEIPT = {
  schema: 'sec-tcb-closure-lock-receipt-v1' as const,
  trustRevision: TCB_CLOSURE_TRUST_REVISION,
  moduleCount: TCB_CLOSURE_LOCK.moduleCount,
  closureDigest: TCB_CLOSURE_LOCK.closureDigest,
  generatedAt: '2026-08-08T07:12:06.811Z',
  generatedBy: 'tcb-closure-maintainer'
} as const;
