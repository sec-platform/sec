/**
 * sec-tcb-closure-lock — exact-tree TCB closure identity compiler.
 *
 * This module is the single canonical source for the trusted-runtime closure
 * builder, derived TCB closure identity, and identity verifier.
 *
 * The identity binds the exact reviewed modules, their edges, Git blob SHA-1s,
 * raw content SHA-256 digests, reviewed SUT and static-exact boundary edges,
 * reviewed external imports, reviewed process dispatchers, and the single
 * trust revision. It is compiled from trusted policy plus immutable candidate
 * tree bytes and is never checked in as a second source of truth.
 *
 * Verification compares an exact-tree identity instead of a hard-coded module
 * count. Any unauthorized expansion, contraction, substitution, or edge
 * addition fails closed.
 * A reviewed boundary terminates traversal at a separately verified
 * static-exact trust-root blob, so the runtime can import this lock without
 * creating a self-hash/module-loader cycle.
 */

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync
} from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { rawSha256Hex } from '../../../../../contracts/canonical.ts';
import { gitBlobObjectId } from '../../../../../contracts/git-object-id.ts';
import { IsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';
import { compilerRoot } from "../../../../workspace-context.ts";
import { createVerificationActionKey, createVerificationActionPlan, type VerificationActionPlan } from '../../action/contract/action.ts';
import {
  TRUSTED_BOOTSTRAP_REGISTRY,
  TRUSTED_BOOTSTRAP_REGISTRY_PATH,
  createTrustedBootstrapTrustRoot,
  matchTrustedBootstrapPath,
  type TrustedBootstrapRegistry,
  type TrustedBootstrapTrustRoot
} from '../contract/root.ts';

// ---------------------------------------------------------------------------
// TCB closure constants (canonical source — moved from merge-gate.test.ts)
// ---------------------------------------------------------------------------

const TCB_RUNTIME_ENTRYPOINTS = TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints;

const TCB_REVIEWED_SUT_EDGES = new Set(
  TRUSTED_BOOTSTRAP_REGISTRY.reviewedSutEdges
);

const TCB_REVIEWED_BOUNDARY_EDGES = new Set(
  TRUSTED_BOOTSTRAP_REGISTRY.reviewedBoundaryEdges
);

const TCB_APPROVED_EXTERNAL_IMPORTS = new Set([
  'node:async_hooks',
  'node:crypto',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:os',
  'node:path',
  'node:stream',
  'node:timers/promises',
  'node:url',
  'node:util',
  'node:util/types',
  'diff',
  'p-limit',
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

const TCB_WORKER_THREAD_SAFE_IMPORTS = new Set([
  'parentPort'
]);

const TCB_WORKER_GLOBAL_SAFE_MEMBERS = new Set([
  'onmessage',
  'postMessage'
]);

export const TCB_REVIEWED_PROCESS_DISPATCHERS = new Set([
  'src/adapters/self-hosting/development/runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
  'src/adapters/self-hosting/development/runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
  'src/adapters/self-hosting/development/runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
  'src/adapters/self-hosting/development/runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
  'src/adapters/runtime-state/physical/runtime/observed-process.ts::function-declaration:defaultSpawnChild::spawn#1',
  'src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts::function-declaration:startWindowsObservedStdinWriter::node:worker_threads.Worker#1',
  'src/adapters/runtime-state/physical/runtime/process.ts::function-declaration:runCommandCapture::spawn#1',
  'src/adapters/runtime-state/physical/runtime/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
  'src/adapters/runtime-state/physical/runtime/windows-repository-change-observer.ts::function-declaration:startWatcher::Worker#1',
  'src/adapters/verification/platform/ci/verification.ts::function-declaration:inspectHostedActionArchiveMetadata::spawnSync#1',
  'src/adapters/verification/platform/ci/verification.ts::function-declaration:gitCandidateBytes::spawnSync#1',
  'src/adapters/verification/platform/ci/verification.ts::function-declaration:defaultHostedSutSandboxProcess::spawn#1',
  'src/adapters/verification/platform/ci/verification.ts::function-declaration:hostedActionGhReadJson::spawnSync#1',
  'src/adapters/verification/platform/ci/verification.ts::function-declaration:runHostedMaterializerCommand::spawnSync#1',
  'src/adapters/self-hosting/control/agent/agent-operation-activation.ts::function-declaration:command::spawnSync#1',
  'src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts::function-declaration:runCloseoutObservationGh::spawnSync#1',
  'src/adapters/self-hosting/control/branch-lifecycle/branch-closeout.ts::function-declaration:runCloseoutGit::spawnSync#1',
  'src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts::function-declaration:runInventoryCommand::spawnSync#1',
  'src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts::function-declaration:runRecoveryGit::spawnSync#1',
  'src/adapters/providers/git-read/exact-blob.ts::function-declaration:runGit::spawnSync#1',
  'src/adapters/self-hosting/control/issues/issue-disposition-github.ts::function-declaration:gh::spawnSync#1',
  'src/adapters/verification/platform/ci/runtime/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeup::spawnSync#1',
  'src/adapters/verification/platform/ci/runtime/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1',
  'src/adapters/verification/platform/ci/runtime/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1',
  'src/adapters/verification/platform/ci/runtime/verification-session-github.ts::function-declaration:runVerificationSessionGh::spawnSync#1',
  'src/adapters/verification/platform/ci/runtime/verification-session.ts::function-declaration:runVerificationSessionCommand::spawnSync#1',
  'src/adapters/self-hosting/development/hooks/install.ts::function-declaration:gitText::spawnSync#1'
]);

export const TCB_REVIEWED_NETWORK_DISPATCHERS = new Set([
  'src/adapters/providers/github-api/internal/operation-session-runtime.ts::function-declaration:withProductionSession::globalThis.fetch#1'
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
  'isMainThread',
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

const TCB_PROCESS_SAFE_MEMBERS = new Set([
  'arch',
  'argv',
  'cwd',
  'env',
  'execPath',
  'exit',
  'exitCode',
  'geteuid',
  'kill',
  'once',
  'pid',
  'ppid',
  'platform',
  'stderr',
  'stdout',
  'versions'
]);

// ---------------------------------------------------------------------------
// TCB closure logic (canonical source — moved from merge-gate.test.ts)
// ---------------------------------------------------------------------------

export function runtimeRelativeImportsFromSource(
  repositoryPath: string,
  source: string,
  reviewedProcessDispatchers: Set<string> = new Set(),
  reviewedExternalImports: Set<string> = new Set(),
  observedExternalImports: Set<string> = new Set(),
  reviewedNetworkDispatchers: Set<string> = new Set()
): string[] {
  const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
  let lexicalChecker: ts.TypeChecker | undefined;
  const localSymbol = (identifier: ts.Identifier): ts.Symbol | undefined => {
    if (lexicalChecker === undefined) {
      const options: ts.CompilerOptions = {
        noLib: true,
        noResolve: true,
        target: ts.ScriptTarget.Latest
      };
      const host: ts.CompilerHost = {
        fileExists: (fileName) => fileName === repositoryPath,
        readFile: (fileName) => fileName === repositoryPath ? source : undefined,
        getSourceFile: (fileName) => fileName === repositoryPath ? sourceFile : undefined,
        getDefaultLibFileName: () => '',
        writeFile: () => undefined,
        getCurrentDirectory: () => '',
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n'
      };
      lexicalChecker = ts.createProgram([repositoryPath], options, host).getTypeChecker();
    }
    return lexicalChecker.getSymbolAtLocation(identifier);
  };
  const isLocallyBoundIdentifier = (identifier: ts.Identifier): boolean => (
    localSymbol(identifier) !== undefined
  );
  const isRuntimeLocallyBoundIdentifier = (identifier: ts.Identifier): boolean => {
    const declaration = localSymbol(identifier)?.valueDeclaration;
    return declaration !== undefined
      && (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Ambient) === 0;
  };
  const specifiers: string[] = [];
  const bunProcessBindings = new Map<string, string>();
  const childProcessBindings = new Map<string, string>();
  const childProcessNamespaces = new Set<string>();
  const threadWorkerBindings = new Set<string>();
  const workerGlobalBindings = new Set<string>();
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
        if (moduleSpecifier === 'node:worker_threads') {
          if (namespaceBindings.length > 0 || runtimeNamedImports.length === 0) {
            rejectUnmodeledLoader('node:worker_threads import without classified runtime bindings');
          }
          for (const element of runtimeNamedImports) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (TCB_WORKER_THREAD_SAFE_IMPORTS.has(importedName)) continue;
            if (importedName !== 'Worker') {
              rejectUnmodeledLoader(`unclassified node:worker_threads binding ${importedName}`);
            }
            threadWorkerBindings.add(element.name.text);
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
      if (threadWorkerBindings.has(expression.text)) return 'node:worker_threads.Worker';
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
  const reviewProcessDispatch = (node: ts.CallExpression | ts.NewExpression, loader: string): void => {
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
  const networkDispatchOrdinals = new Map<string, number>();
  const reviewNetworkDispatch = (node: ts.CallExpression, loader: string): void => {
    const chunks = lexicalOwnerChunks(node)
      ?? rejectUnmodeledLoader('network dispatcher without a canonical named lexical owner');
    const rootChunk = chunks[0]
      ?? rejectUnmodeledLoader('network dispatcher without a canonical named lexical owner');
    if (!isCanonicalRootOwner(rootChunk.node)) {
      rejectUnmodeledLoader('network dispatcher without a canonical named lexical owner');
    }
    const segments: string[] = [];
    for (const chunk of chunks) {
      segments.push(...chunk.segments);
      const chainPrefix = segments.join('>');
      if (ownerChainCounts.get(chainPrefix) !== 1) {
        rejectUnmodeledLoader(`ambiguous network dispatcher owner ${chainPrefix}`);
      }
    }
    const chain = segments.join('>');
    const ordinalKey = `${repositoryPath}::${chain}::${loader}`;
    const ordinal = (networkDispatchOrdinals.get(ordinalKey) ?? 0) + 1;
    networkDispatchOrdinals.set(ordinalKey, ordinal);
    const identity = `${ordinalKey}#${ordinal}`;
    if (!TCB_REVIEWED_NETWORK_DISPATCHERS.has(identity)) {
      rejectUnmodeledLoader(`unreviewed network dispatcher ${identity}`);
    }
    reviewedNetworkDispatchers.add(identity);
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

  const reviewedWorkerGlobalBinding = (identifier: ts.Identifier): string | null => {
    const firstAssertion = identifier.parent;
    if (
      !ts.isAsExpression(firstAssertion)
      || firstAssertion.expression !== identifier
      || firstAssertion.type.kind !== ts.SyntaxKind.UnknownKeyword
    ) return null;
    const secondAssertion = firstAssertion.parent;
    if (!ts.isAsExpression(secondAssertion) || secondAssertion.expression !== firstAssertion) return null;
    const declaration = secondAssertion.parent;
    if (
      !ts.isVariableDeclaration(declaration)
      || declaration.initializer !== secondAssertion
      || !ts.isIdentifier(declaration.name)
      || variableDeclarationKind(declaration) !== 'const'
      || !ts.isVariableStatement(declaration.parent.parent)
      || declaration.parent.parent.parent !== sourceFile
    ) return null;
    const reviewedWorkerPrefix = `${repositoryPath}::`;
    if (![...TCB_REVIEWED_PROCESS_DISPATCHERS].some(
      (identity) => identity.startsWith(reviewedWorkerPrefix) && identity.includes('::Worker#')
    )) return null;
    return declaration.name.text;
  };

  const reviewedWorkerGlobalArgument = (identifier: ts.Identifier): boolean => {
    const call = identifier.parent;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return false;
    const callExpressionName = call.expression.text;
    const parameterIndex = call.arguments.findIndex((argument) => argument === identifier);
    if (parameterIndex < 0) return false;
    const candidates = sourceFile.statements.filter(
      (statement): statement is ts.FunctionDeclaration => (
        ts.isFunctionDeclaration(statement)
        && statement.name?.text === callExpressionName
        && statement.body !== undefined
      )
    );
    if (candidates.length !== 1) return false;
    const candidate = candidates[0]!;
    const parameter = candidate.parameters[parameterIndex];
    if (parameter === undefined || !ts.isIdentifier(parameter.name)) return false;
    const parameterName = parameter.name.text;
    let valid = true;
    const inspectUse = (node: ts.Node): void => {
      if (!valid) return;
      if (
        ts.isIdentifier(node)
        && node.text === parameterName
        && node !== parameter.name
        && !isPropertyName(node)
        && !isTypeOnlyIdentifier(node)
      ) {
        if (
          !ts.isPropertyAccessExpression(node.parent)
          || node.parent.expression !== node
          || !TCB_WORKER_GLOBAL_SAFE_MEMBERS.has(node.parent.name.text)
        ) valid = false;
      }
      ts.forEachChild(node, inspectUse);
    };
    inspectUse(candidate.body!);
    return valid;
  };

  function visitRuntimeLoaders(node: ts.Node): void {
    if (
      ts.isIdentifier(node)
      && node.text === 'fetch'
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
      && !isLocallyBoundIdentifier(node)
    ) rejectUnmodeledLoader('bare or indirect network dispatcher fetch');
    if (
      ts.isIdentifier(node)
      && TCB_FORBIDDEN_GLOBAL_ALIASES.has(node.text)
      && !isPropertyName(node)
    ) rejectUnmodeledLoader(`unapproved global namespace ${node.text}`);
    if (
      ts.isIdentifier(node)
      && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(node.text)
      && !isPropertyName(node)
      && !ts.isImportSpecifier(node.parent)
      && !isTypeOnlyIdentifier(node)
      && !isLocallyBoundIdentifier(node)
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
      && !isLocallyBoundIdentifier(node)
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
      const workerGlobalBinding = reviewedWorkerGlobalBinding(node);
      if (workerGlobalBinding !== null) workerGlobalBindings.add(workerGlobalBinding);
      if (!isDirectMemberOwner && !ts.isTypeOfExpression(node.parent) && workerGlobalBinding === null) {
        rejectUnmodeledLoader('escaped globalThis namespace');
      }
    }
    if (
      ts.isIdentifier(node)
      && workerGlobalBindings.has(node.text)
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
    ) {
      const isDeclarationName = ts.isVariableDeclaration(node.parent) && node.parent.name === node;
      const isReviewedMember = (
        ts.isPropertyAccessExpression(node.parent)
        && node.parent.expression === node
        && TCB_WORKER_GLOBAL_SAFE_MEMBERS.has(node.parent.name.text)
      );
      if (!isDeclarationName && !isReviewedMember && !reviewedWorkerGlobalArgument(node)) {
        rejectUnmodeledLoader(`escaped reviewed worker global binding ${node.text}`);
      }
    }
    if (
      ts.isIdentifier(node)
      && node.text === 'process'
      && !isPropertyName(node)
      && !isRuntimeLocallyBoundIdentifier(node)
    ) {
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
        const isDirectBuiltinDataParse = (
          bunNamespace === 'Bun'
          && (member === 'TOML' || member === 'YAML')
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
        const isDirectBuiltinExecutableLookup = (
          bunNamespace === 'Bun'
          && member === 'which'
          && node.questionDotToken === undefined
          && ts.isCallExpression(node.parent)
          && node.parent.expression === node
          && node.parent.questionDotToken === undefined
        );
        const isDirectBuiltinStdinAccess = (
          bunNamespace === 'Bun'
          && member === 'stdin'
          && node.questionDotToken === undefined
          && ts.isPropertyAccessExpression(node.parent)
          && node.parent.expression === node
          && (node.parent.name.text === 'bytes' || node.parent.name.text === 'stream')
          && node.parent.questionDotToken === undefined
          && ts.isCallExpression(node.parent.parent)
          && node.parent.parent.expression === node.parent
          && node.parent.parent.questionDotToken === undefined
        );
        if (TCB_BUN_PROCESS_LOADERS.has(`Bun.${member}`)) {
          if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) {
            rejectUnmodeledLoader(`indirect Bun process loader ${bunNamespace}.${member}`);
          }
        } else if (
          !isDirectBuiltinDataParse
          && !isDirectBuiltinSemverSatisfies
          && !isDirectBuiltinTranspilerConstruction
          && !isDirectBuiltinExecutableLookup
          && !isDirectBuiltinStdinAccess
          && !TCB_BUN_SAFE_GLOBAL_MEMBERS.has(member)
        ) {
          rejectUnmodeledLoader(`unclassified Bun namespace member ${bunNamespace}.${member}`);
        }
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'globalThis') {
        const member = node.name.text;
        if (member !== 'Bun') {
          if (member === 'fetch') {
            const isDirectInvocation = (
              node.questionDotToken === undefined
              && ts.isCallExpression(node.parent)
              && node.parent.expression === node
              && node.parent.questionDotToken === undefined
            );
            if (!isDirectInvocation) rejectUnmodeledLoader('indirect globalThis network dispatcher fetch');
            reviewNetworkDispatch(node.parent as ts.CallExpression, 'globalThis.fetch');
          } else if (!TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(member)) {
            rejectUnmodeledLoader(`unclassified globalThis member ${member}`);
          } else {
            const isDirectInvocation = (
              (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent))
              && node.parent.expression === node
            );
            if (!isDirectInvocation) rejectUnmodeledLoader(`indirect globalThis loader ${member}`);
          }
        }
      }
      if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'process'
        && !isRuntimeLocallyBoundIdentifier(node.expression)
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
      && !isTypeOnlyIdentifier(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect bun process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
      && !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect node:child_process binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && threadWorkerBindings.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isPropertyName(node)
      && !isTypeOnlyIdentifier(node)
      && !(ts.isNewExpression(node.parent) && node.parent.expression === node)
    ) rejectUnmodeledLoader(`indirect node:worker_threads Worker binding ${node.text}`);
    if (
      ts.isIdentifier(node)
      && childProcessNamespaces.has(node.text)
      && !isImportBindingDeclaration(node)
      && !isTypeOnlyIdentifier(node)
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
      && !isRuntimeLocallyBoundIdentifier(node.expression)
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
      if (name === 'Worker' || name === 'node:worker_threads.Worker') {
        reviewProcessDispatch(node, name);
      } else if (name !== null && TCB_GLOBAL_THIS_RUNTIME_LOADERS.has(name)) {
        rejectUnmodeledLoader(name);
      }
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
    if (TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports.includes(reviewedExternalImport)) {
      reviewedExternalImports.add(reviewedExternalImport);
      observedExternalImports.add(specifier);
      return false;
    }
    throw new Error(
      `TCB runtime import is outside the approved relative/external policy: ${repositoryPath} -> ${specifier}.`
    );
  });
}

function runtimeRelativeImportsAtCandidateRoot(
  candidateRoot: TcbClosureCandidateRootReader,
  repositoryPath: string,
  reviewedProcessDispatchers: Set<string>,
  reviewedExternalImports: Set<string>,
  observedExternalImports: Set<string>,
  reviewedNetworkDispatchers: Set<string>
): string[] {
  const bytes = readTcbClosureCandidateModule(candidateRoot, repositoryPath);
  if (bytes === null) {
    throw new Error(`TCB candidate module is missing: ${repositoryPath}.`);
  }
  return runtimeRelativeImportsFromSource(
    repositoryPath,
    Buffer.from(bytes).toString('utf8'),
    reviewedProcessDispatchers,
    reviewedExternalImports,
    observedExternalImports,
    reviewedNetworkDispatchers
  );
}

function resolveRepositoryImportAtCandidateRoot(
  candidateRoot: TcbClosureCandidateRootReader,
  from: string,
  specifier: string
): string {
  let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  if (resolved.endsWith('.js')) resolved = `${resolved.slice(0, -3)}.ts`;
  if (!path.posix.extname(resolved)) resolved = `${resolved}.ts`;
  if (readTcbClosureCandidateModule(candidateRoot, resolved) === null) {
    throw new Error(`TCB runtime import does not resolve: ${from} -> ${specifier} (${resolved}).`);
  }
  return resolved;
}

export function trustedRuntimeClosure(
  entrypoints: readonly string[] = TCB_RUNTIME_ENTRYPOINTS,
  options: TcbClosureCandidateRootOptions = {}
): {
  closure: Set<string>;
  reviewedEdges: Set<string>;
  reviewedBoundaryEdges: Set<string>;
  reviewedExternalImports: Set<string>;
  reviewedProcessDispatchers: Set<string>;
  reviewedNetworkDispatchers: Set<string>;
  observedExternalImports: Set<string>;
} {
  return trustedRuntimeClosureAtCandidateRoot(
    resolveTcbClosureCandidateRoot(options),
    entrypoints
  );
}

function trustedRuntimeClosureAtCandidateRoot(
  candidateRoot: TcbClosureCandidateRootReader,
  entrypoints: readonly string[]
): {
  closure: Set<string>;
  reviewedEdges: Set<string>;
  reviewedBoundaryEdges: Set<string>;
  reviewedExternalImports: Set<string>;
  reviewedProcessDispatchers: Set<string>;
  reviewedNetworkDispatchers: Set<string>;
  observedExternalImports: Set<string>;
} {
  const closure = new Set<string>();
  const reviewedEdges = new Set<string>();
  const reviewedBoundaryEdges = new Set<string>();
  const reviewedExternalImports = new Set<string>();
  const reviewedProcessDispatchers = new Set<string>();
  const reviewedNetworkDispatchers = new Set<string>();
  const observedExternalImports = new Set<string>();
  const queue: string[] = [...entrypoints];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const specifier of runtimeRelativeImportsAtCandidateRoot(
      candidateRoot,
      current,
      reviewedProcessDispatchers,
      reviewedExternalImports,
      observedExternalImports,
      reviewedNetworkDispatchers
    )) {
      const resolved = resolveRepositoryImportAtCandidateRoot(candidateRoot, current, specifier);
      const edge = `${current} -> ${resolved}`;
      if (TCB_REVIEWED_BOUNDARY_EDGES.has(edge)) {
        reviewedBoundaryEdges.add(edge);
        continue;
      }
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
    reviewedBoundaryEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
    reviewedNetworkDispatchers,
    observedExternalImports
  };
}

// ---------------------------------------------------------------------------
// TCB closure lock types
// ---------------------------------------------------------------------------

export interface TcbClosureLockInput {
  readonly closure: Set<string>;
  readonly reviewedEdges: Set<string>;
  readonly reviewedBoundaryEdges: Set<string>;
  readonly reviewedExternalImports: Set<string>;
  readonly reviewedProcessDispatchers: Set<string>;
  readonly reviewedNetworkDispatchers?: Set<string>;
}

export interface TcbClosureCandidateRootOptions {
  readonly candidateRoot?: string;
  readonly candidateSnapshot?: TcbClosureCandidateSnapshot;
}

export type TcbClosureCandidateRootInput = TcbClosureCandidateRootOptions | string;

export interface TcbClosureCandidateSnapshot {
  readonly root: string;
}

type TcbClosureCandidateFileObservation = Readonly<{
  kind: 'missing';
  repositoryPath: string;
  absolutePath: string;
}> | Readonly<{
  kind: 'file';
  repositoryPath: string;
  absolutePath: string;
  physicalPath: string;
  device: number;
  inode: number;
  linkCount: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  bytes: Uint8Array;
}>;

type TcbClosureCandidateRootReader = TcbClosureCandidateSnapshot & {
  root: string;
  device: number;
  inode: number;
  observations: Map<string, TcbClosureCandidateFileObservation>;
  finalized: boolean;
};

const TCB_CANDIDATE_SNAPSHOT_SESSIONS = new WeakSet<object>();

function createTcbClosureCandidateRootReader(candidateRoot: string | undefined): TcbClosureCandidateRootReader {
  const requested = candidateRoot ?? compilerRoot;
  if (typeof requested !== 'string' || requested.length === 0 || !path.isAbsolute(requested)) {
    throw new Error('TCB candidate root must be one absolute canonical path.');
  }
  const resolved = path.resolve(requested);
  if (requested !== resolved) {
    throw new Error('TCB candidate root must be one absolute canonical path.');
  }
  let metadata: ReturnType<typeof lstatSync>;
  let physicalRoot: string;
  try {
    metadata = lstatSync(resolved);
    physicalRoot = realpathSync.native(resolved);
  } catch (error) {
    throw new Error('TCB candidate root is unavailable.', { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || physicalRoot !== resolved) {
    throw new Error('TCB candidate root must be one physical non-symlink canonical directory.');
  }
  const reader: TcbClosureCandidateRootReader = {
    root: resolved,
    device: metadata.dev,
    inode: metadata.ino,
    observations: new Map(),
    finalized: false
  };
  for (const property of ['root', 'device', 'inode', 'observations'] as const) {
    Object.defineProperty(reader, property, {
      configurable: false,
      enumerable: true,
      value: reader[property],
      writable: false
    });
  }
  Object.seal(reader);
  TCB_CANDIDATE_SNAPSHOT_SESSIONS.add(reader);
  return reader;
}

export function createTcbClosureCandidateSnapshot(
  options: Omit<TcbClosureCandidateRootOptions, 'candidateSnapshot'> = {}
): TcbClosureCandidateSnapshot {
  return createTcbClosureCandidateRootReader(options.candidateRoot);
}

function resolveTcbClosureCandidateRoot(
  options: TcbClosureCandidateRootOptions
): TcbClosureCandidateRootReader {
  if (options.candidateSnapshot !== undefined) {
    if (options.candidateRoot !== undefined) {
      throw new Error('TCB candidate root and candidate snapshot are mutually exclusive.');
    }
    const reader = options.candidateSnapshot as TcbClosureCandidateRootReader;
    if (!TCB_CANDIDATE_SNAPSHOT_SESSIONS.has(reader)) {
      throw new Error('TCB candidate snapshot is not an authentic local session.');
    }
    if (reader.finalized) {
      throw new Error('TCB candidate snapshot is already finalized.');
    }
    assertTcbClosureCandidateRootCurrent(reader);
    return reader;
  }
  return createTcbClosureCandidateRootReader(options.candidateRoot);
}

function normalizeTcbClosureCandidateRootInput(
  input: TcbClosureCandidateRootInput
): TcbClosureCandidateRootOptions {
  return typeof input === 'string' ? { candidateRoot: input } : input;
}

function assertTcbClosureCandidateRootCurrent(reader: TcbClosureCandidateRootReader): void {
  let metadata: ReturnType<typeof lstatSync>;
  let physicalRoot: string;
  try {
    metadata = lstatSync(reader.root);
    physicalRoot = realpathSync.native(reader.root);
  } catch (error) {
    throw new Error('TCB candidate root changed during the bounded read.', { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      metadata.dev !== reader.device || metadata.ino !== reader.inode ||
      physicalRoot !== reader.root) {
    throw new Error('TCB candidate root changed during the bounded read.');
  }
}

function candidateObservationBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));
}

function readTcbClosureCandidateOrdinaryFile(
  candidateRoot: TcbClosureCandidateRootReader,
  repositoryPath: string,
  absolutePath: string
): Exclude<TcbClosureCandidateFileObservation, { kind: 'missing' }> | null {
  let metadata: ReturnType<typeof lstatSync>;
  try {
    metadata = lstatSync(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`TCB candidate module metadata is unavailable: ${repositoryPath}.`, { cause: error });
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error(`TCB candidate module must be one physical single-link regular file: ${repositoryPath}.`);
  }
  let physicalPathBefore: string;
  try {
    physicalPathBefore = realpathSync.native(absolutePath);
  } catch (error) {
    throw new Error(`TCB candidate module realpath is unavailable: ${repositoryPath}.`, { cause: error });
  }
  if (physicalPathBefore !== absolutePath) {
    throw new Error(`TCB candidate module path is not canonical: ${repositoryPath}.`);
  }
  let descriptor: number | null = null;
  let bytes: Uint8Array;
  let descriptorBefore: ReturnType<typeof fstatSync>;
  let descriptorAfter: ReturnType<typeof fstatSync>;
  try {
    descriptor = openSync(
      absolutePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
    );
    descriptorBefore = fstatSync(descriptor);
    if (!descriptorBefore.isFile() || descriptorBefore.nlink !== 1 || metadata.nlink !== 1 ||
        descriptorBefore.nlink !== metadata.nlink || descriptorBefore.dev !== metadata.dev ||
        descriptorBefore.ino !== metadata.ino || descriptorBefore.size !== metadata.size ||
        descriptorBefore.mtimeMs !== metadata.mtimeMs || descriptorBefore.ctimeMs !== metadata.ctimeMs) {
      throw new Error(`TCB candidate module changed before its bounded read: ${repositoryPath}.`);
    }
    bytes = readFileSync(descriptor);
    descriptorAfter = fstatSync(descriptor);
  } catch (error) {
    throw new Error(`TCB candidate module bounded read failed: ${repositoryPath}.`, { cause: error });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  let metadataAfter: ReturnType<typeof lstatSync>;
  let physicalPathAfter: string;
  try {
    metadataAfter = lstatSync(absolutePath);
    physicalPathAfter = realpathSync.native(absolutePath);
  } catch (error) {
    throw new Error(`TCB candidate module changed after its bounded read: ${repositoryPath}.`, { cause: error });
  }
  if (!metadataAfter.isFile() || metadataAfter.isSymbolicLink() || metadataAfter.nlink !== 1 ||
      metadata.nlink !== 1 || descriptorBefore.nlink !== 1 || descriptorAfter.nlink !== 1 ||
      physicalPathAfter !== absolutePath ||
      metadataAfter.dev !== metadata.dev || metadataAfter.ino !== metadata.ino ||
      metadataAfter.nlink !== metadata.nlink || descriptorBefore.nlink !== metadata.nlink ||
      descriptorAfter.nlink !== descriptorBefore.nlink || descriptorAfter.nlink !== metadataAfter.nlink ||
      metadataAfter.size !== metadata.size || metadataAfter.mtimeMs !== metadata.mtimeMs ||
      metadataAfter.ctimeMs !== metadata.ctimeMs ||
      descriptorAfter.dev !== descriptorBefore.dev || descriptorAfter.ino !== descriptorBefore.ino ||
      descriptorAfter.size !== descriptorBefore.size || descriptorAfter.mtimeMs !== descriptorBefore.mtimeMs ||
      descriptorAfter.ctimeMs !== descriptorBefore.ctimeMs || bytes.byteLength !== descriptorAfter.size) {
    throw new Error(`TCB candidate module changed during its bounded read: ${repositoryPath}.`);
  }
  assertTcbClosureCandidateRootCurrent(candidateRoot);
  return {
    kind: 'file',
    repositoryPath,
    absolutePath,
    physicalPath: physicalPathAfter,
    device: metadataAfter.dev,
    inode: metadataAfter.ino,
    linkCount: metadataAfter.nlink,
    size: metadataAfter.size,
    mtimeMs: metadataAfter.mtimeMs,
    ctimeMs: metadataAfter.ctimeMs,
    bytes: Buffer.from(bytes)
  };
}

function assertTcbClosureCandidateObservationCurrent(
  candidateRoot: TcbClosureCandidateRootReader,
  observation: TcbClosureCandidateFileObservation
): void {
  if (observation.kind === 'missing') {
    try {
      lstatSync(observation.absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        assertTcbClosureCandidateRootCurrent(candidateRoot);
        return;
      }
      throw new Error(
        `TCB candidate missing-module observation cannot be revalidated: ${observation.repositoryPath}.`,
        { cause: error }
      );
    }
    throw new Error(`TCB candidate snapshot changed after observing a missing module: ${observation.repositoryPath}.`);
  }
  const current = readTcbClosureCandidateOrdinaryFile(
    candidateRoot,
    observation.repositoryPath,
    observation.absolutePath
  );
  if (current === null || current.physicalPath !== observation.physicalPath ||
      current.device !== observation.device || current.inode !== observation.inode ||
      current.linkCount !== observation.linkCount || observation.linkCount !== 1 ||
      current.size !== observation.size || current.mtimeMs !== observation.mtimeMs ||
      current.ctimeMs !== observation.ctimeMs ||
      !candidateObservationBytesEqual(current.bytes, observation.bytes)) {
    throw new Error(`TCB candidate snapshot changed after its first read: ${observation.repositoryPath}.`);
  }
}

function readTcbClosureCandidateModule(
  candidateRoot: TcbClosureCandidateRootReader,
  repositoryPath: string
): Uint8Array | null {
  if (!IsCanonicalRepositoryPath(repositoryPath)) {
    throw new Error(`TCB candidate module path is not canonical: ${repositoryPath}.`);
  }
  assertTcbClosureCandidateRootCurrent(candidateRoot);
  const absolutePath = path.resolve(candidateRoot.root, ...repositoryPath.split('/'));
  const relative = path.relative(candidateRoot.root, absolutePath);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`TCB candidate module escapes the canonical root: ${repositoryPath}.`);
  }
  const cached = candidateRoot.observations.get(repositoryPath);
  if (cached !== undefined) {
    assertTcbClosureCandidateObservationCurrent(candidateRoot, cached);
    return cached.kind === 'missing' ? null : Buffer.from(cached.bytes);
  }
  const observation = readTcbClosureCandidateOrdinaryFile(candidateRoot, repositoryPath, absolutePath);
  if (observation === null) {
    const missing: TcbClosureCandidateFileObservation = {
      kind: 'missing',
      repositoryPath,
      absolutePath
    };
    candidateRoot.observations.set(repositoryPath, missing);
    assertTcbClosureCandidateObservationCurrent(candidateRoot, missing);
    return null;
  }
  candidateRoot.observations.set(repositoryPath, observation);
  return Buffer.from(observation.bytes);
}

export function finalizeTcbClosureCandidateSnapshot(
  snapshot: TcbClosureCandidateSnapshot
): void {
  const candidateRoot = resolveTcbClosureCandidateRoot({ candidateSnapshot: snapshot });
  for (const repositoryPath of [...candidateRoot.observations.keys()].sort()) {
    assertTcbClosureCandidateObservationCurrent(
      candidateRoot,
      candidateRoot.observations.get(repositoryPath)!
    );
  }
  assertTcbClosureCandidateRootCurrent(candidateRoot);
  candidateRoot.finalized = true;
}

export function readTcbClosureCandidateFile(
  repositoryPath: string,
  options: TcbClosureCandidateRootOptions = {}
): Uint8Array {
  const bytes = readTcbClosureCandidateModule(
    resolveTcbClosureCandidateRoot(options),
    repositoryPath
  );
  if (bytes === null) {
    throw new Error(`TCB candidate module is missing: ${repositoryPath}.`);
  }
  return bytes;
}

export interface TcbClosureLock {
  readonly schema: 'sec-tcb-closure-lock-v2';
  readonly trustRevision: string;
  readonly moduleCount: number;
  readonly modules: readonly string[];
  readonly reviewedEdges: readonly string[];
  readonly reviewedBoundaryEdges: readonly string[];
  readonly reviewedExternalImports: readonly string[];
  readonly reviewedProcessDispatchers: readonly string[];
  /** Absent only when reading a canonical pre-network-projection archive region. */
  readonly reviewedNetworkDispatchers?: readonly string[];
  readonly moduleBlobs: Readonly<Record<string, string>>;
  readonly moduleContentDigests: Readonly<Record<string, string>>;
  readonly closureDigest: `sha256:${string}`;
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
  return gitBlobObjectId('sha1', bytes);
}

function computeContentDigest(bytes: Uint8Array): string {
  return `sha256:${rawSha256Hex(bytes)}`;
}

type TcbClosureLockIdentityMaterial = Omit<TcbClosureLock, 'trustRevision' | 'closureDigest'>;

function deriveTcbClosureTrustRevision(
  material: TcbClosureLockIdentityMaterial
): string {
  return `sha256:${rawSha256Hex(JSON.stringify(material))}`;
}

function computeClosureDigest(
  lock: Omit<TcbClosureLock, 'closureDigest'>
): `sha256:${string}` {
  const canonical = JSON.stringify({
    schema: lock.schema,
    trustRevision: lock.trustRevision,
    moduleCount: lock.moduleCount,
    modules: lock.modules,
    reviewedEdges: lock.reviewedEdges,
    reviewedBoundaryEdges: lock.reviewedBoundaryEdges,
    reviewedExternalImports: lock.reviewedExternalImports,
    reviewedProcessDispatchers: lock.reviewedProcessDispatchers,
    ...(lock.reviewedNetworkDispatchers === undefined
      ? {}
      : { reviewedNetworkDispatchers: lock.reviewedNetworkDispatchers }),
    moduleBlobs: lock.moduleBlobs,
    moduleContentDigests: lock.moduleContentDigests
  });
  return `sha256:${rawSha256Hex(canonical)}`;
}

// ---------------------------------------------------------------------------
// Lock computation and verification
// ---------------------------------------------------------------------------

export function computeTcbClosureLock(
  input: TcbClosureLockInput,
  candidateRoot: TcbClosureCandidateRootInput = {}
): TcbClosureLock {
  return computeTcbClosureLockAtCandidateRoot(
    resolveTcbClosureCandidateRoot(normalizeTcbClosureCandidateRootInput(candidateRoot)),
    input
  );
}

function computeTcbClosureLockAtCandidateRoot(
  candidateRoot: TcbClosureCandidateRootReader,
  input: TcbClosureLockInput
): TcbClosureLock {
  const modules = [...input.closure].sort();
  const moduleBlobs: Record<string, string> = {};
  const moduleContentDigests: Record<string, string> = {};
  for (const modulePath of modules) {
    const bytes = readTcbClosureCandidateModule(candidateRoot, modulePath);
    if (bytes === null) {
      throw new Error(`TCB closure module is missing or unreadable: ${modulePath}.`);
    }
    const normalized = normalizeTextBytes(bytes);
    moduleBlobs[modulePath] = computeGitBlobSha(normalized);
    moduleContentDigests[modulePath] = computeContentDigest(normalized);
  }
  const reviewedEdges = [...input.reviewedEdges].sort();
  const reviewedBoundaryEdges = [...input.reviewedBoundaryEdges].sort();
  const reviewedExternalImports = [...input.reviewedExternalImports].sort();
  const reviewedProcessDispatchers = [...input.reviewedProcessDispatchers].sort();
  const reviewedNetworkDispatchers = [...(input.reviewedNetworkDispatchers ?? [])].sort();
  const identityMaterial: TcbClosureLockIdentityMaterial = {
    schema: 'sec-tcb-closure-lock-v2' as const,
    moduleCount: modules.length,
    modules,
    reviewedEdges,
    reviewedBoundaryEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
    reviewedNetworkDispatchers,
    moduleBlobs,
    moduleContentDigests
  };
  const trustRevision = deriveTcbClosureTrustRevision(identityMaterial);
  const partial = {
    schema: identityMaterial.schema,
    trustRevision,
    moduleCount: identityMaterial.moduleCount,
    modules: identityMaterial.modules,
    reviewedEdges: identityMaterial.reviewedEdges,
    reviewedBoundaryEdges: identityMaterial.reviewedBoundaryEdges,
    reviewedExternalImports: identityMaterial.reviewedExternalImports,
    reviewedProcessDispatchers: identityMaterial.reviewedProcessDispatchers,
    reviewedNetworkDispatchers: identityMaterial.reviewedNetworkDispatchers,
    moduleBlobs: identityMaterial.moduleBlobs,
    moduleContentDigests: identityMaterial.moduleContentDigests
  };
  return { ...partial, closureDigest: computeClosureDigest(partial) };
}

export function verifyTcbClosureLock(
  input: TcbClosureLockInput,
  options: TcbClosureCandidateRootOptions & Readonly<{
    expectedIdentity?: TcbClosureLock;
  }> = {}
): TcbClosureLockVerification {
  const expected = options.expectedIdentity ?? generateTcbClosureLock(options);
  const failures: string[] = [];
  const expectedModules = new Set(expected.modules);
  const actualModules = new Set(input.closure);

  if (actualModules.size !== expected.moduleCount) {
    failures.push(`module count: expected ${expected.moduleCount}, actual ${actualModules.size}`);
  }

  for (const modulePath of actualModules) {
    if (!expectedModules.has(modulePath)) {
      failures.push(`expansion: unexpected module ${modulePath}`);
    }
  }
  for (const modulePath of expectedModules) {
    if (!actualModules.has(modulePath)) {
      failures.push(`contraction: missing module ${modulePath}`);
    }
  }

  const expectedEdges = new Set(expected.reviewedEdges);
  const actualEdges = new Set(input.reviewedEdges);
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

  const expectedBoundaryEdges = new Set(expected.reviewedBoundaryEdges);
  const actualBoundaryEdges = new Set(input.reviewedBoundaryEdges);
  for (const edge of actualBoundaryEdges) {
    if (!expectedBoundaryEdges.has(edge)) {
      failures.push(`boundary edge addition: unexpected edge ${edge}`);
    }
  }
  for (const edge of expectedBoundaryEdges) {
    if (!actualBoundaryEdges.has(edge)) {
      failures.push(`boundary edge removal: missing edge ${edge}`);
    }
  }

  const expectedExternalImports = new Set(expected.reviewedExternalImports);
  const actualExternalImports = new Set(input.reviewedExternalImports);
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
  const actualDispatchers = new Set(input.reviewedProcessDispatchers);
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

  const expectedNetworkDispatchers = new Set(expected.reviewedNetworkDispatchers ?? []);
  const actualNetworkDispatchers = new Set(input.reviewedNetworkDispatchers ?? []);
  for (const entry of actualNetworkDispatchers) {
    if (!expectedNetworkDispatchers.has(entry)) {
      failures.push(`network dispatcher addition: unexpected ${entry}`);
    }
  }
  for (const entry of expectedNetworkDispatchers) {
    if (!actualNetworkDispatchers.has(entry)) {
      failures.push(`network dispatcher removal: missing ${entry}`);
    }
  }

  if (failures.length > 0) {
    return { status: 'failed', failures };
  }

  let actual: TcbClosureLock;
  try {
    actual = computeTcbClosureLock(input, options);
  } catch (error) {
    return {
      status: 'failed',
      failures: [
        `computation failed: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }

  for (const modulePath of expected.modules) {
    if (actual.moduleBlobs[modulePath] !== expected.moduleBlobs[modulePath]) {
      failures.push(`substitution: blob mismatch for ${modulePath}`);
    }
    if (actual.moduleContentDigests[modulePath] !== expected.moduleContentDigests[modulePath]) {
      failures.push(`substitution: content digest mismatch for ${modulePath}`);
    }
  }

  if (actual.closureDigest !== expected.closureDigest) {
    failures.push(`closure digest: expected ${expected.closureDigest}, actual ${actual.closureDigest}`);
  }

  return { status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export function generateTcbClosureLock(
  options: TcbClosureCandidateRootOptions = {}
): TcbClosureLock {
  const candidateRoot = resolveTcbClosureCandidateRoot(options);
  const closure = trustedRuntimeClosureAtCandidateRoot(candidateRoot, TCB_RUNTIME_ENTRYPOINTS);
  const authorizedProcessDispatchers = [...TCB_REVIEWED_PROCESS_DISPATCHERS].sort();
  const observedProcessDispatchers = [...closure.reviewedProcessDispatchers].sort();
  if (JSON.stringify(authorizedProcessDispatchers) !== JSON.stringify(observedProcessDispatchers)) {
    throw new Error(
      'TCB reviewed process dispatcher allowlist must exactly equal the live causal dispatcher census.'
    );
  }
  const authorizedNetworkDispatchers = [...TCB_REVIEWED_NETWORK_DISPATCHERS].sort();
  const observedNetworkDispatchers = [...closure.reviewedNetworkDispatchers].sort();
  if (JSON.stringify(authorizedNetworkDispatchers) !== JSON.stringify(observedNetworkDispatchers)) {
    throw new Error(
      'TCB reviewed network dispatcher allowlist must exactly equal the live causal dispatcher census.'
    );
  }
  const lock = computeTcbClosureLockAtCandidateRoot(candidateRoot, closure);
  createTrustedBootstrapTrustRoot({
    registry: TRUSTED_BOOTSTRAP_REGISTRY,
    causalRuntimePaths: lock.modules
  });
  return lock;
}

// ---------------------------------------------------------------------------
// Exact-tree-derived identity
// ---------------------------------------------------------------------------

/**
 * Compile one TCB identity from the supplied immutable candidate snapshot.
 *
 * The identity is a projection of canonical policy plus exact Git-tree bytes;
 * it is never stored as a second tracked source of truth. Verification Actions
 * already bind and reuse this result through their exact-tree ActionKey.
 */
export function compileTcbClosureIdentity(
  options: TcbClosureCandidateRootOptions = {}
): TcbClosureLock {
  return generateTcbClosureLock(options);
}

const TCB_CLOSURE_ACTION_RESULT_SCHEMA =
  'sec-tcb-closure-action-result-v1' as const;
const TCB_CLOSURE_ACTION_PRODUCER_REVISION =
  'sec-tcb-closure-action-producer-v1' as const;

export interface TcbClosureActionResult {
  readonly schema: typeof TCB_CLOSURE_ACTION_RESULT_SCHEMA;
  readonly actionKey: `sha256:${string}`;
  readonly identity: TcbClosureLock;
  /** Pure compiler output. Effect executors must project it through their own settlement owner. */
  readonly resultDigest: `sha256:${string}`;
}

export interface TcbClosureCandidateActionDemand {
  readonly impactedPaths: readonly string[];
  readonly plan: VerificationActionPlan | null;
}

function assertTcbActionDigest(value: string, label: string): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be one SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function assertTcbActionTree(value: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error('TCB closure Action exact tree must be one lowercase Git object ID.');
  }
  return value;
}

/**
 * Build the reusable Action identity without compiling the closure. The exact
 * tree is the immutable input boundary; Impact decides whether this Action is
 * required before any closure compilation occurs.
 */
export function createTcbClosureActionPlan(input: Readonly<{
  exactTreeSha: string;
  registryDigest: `sha256:${string}`;
  toolchainRevision: string;
  providerRevision: string;
  upstreamActionKeys?: readonly `sha256:${string}`[];
}>): VerificationActionPlan {
  const exactTreeSha = assertTcbActionTree(input.exactTreeSha);
  const registryDigest = assertTcbActionDigest(input.registryDigest, 'TCB closure Action registry digest');
  const toolchainRevision = input.toolchainRevision.trim();
  const providerRevision = input.providerRevision.trim();
  if (toolchainRevision.length === 0 || providerRevision.length === 0) {
    throw new Error('TCB closure Action toolchain and provider revisions must be non-empty.');
  }
  const upstreamActionKeys = [...new Set(input.upstreamActionKeys ?? [])]
    .map((value) => assertTcbActionDigest(value, 'TCB closure upstream ActionKey'))
    .sort();
  const semanticDigest = assertTcbActionDigest(
    computeContentDigest(Buffer.from(JSON.stringify({
      schema: TCB_CLOSURE_ACTION_PRODUCER_REVISION,
      exactTreeSha,
      registryDigest
    }), 'utf8')),
    'TCB closure Action semantic digest'
  );
  const action = createVerificationActionKey({
    actionKind: 'tcb-closure-identity',
    producer: {
      identity: 'src/adapters/verification/platform/trust/runtime/closure-lock.ts',
      revision: TCB_CLOSURE_ACTION_PRODUCER_REVISION
    },
    operation: {
      identity: 'compile-exact-tree-tcb-closure',
      revision: TCB_CLOSURE_ACTION_PRODUCER_REVISION,
      semanticDigest,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure: [{
      path: TRUSTED_BOOTSTRAP_REGISTRY_PATH,
      digest: registryDigest
    }],
    environment: {
      toolchainRevision,
      providerRevision,
      contractRevision: TCB_CLOSURE_ACTION_PRODUCER_REVISION
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys,
    resultSchemaRevision: TCB_CLOSURE_ACTION_RESULT_SCHEMA
  });
  return createVerificationActionPlan({
    action,
    executionClass: 'cheap-preflight',
    dependencies: upstreamActionKeys.map((actionKey) => ({ actionKey, kind: 'upstream' }))
  });
}

/**
 * Compile candidate demand from trusted-base policy and the exact changed-path
 * inventory. A null plan is the canonical zero-work result; callers cannot
 * manufacture candidate compilation merely by invoking a workflow or CLI.
 */
export function selectTcbClosureCandidateAction(input: Readonly<{
  changedPaths: readonly string[];
  exactTreeSha: string;
  registryDigest: `sha256:${string}`;
  toolchainRevision: string;
  providerRevision: string;
  trustedRegistry: TrustedBootstrapRegistry;
  checkerResult: TcbClosureActionResult;
}>): TcbClosureCandidateActionDemand {
  if (input.checkerResult.resultDigest !== input.checkerResult.identity.closureDigest) {
    throw new Error('TCB candidate Action selection requires one valid trusted-base checker result.');
  }
  const changedPaths = [...new Set(input.changedPaths)].sort();
  if (changedPaths.length !== input.changedPaths.length || changedPaths.some((repositoryPath) =>
    !IsCanonicalRepositoryPath(repositoryPath))) {
    throw new Error('TCB candidate Action selection requires unique canonical changed paths.');
  }
  const trustRoot = createTrustedBootstrapTrustRoot({
    registry: input.trustedRegistry,
    causalRuntimePaths: input.checkerResult.identity.modules
  });
  const impactedPaths = changedPaths.filter((repositoryPath) =>
    matchTrustedBootstrapPath(repositoryPath, trustRoot) !== null
  );
  return Object.freeze({
    impactedPaths: Object.freeze(impactedPaths),
    plan: impactedPaths.length === 0 ? null : createTcbClosureActionPlan({
      exactTreeSha: input.exactTreeSha,
      registryDigest: input.registryDigest,
      toolchainRevision: input.toolchainRevision,
      providerRevision: input.providerRevision,
      upstreamActionKeys: [input.checkerResult.actionKey]
    })
  });
}

/** Execute one already-keyed TCB Action and publish its typed terminal result. */
export function compileTcbClosureActionResult(input: Readonly<{
  plan: VerificationActionPlan;
  options?: TcbClosureCandidateRootOptions;
  upstreamResults?: readonly TcbClosureActionResult[];
}>): TcbClosureActionResult {
  if (input.plan.action.actionKind !== 'tcb-closure-identity' ||
      input.plan.action.resultSchemaRevision !== TCB_CLOSURE_ACTION_RESULT_SCHEMA ||
      input.plan.dependencies.some((dependency) => dependency.kind !== 'upstream')) {
    throw new Error('TCB closure Action plan is not one canonical derivation plan.');
  }
  const requiredUpstream = input.plan.dependencies.map((dependency) => dependency.actionKey).sort();
  const suppliedUpstream = [...(input.upstreamResults ?? [])]
    .map((result) => {
      if (result.resultDigest !== result.identity.closureDigest) {
        throw new Error('TCB closure Action upstream compiler result is not canonical.');
      }
      return result.actionKey;
    })
    .sort();
  if (JSON.stringify(requiredUpstream) !== JSON.stringify(suppliedUpstream)) {
    throw new Error('TCB closure Action upstream results do not satisfy its exact dependency closure.');
  }
  const identity = compileTcbClosureIdentity(input.options ?? {});
  const resultDigest = assertTcbActionDigest(identity.closureDigest, 'TCB closure Action result digest');
  return Object.freeze({
    schema: TCB_CLOSURE_ACTION_RESULT_SCHEMA,
    actionKey: input.plan.action.actionKey,
    identity,
    resultDigest
  });
}

let processTcbClosureIdentity: TcbClosureLock | null = null;
let processTcbTrustRoot: TrustedBootstrapTrustRoot | null = null;

function resolveProcessTcbClosureIdentity(): TcbClosureLock {
  processTcbClosureIdentity ??= compileTcbClosureIdentity();
  return processTcbClosureIdentity;
}

function resolveTcbTrustRoot(): TrustedBootstrapTrustRoot {
  processTcbTrustRoot ??= createTrustedBootstrapTrustRoot({
    registry: TRUSTED_BOOTSTRAP_REGISTRY,
    causalRuntimePaths: resolveProcessTcbClosureIdentity().modules
  });
  return processTcbTrustRoot;
}

/**
 * Lazily derived process view. The process is bound to one exact trusted tree;
 * candidate trees use compileTcbClosureIdentity with an immutable reader.
 */
export const TCB_TRUST_ROOT: TrustedBootstrapTrustRoot = Object.freeze({
  get schema() { return resolveTcbTrustRoot().schema; },
  get registry() { return resolveTcbTrustRoot().registry; },
  get causalRuntimePaths() { return resolveTcbTrustRoot().causalRuntimePaths; },
  get paths() { return resolveTcbTrustRoot().paths; },
  get prefixes() { return resolveTcbTrustRoot().prefixes; }
});
