/**
 * sec-tcb-closure-lock — generated exact TCB closure lock.
 *
 * This module is the single canonical source for the trusted-runtime closure
 * builder, the frozen TCB closure lock identity, and the lock verifier.
 *
 * The lock binds the exact reviewed modules, their edges, Git blob SHA-1s,
 * raw content SHA-256 digests, reviewed SUT and static-exact boundary edges,
 * reviewed external imports, reviewed process dispatchers, and the single
 * trust revision.  The lock is generated from
 * the trusted-runtime closure logic — it is not hand-maintained.
 *
 * The verifier runtime import closure test asserts against the generated lock
 * identity instead of a hard-coded module count.  Any unauthorized expansion,
 * contraction, substitution, or edge addition causes the lock to break.
 * A reviewed boundary terminates traversal at a separately verified
 * static-exact trust-root blob, so the runtime can import this lock without
 * creating a self-hash/module-loader cycle.
 */

import { createHash } from 'node:crypto';
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

import { compilerRoot } from './paths.ts';
import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';
import {
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3,
  createSecTrustedBootstrapTrustRootV3,
  matchSecTrustedBootstrapPathV3,
  type SecTrustedBootstrapTrustRootV3
} from './tcb-trust-root-contract.ts';

// ---------------------------------------------------------------------------
// TCB closure constants (canonical source — moved from sec-merge-gate.test.ts)
// ---------------------------------------------------------------------------

export const TCB_RUNTIME_ENTRYPOINTS = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3.runtimeEntrypoints;

export const TCB_REVIEWED_SUT_EDGES = new Set(
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3.reviewedSutEdges
);

export const TCB_REVIEWED_BOUNDARY_EDGES = new Set(
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3.reviewedBoundaryEdges
);

export const TCB_REVIEWED_EXTERNAL_IMPORTS = new Set([
  'platform/dev-runner/env-manager.ts -> node:net',
  'platform/shared/heavy-verification-gate-lease.ts -> bun:ffi',
  'platform/shared/physical-no-follow.ts -> bun:ffi',
  'platform/shared/process.ts -> node:string_decoder',
  'platform/shared/windows-host-filesystem-authority.ts -> bun:ffi',
  'scripts/ci-verification.ts -> bun:ffi'
]);

export const TCB_APPROVED_EXTERNAL_IMPORTS = new Set([
  'globby',
  'lodash-es',
  'node:async_hooks',
  'node:crypto',
  'node:fs',
  'node:fs/promises',
  'node:os',
  'node:path',
  'node:url',
  'node:util',
  'node:util/types',
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
  'platform/dev-runner/verification-action-executor.ts::function-declaration:executeVerifiedCiActionPlanV1::Bun.spawn#1',
  'platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
  'platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1',
  'platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
  'scripts/ci-verification.ts::function-declaration:inspectHostedActionArchiveMetadataV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultHostedSutSandboxProcessV1::spawn#1',
  'scripts/ci-verification.ts::function-declaration:gitCandidateBytesV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:hostedActionGhReadJsonV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:runHostedMaterializerCommandV2::spawnSync#1',
  'scripts/codex/agent-operation-activation.ts::function-declaration:command::spawnSync#1',
  'scripts/codex/branch-closeout-receipt.ts::function-declaration:runCloseoutObservationGh::spawnSync#1',
  'scripts/codex/branch-closeout.ts::function-declaration:runCloseoutGit::spawnSync#1',
  'scripts/codex/branch-lifecycle-inventory.ts::function-declaration:runInventoryCommand::spawnSync#1',
  'scripts/codex/branch-recovery.ts::function-declaration:runRecoveryGit::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1',
  'scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1',
  'scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1',
  'scripts/codex/issue-disposition-github.ts::function-declaration:gh::spawnSync#1',
  'scripts/codex/local-github-actions-runner.ts::function-declaration:runCommand::spawn#1',
  'scripts/codex/skill-applicability.ts::function-declaration:gitOutput::spawnSync#1',
  'scripts/codex/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeupV2::spawnSync#1',
  'scripts/codex/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1',
  'scripts/codex/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1',
  'scripts/codex/verification-session-github.ts::function-declaration:runVerificationSessionGh::spawnSync#1',
  'scripts/codex/verification-session.ts::function-declaration:runVerificationSessionCommand::spawnSync#1',
  'scripts/codex/work-selection.ts::function-declaration:runDefault::spawnSync#1',
  'scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#2',
  'docs/scripts/docs-doctor.ts::function-declaration:readCapturedGitTreeBlob::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1'
]);

export const TCB_REVIEWED_NETWORK_DISPATCHERS = new Set([
  'scripts/codex/integration-authorization-status-github.ts::function-declaration:dispatchGitHubApiRequestV1::globalThis.fetch#1'
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
  'once',
  'pid',
  'ppid',
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
  observedExternalImports: Set<string> = new Set(),
  reviewedNetworkDispatchers: Set<string> = new Set()
): string[] {
  const sourceFile = ts.createSourceFile(repositoryPath, source, ts.ScriptTarget.Latest, true);
  let lexicalChecker: ts.TypeChecker | undefined;
  const isLocallyBoundIdentifier = (identifier: ts.Identifier): boolean => {
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
    return lexicalChecker.getSymbolAtLocation(identifier) !== undefined;
  };
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
  observedExternalImports: Set<string> = new Set(),
  reviewedNetworkDispatchers: Set<string> = new Set(),
  options: TcbClosureCandidateRootOptions = {}
): string[] {
  const candidateRoot = resolveTcbClosureCandidateRoot(options);
  return runtimeRelativeImportsAtCandidateRoot(
    candidateRoot,
    repositoryPath,
    reviewedProcessDispatchers,
    reviewedExternalImports,
    observedExternalImports,
    reviewedNetworkDispatchers
  );
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

export function resolveRepositoryImport(
  from: string,
  specifier: string,
  options: TcbClosureCandidateRootOptions = {}
): string {
  return resolveRepositoryImportAtCandidateRoot(
    resolveTcbClosureCandidateRoot(options),
    from,
    specifier
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

export function matchesCanonicalTrustRoot(repositoryPath: string): boolean {
  return matchSecTrustedBootstrapPathV3(repositoryPath, TCB_TRUST_ROOT_V3) !== null;
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
  readonly candidateSnapshot?: TcbClosureCandidateSnapshotV1;
}

export type TcbClosureCandidateRootInput = TcbClosureCandidateRootOptions | string;

export interface TcbClosureCandidateSnapshotV1 {
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

type TcbClosureCandidateRootReader = TcbClosureCandidateSnapshotV1 & {
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

export function createTcbClosureCandidateSnapshotV1(
  options: Omit<TcbClosureCandidateRootOptions, 'candidateSnapshot'> = {}
): TcbClosureCandidateSnapshotV1 {
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
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(repositoryPath)) {
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

export function finalizeTcbClosureCandidateSnapshotV1(
  snapshot: TcbClosureCandidateSnapshotV1
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

export function readTcbClosureCandidateFileV1(
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
  readonly closureDigest: string;
}

export interface TcbClosureLockVerification {
  readonly status: 'passed' | 'failed';
  readonly failures: readonly string[];
}

export interface TcbClosureLockReceiptV2 {
  readonly schema: 'sec-tcb-closure-lock-receipt-v2';
  readonly trustRevision: string;
  readonly moduleCount: number;
  readonly reviewedBoundaryEdgeCount: number;
  readonly closureDigest: string;
  readonly generatedAt: string;
  readonly generatedBy: 'tcb-closure-maintainer';
}

export interface TcbClosureGeneratedRegionV2 {
  readonly lock: TcbClosureLock;
  readonly receipt: TcbClosureLockReceiptV2;
  readonly regionStart: number;
  readonly regionEnd: number;
  readonly rawRegion: string;
}

export interface TcbClosureLockSourcePlanV2 {
  readonly schema: 'sec-tcb-closure-lock-source-plan-v2';
  readonly status: 'current' | 'update-required';
  readonly currentLock: TcbClosureLock;
  readonly nextLock: TcbClosureLock;
  readonly currentGeneratedAt: string;
  readonly nextGeneratedAt: string;
  readonly oldRawSourceDigest: string;
  readonly nextRawSourceDigest: string;
  readonly nextSource: string;
}

const TCB_CLOSURE_GENERATED_REGION_BEGIN_V2 = [
  '// <sec-tcb-closure-lock',
  'generated-v2>'
].join('-');

const TCB_CLOSURE_GENERATED_REGION_END_V2 = [
  '// </sec-tcb-closure-lock',
  'generated-v2>'
].join('-');

function assertCanonicalGeneratedAtV2(generatedAt: string): void {
  if (!Number.isFinite(Date.parse(generatedAt)) || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new Error('TCB closure lock receipt generatedAt must be canonical ISO-8601 UTC.');
  }
}

export function createTcbClosureLockReceiptV2(
  lock: TcbClosureLock,
  generatedAt: string
): TcbClosureLockReceiptV2 {
  assertCanonicalGeneratedAtV2(generatedAt);
  return Object.freeze({
    schema: 'sec-tcb-closure-lock-receipt-v2',
    trustRevision: lock.trustRevision,
    moduleCount: lock.moduleCount,
    reviewedBoundaryEdgeCount: lock.reviewedBoundaryEdges.length,
    closureDigest: lock.closureDigest,
    generatedAt,
    generatedBy: 'tcb-closure-maintainer'
  });
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

export type TcbClosureLockIdentityMaterialV2 = Omit<TcbClosureLock, 'trustRevision' | 'closureDigest'>;

export function deriveTcbClosureTrustRevisionV2(
  material: TcbClosureLockIdentityMaterialV2
): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(material)).digest('hex')}`;
}

function computeClosureDigest(lock: Omit<TcbClosureLock, 'closureDigest'>): string {
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
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
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
  for (const module of modules) {
    const bytes = readTcbClosureCandidateModule(candidateRoot, module);
    if (bytes === null) {
      throw new Error(`TCB closure module is missing or unreadable: ${module}.`);
    }
    const normalized = normalizeTextBytes(bytes);
    moduleBlobs[module] = computeGitBlobSha(normalized);
    moduleContentDigests[module] = computeContentDigest(normalized);
  }
  const reviewedEdges = [...input.reviewedEdges].sort();
  const reviewedBoundaryEdges = [...input.reviewedBoundaryEdges].sort();
  const reviewedExternalImports = [...input.reviewedExternalImports].sort();
  const reviewedProcessDispatchers = [...input.reviewedProcessDispatchers].sort();
  const reviewedNetworkDispatchers = [...(input.reviewedNetworkDispatchers ?? [])].sort();
  const identityMaterial: TcbClosureLockIdentityMaterialV2 = {
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
  const trustRevision = deriveTcbClosureTrustRevisionV2(identityMaterial);
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
  options: TcbClosureCandidateRootOptions = {}
): TcbClosureLockVerification {
  const expected = TCB_CLOSURE_LOCK;
  const failures: string[] = [];
  const expectedModules = new Set(expected.modules);
  const actualModules = new Set(input.closure);

  if (actualModules.size !== expected.moduleCount) {
    failures.push(`module count: expected ${expected.moduleCount}, actual ${actualModules.size}`);
  }

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

  for (const module of expected.modules) {
    if (actual.moduleBlobs[module] !== expected.moduleBlobs[module]) {
      failures.push(`substitution: blob mismatch for ${module}`);
    }
    if (actual.moduleContentDigests[module] !== expected.moduleContentDigests[module]) {
      failures.push(`substitution: content digest mismatch for ${module}`);
    }
  }

  if (actual.closureDigest !== expected.closureDigest) {
    failures.push(`closure digest: expected ${expected.closureDigest}, actual ${actual.closureDigest}`);
  }

  return { status: failures.length === 0 ? 'passed' : 'failed', failures };
}

function assertGeneratedPlainObjectV2(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) throw new Error(`${label} must be one plain object.`);
}

function assertGeneratedExactKeysV2(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((entry, index) => entry !== sortedExpected[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

function generatedStringArrayV2(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 4_096 || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a bounded string array.`);
  }
  const result = [...value] as string[];
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1]! >= result[index]!) {
      throw new Error(`${label} must be strictly code-unit sorted and unique.`);
    }
  }
  return result;
}

function parseTcbClosureLockValueV2(value: unknown): TcbClosureLock {
  assertGeneratedPlainObjectV2(value, 'TCB closure generated lock');
  const hasNetworkProjection = Object.hasOwn(value, 'reviewedNetworkDispatchers');
  const commonKeys = [
    'schema',
    'trustRevision',
    'moduleCount',
    'modules',
    'reviewedEdges',
    'reviewedBoundaryEdges',
    'reviewedExternalImports',
    'reviewedProcessDispatchers',
  ];
  assertGeneratedExactKeysV2(value, [
    ...commonKeys,
    ...(hasNetworkProjection ? ['reviewedNetworkDispatchers'] : []),
    'moduleBlobs',
    'moduleContentDigests',
    'closureDigest'
  ], 'TCB closure generated lock');
  if (value.schema !== 'sec-tcb-closure-lock-v2') {
    throw new Error('TCB closure generated lock schema mismatch.');
  }
  if (!Number.isSafeInteger(value.moduleCount) || (value.moduleCount as number) < 1) {
    throw new Error('TCB closure generated lock moduleCount must be a positive safe integer.');
  }
  const modules = generatedStringArrayV2(value.modules, 'TCB closure generated modules');
  const reviewedEdges = generatedStringArrayV2(value.reviewedEdges, 'TCB closure generated reviewedEdges');
  const reviewedBoundaryEdges = generatedStringArrayV2(
    value.reviewedBoundaryEdges,
    'TCB closure generated reviewedBoundaryEdges'
  );
  const reviewedExternalImports = generatedStringArrayV2(
    value.reviewedExternalImports,
    'TCB closure generated reviewedExternalImports'
  );
  const reviewedProcessDispatchers = generatedStringArrayV2(
    value.reviewedProcessDispatchers,
    'TCB closure generated reviewedProcessDispatchers'
  );
  const reviewedNetworkDispatchers = hasNetworkProjection
    ? generatedStringArrayV2(
      value.reviewedNetworkDispatchers,
      'TCB closure generated reviewedNetworkDispatchers'
    )
    : undefined;
  if (value.moduleCount !== modules.length) {
    throw new Error('TCB closure generated lock moduleCount does not match modules.');
  }
  assertGeneratedPlainObjectV2(value.moduleBlobs, 'TCB closure generated moduleBlobs');
  assertGeneratedPlainObjectV2(value.moduleContentDigests, 'TCB closure generated moduleContentDigests');
  const blobKeys = Object.keys(value.moduleBlobs);
  const digestKeys = Object.keys(value.moduleContentDigests);
  if (
    blobKeys.length !== modules.length
    || digestKeys.length !== modules.length
    || blobKeys.some((entry, index) => entry !== modules[index])
    || digestKeys.some((entry, index) => entry !== modules[index])
  ) throw new Error('TCB closure generated module identity maps must exactly follow modules.');
  const moduleBlobs: Record<string, string> = {};
  const moduleContentDigests: Record<string, string> = {};
  for (const module of modules) {
    const blob = value.moduleBlobs[module];
    const digest = value.moduleContentDigests[module];
    if (typeof blob !== 'string' || !/^[0-9a-f]{40}$/u.test(blob)) {
      throw new Error(`TCB closure generated lock has an invalid or missing blob sentinel for ${module}.`);
    }
    if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(digest)) {
      throw new Error(`TCB closure generated lock has an invalid or missing content sentinel for ${module}.`);
    }
    moduleBlobs[module] = blob;
    moduleContentDigests[module] = digest;
  }
  if (typeof value.trustRevision !== 'string') {
    throw new Error('TCB closure generated trustRevision must be text.');
  }
  const identityMaterial: TcbClosureLockIdentityMaterialV2 = {
    schema: 'sec-tcb-closure-lock-v2',
    moduleCount: modules.length,
    modules,
    reviewedEdges,
    reviewedBoundaryEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
    ...(reviewedNetworkDispatchers === undefined ? {} : { reviewedNetworkDispatchers }),
    moduleBlobs,
    moduleContentDigests
  };
  const derivedTrustRevision = deriveTcbClosureTrustRevisionV2(identityMaterial);
  if (value.trustRevision !== derivedTrustRevision) {
    throw new Error('TCB closure generated trustRevision is not derived from the exact closure material.');
  }
  const partial = {
    schema: identityMaterial.schema,
    trustRevision: value.trustRevision,
    moduleCount: identityMaterial.moduleCount,
    modules: identityMaterial.modules,
    reviewedEdges: identityMaterial.reviewedEdges,
    reviewedBoundaryEdges: identityMaterial.reviewedBoundaryEdges,
    reviewedExternalImports: identityMaterial.reviewedExternalImports,
    reviewedProcessDispatchers: identityMaterial.reviewedProcessDispatchers,
    ...(identityMaterial.reviewedNetworkDispatchers === undefined
      ? {}
      : { reviewedNetworkDispatchers: identityMaterial.reviewedNetworkDispatchers }),
    moduleBlobs: identityMaterial.moduleBlobs,
    moduleContentDigests: identityMaterial.moduleContentDigests
  };
  const closureDigest = computeClosureDigest(partial);
  if (value.closureDigest !== closureDigest) {
    throw new Error('TCB closure generated closureDigest does not match the exact lock material.');
  }
  return Object.freeze({ ...partial, closureDigest });
}

function renderTcbClosureGeneratedRegionInternalV2(
  lock: TcbClosureLock,
  generatedAt: string
): string {
  const parsedLock = parseTcbClosureLockValueV2(lock);
  assertCanonicalGeneratedAtV2(generatedAt);
  return [
    TCB_CLOSURE_GENERATED_REGION_BEGIN_V2,
    `export const TCB_CLOSURE_TRUST_REVISION = ${JSON.stringify(parsedLock.trustRevision)};`,
    '',
    '// Generated from the exact live causal closure. Do not hand-edit this marked region.',
    'export const TCB_CLOSURE_LOCK: TcbClosureLock = ' + JSON.stringify(parsedLock, null, 2) + ';',
    '',
    'export const TCB_CLOSURE_LOCK_RECEIPT = createTcbClosureLockReceiptV2(',
    '  TCB_CLOSURE_LOCK,',
    `  ${JSON.stringify(generatedAt)}`,
    ');',
    TCB_CLOSURE_GENERATED_REGION_END_V2
  ].join('\n');
}

export function renderTcbClosureGeneratedRegionV2(
  lock: TcbClosureLock,
  generatedAt: string
): string {
  return renderTcbClosureGeneratedRegionInternalV2(lock, generatedAt);
}

export function parseTcbClosureGeneratedRegionV2(source: string): TcbClosureGeneratedRegionV2 {
  if (source.length === 0 || source.length > 4 * 1024 * 1024 || source.includes('\0') || source.includes('\r')) {
    throw new Error('TCB closure lock source must be bounded canonical LF text.');
  }
  const regionStart = source.indexOf(TCB_CLOSURE_GENERATED_REGION_BEGIN_V2);
  const regionEndStart = source.indexOf(TCB_CLOSURE_GENERATED_REGION_END_V2);
  if (
    regionStart < 0
    || regionEndStart < 0
    || regionEndStart <= regionStart
    || source.lastIndexOf(TCB_CLOSURE_GENERATED_REGION_BEGIN_V2) !== regionStart
    || source.lastIndexOf(TCB_CLOSURE_GENERATED_REGION_END_V2) !== regionEndStart
  ) throw new Error('TCB closure lock source must contain exactly one complete generated-region sentinel pair.');
  const regionEnd = regionEndStart + TCB_CLOSURE_GENERATED_REGION_END_V2.length;
  const rawRegion = source.slice(regionStart, regionEnd);
  const trustPrefix = `${TCB_CLOSURE_GENERATED_REGION_BEGIN_V2}\nexport const TCB_CLOSURE_TRUST_REVISION = `;
  const lockPrefix = ';\n\n// Generated from the exact live causal closure. Do not hand-edit this marked region.\n'
    + 'export const TCB_CLOSURE_LOCK: TcbClosureLock = ';
  const receiptPrefix = ';\n\nexport const TCB_CLOSURE_LOCK_RECEIPT = createTcbClosureLockReceiptV2(\n'
    + '  TCB_CLOSURE_LOCK,\n  ';
  const receiptSuffix = `\n);\n${TCB_CLOSURE_GENERATED_REGION_END_V2}`;
  if (!rawRegion.startsWith(trustPrefix) || !rawRegion.endsWith(receiptSuffix)) {
    throw new Error('TCB closure generated region is not in canonical form.');
  }
  const lockPrefixIndex = rawRegion.indexOf(lockPrefix, trustPrefix.length);
  const receiptPrefixIndex = rawRegion.indexOf(receiptPrefix, lockPrefixIndex + lockPrefix.length);
  if (lockPrefixIndex < 0 || receiptPrefixIndex < 0) {
    throw new Error('TCB closure generated region declarations are incomplete.');
  }
  let trustRevision: unknown;
  let lockValue: unknown;
  let generatedAt: unknown;
  try {
    trustRevision = JSON.parse(rawRegion.slice(trustPrefix.length, lockPrefixIndex));
    lockValue = JSON.parse(rawRegion.slice(lockPrefixIndex + lockPrefix.length, receiptPrefixIndex));
    generatedAt = JSON.parse(rawRegion.slice(
      receiptPrefixIndex + receiptPrefix.length,
      rawRegion.length - receiptSuffix.length
    ));
  } catch (error) {
    throw new Error(`TCB closure generated region is not canonical JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const lock = parseTcbClosureLockValueV2(lockValue);
  if (trustRevision !== lock.trustRevision) {
    throw new Error('TCB closure generated trust revision declaration does not match the lock.');
  }
  if (typeof generatedAt !== 'string') {
    throw new Error('TCB closure generatedAt declaration must be text.');
  }
  const receipt = createTcbClosureLockReceiptV2(lock, generatedAt);
  if (rawRegion !== renderTcbClosureGeneratedRegionInternalV2(lock, generatedAt)) {
    throw new Error('TCB closure generated region is not byte-canonical.');
  }
  return Object.freeze({ lock, receipt, regionStart, regionEnd, rawRegion });
}

export function assertTcbClosureLockDataMatchesV2(
  parsed: TcbClosureLock,
  computed: TcbClosureLock
): void {
  const fields: readonly (keyof TcbClosureLock)[] = [
    'schema',
    'trustRevision',
    'moduleCount',
    'modules',
    'reviewedEdges',
    'reviewedBoundaryEdges',
    'reviewedExternalImports',
    'reviewedProcessDispatchers',
    'reviewedNetworkDispatchers',
    'moduleBlobs',
    'moduleContentDigests',
    'closureDigest'
  ];
  for (const field of fields) {
    if (JSON.stringify(parsed[field]) !== JSON.stringify(computed[field])) {
      throw new Error(`TCB candidate generated lock field does not match the base-computed closure: ${field}.`);
    }
  }
}

function tcbClosureRawSourceDigestV2(source: string): string {
  return `sha256:${createHash('sha256').update(source).digest('hex')}`;
}

export function planTcbClosureLockSourceV2(input: {
  readonly source: string;
  readonly nextLock: TcbClosureLock;
  readonly generatedAt: string;
}): TcbClosureLockSourcePlanV2 {
  const current = parseTcbClosureGeneratedRegionV2(input.source);
  const nextLock = parseTcbClosureLockValueV2(input.nextLock);
  assertCanonicalGeneratedAtV2(input.generatedAt);
  const currentIdentity = JSON.stringify(current.lock);
  const nextIdentity = JSON.stringify(nextLock);
  if (currentIdentity === nextIdentity) {
    return Object.freeze({
      schema: 'sec-tcb-closure-lock-source-plan-v2',
      status: 'current',
      currentLock: current.lock,
      nextLock,
      currentGeneratedAt: current.receipt.generatedAt,
      nextGeneratedAt: current.receipt.generatedAt,
      oldRawSourceDigest: tcbClosureRawSourceDigestV2(input.source),
      nextRawSourceDigest: tcbClosureRawSourceDigestV2(input.source),
      nextSource: input.source
    });
  }
  const nextRegion = renderTcbClosureGeneratedRegionV2(nextLock, input.generatedAt);
  const nextSource = input.source.slice(0, current.regionStart)
    + nextRegion
    + input.source.slice(current.regionEnd);
  parseTcbClosureGeneratedRegionV2(nextSource);
  return Object.freeze({
    schema: 'sec-tcb-closure-lock-source-plan-v2',
    status: 'update-required',
    currentLock: current.lock,
    nextLock,
    currentGeneratedAt: current.receipt.generatedAt,
    nextGeneratedAt: input.generatedAt,
    oldRawSourceDigest: tcbClosureRawSourceDigestV2(input.source),
    nextRawSourceDigest: tcbClosureRawSourceDigestV2(nextSource),
    nextSource
  });
}

export function generateTcbClosureLockV2(
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
  createSecTrustedBootstrapTrustRootV3({
    registry: SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3,
    causalRuntimePaths: lock.modules
  });
  return lock;
}

// ---------------------------------------------------------------------------
// Frozen lock — the CLI may replace only this marked region.
// ---------------------------------------------------------------------------

// <sec-tcb-closure-lock-generated-v2>
export const TCB_CLOSURE_TRUST_REVISION = "sha256:0797620b9fd30ac3c600121f4f7c8808b9baa7372ff58261121280ad083f14e2";

// Generated from the exact live causal closure. Do not hand-edit this marked region.
export const TCB_CLOSURE_LOCK: TcbClosureLock = {
  "schema": "sec-tcb-closure-lock-v2",
  "trustRevision": "sha256:0797620b9fd30ac3c600121f4f7c8808b9baa7372ff58261121280ad083f14e2",
  "moduleCount": 136,
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
    "platform/dev-runner/import-transform-transaction.ts",
    "platform/dev-runner/repository-mutation-fence.ts",
    "platform/dev-runner/test-concurrency-policy.ts",
    "platform/dev-runner/test-execution-policy.ts",
    "platform/dev-runner/test-runner.ts",
    "platform/dev-runner/typecheck-runner.ts",
    "platform/dev-runner/verification-action-executor.ts",
    "platform/shared/active-documentation-contract.ts",
    "platform/shared/affected-test-inventory.ts",
    "platform/shared/agent-operation-activation-contract.ts",
    "platform/shared/agent-operation-read-plan-contract.ts",
    "platform/shared/agent-skill-contract.ts",
    "platform/shared/agent-task-capsule-contract.ts",
    "platform/shared/block-identity.ts",
    "platform/shared/bun-runtime-version.ts",
    "platform/shared/canonical-primitives.ts",
    "platform/shared/ci-artifact-contract.ts",
    "platform/shared/ci-artifact-types.ts",
    "platform/shared/ci-contract.ts",
    "platform/shared/ci-evidence-contract.ts",
    "platform/shared/ci-execution-environment.ts",
    "platform/shared/ci-git-changed-files.ts",
    "platform/shared/ci-hosted-sut-observation-contract.ts",
    "platform/shared/ci-pr-risk-selection.ts",
    "platform/shared/ci-verification-plan.ts",
    "platform/shared/ci-verification-revision.ts",
    "platform/shared/collections.ts",
    "platform/shared/concurrency.ts",
    "platform/shared/constants.ts",
    "platform/shared/contract-freeze-contract.ts",
    "platform/shared/documentation-authority-contract.ts",
    "platform/shared/errors.ts",
    "platform/shared/fs.ts",
    "platform/shared/git-read-environment.ts",
    "platform/shared/heavy-verification-gate-lease.ts",
    "platform/shared/integration-authorization-contract.ts",
    "platform/shared/integration-platform-policy.ts",
    "platform/shared/iso-instant-input.ts",
    "platform/shared/issue-disposition-contract.ts",
    "platform/shared/logical-path-component.ts",
    "platform/shared/logical-path-identity.ts",
    "platform/shared/main-health-contract.ts",
    "platform/shared/paths.ts",
    "platform/shared/physical-mutation-lease.ts",
    "platform/shared/physical-no-follow.ts",
    "platform/shared/platform-command.ts",
    "platform/shared/process.ts",
    "platform/shared/project-runtime.ts",
    "platform/shared/repository-path-contract.ts",
    "platform/shared/retained-file-read.ts",
    "platform/shared/review-stability-contract.ts",
    "platform/shared/runtime-dependency-spec.ts",
    "platform/shared/runtime-layout.ts",
    "platform/shared/scope-authorization-contract.ts",
    "platform/shared/sec-runtime-state-contract.ts",
    "platform/shared/semantic-mutation-staging-boundary.ts",
    "platform/shared/tcb-trust-root-contract.ts",
    "platform/shared/test-budget-contract.ts",
    "platform/shared/test-impact-contract.ts",
    "platform/shared/test-impact-rules/governance.ts",
    "platform/shared/test-impact-rules/pipeline.ts",
    "platform/shared/test-impact-rules/semantic.ts",
    "platform/shared/test-impact-rules/verification.ts",
    "platform/shared/test-ownership-contract.ts",
    "platform/shared/verification-action-ci-contract.ts",
    "platform/shared/verification-action-contract.ts",
    "platform/shared/verification-action-provider-contract.ts",
    "platform/shared/verification-provider-capability-contract.ts",
    "platform/shared/verification-result-contract.ts",
    "platform/shared/verification-session-contract.ts",
    "platform/shared/windows-host-filesystem-authority.ts",
    "platform/shared/work-selection-contract.ts",
    "platform/shared/work-selection-live-contract.ts",
    "platform/shared/workspace-path-contract.ts",
    "platform/shared/workspace-write-lease.ts",
    "platform/toolchain/typecheck-provider.ts",
    "scripts/ci-pr-risk.ts",
    "scripts/ci-verification.ts",
    "scripts/ci-workspace-fast.ts",
    "scripts/codex/agent-operation-activation-census.ts",
    "scripts/codex/agent-operation-activation.ts",
    "scripts/codex/branch-closeout-contract.ts",
    "scripts/codex/branch-closeout-receipt.ts",
    "scripts/codex/branch-closeout.ts",
    "scripts/codex/branch-lifecycle-audit.ts",
    "scripts/codex/branch-lifecycle-command.ts",
    "scripts/codex/branch-lifecycle-contract.ts",
    "scripts/codex/branch-lifecycle-health.ts",
    "scripts/codex/branch-lifecycle-inventory.ts",
    "scripts/codex/branch-lifecycle-parsers.ts",
    "scripts/codex/branch-lifecycle-types.ts",
    "scripts/codex/branch-recovery.ts",
    "scripts/codex/ci-orchestration-core.ts",
    "scripts/codex/document-control-plane-contract.ts",
    "scripts/codex/document-control-plane-github-observation.ts",
    "scripts/codex/exact-git-blob.ts",
    "scripts/codex/integration-authorization-publication.ts",
    "scripts/codex/integration-authorization-status-github.ts",
    "scripts/codex/issue-disposition-github.ts",
    "scripts/codex/local-github-actions-runner.ts",
    "scripts/codex/local-main-closeout.ts",
    "scripts/codex/main-health-observation.ts",
    "scripts/codex/merge-gate.ts",
    "scripts/codex/operation-read-plan.ts",
    "scripts/codex/skill-applicability.ts",
    "scripts/codex/task-capsule.ts",
    "scripts/codex/trusted-runtime-closeout.ts",
    "scripts/codex/trusted-runtime-container.ts",
    "scripts/codex/verification-action-github-provider.ts",
    "scripts/codex/verification-provider-capability-ledger.ts",
    "scripts/codex/verification-session-github.ts",
    "scripts/codex/verification-session-journal.ts",
    "scripts/codex/verification-session-runtime.ts",
    "scripts/codex/verification-session.ts",
    "scripts/codex/work-package-contract.ts",
    "scripts/codex/work-selection-main-health.ts",
    "scripts/codex/work-selection.ts",
    "scripts/codex/worktree-physical-closeout-contract.ts",
    "scripts/codex/worktree-physical-closeout.ts",
    "scripts/install-git-hooks.ts",
    "tests/setup/runtime-deps.setup.ts",
    "tooling/sec-dev/runtime-state-authority.ts",
    "tooling/sec-dev/runtime-state-journal-filesystem.ts",
    "tooling/sec-dev/runtime-state-paths.ts",
    "tooling/sec-dev/verification-action-journal.ts",
    "tooling/sec-dev/verification-action-runner.ts"
  ],
  "reviewedEdges": [
    "scripts/ci-workspace-fast.ts -> platform/orchestrator/block-orchestrator.ts",
    "scripts/ci-workspace-fast.ts -> platform/orchestrator/compose-orchestrator.ts",
    "scripts/ci-workspace-fast.ts -> platform/orchestrator/verify-orchestrator.ts",
    "scripts/ci-workspace-fast.ts -> platform/orchestrator/workspace-orchestrator.ts"
  ],
  "reviewedBoundaryEdges": [
    "scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts",
    "scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts"
  ],
  "reviewedExternalImports": [
    "platform/dev-runner/env-manager.ts -> node:net",
    "platform/shared/heavy-verification-gate-lease.ts -> bun:ffi",
    "platform/shared/physical-no-follow.ts -> bun:ffi",
    "platform/shared/process.ts -> node:string_decoder",
    "platform/shared/windows-host-filesystem-authority.ts -> bun:ffi",
    "scripts/ci-verification.ts -> bun:ffi"
  ],
  "reviewedProcessDispatchers": [
    "docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#1",
    "docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#2",
    "docs/scripts/docs-doctor.ts::function-declaration:readCapturedGitTreeBlob::spawnSync#1",
    "docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1",
    "platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1",
    "platform/dev-runner/verification-action-executor.ts::function-declaration:executeVerifiedCiActionPlanV1::Bun.spawn#1",
    "platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1",
    "platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1",
    "scripts/ci-verification.ts::function-declaration:defaultHostedSutSandboxProcessV1::spawn#1",
    "scripts/ci-verification.ts::function-declaration:gitCandidateBytesV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:hostedActionGhReadJsonV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:inspectHostedActionArchiveMetadataV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:runHostedMaterializerCommandV2::spawnSync#1",
    "scripts/codex/agent-operation-activation.ts::function-declaration:command::spawnSync#1",
    "scripts/codex/branch-closeout-receipt.ts::function-declaration:runCloseoutObservationGh::spawnSync#1",
    "scripts/codex/branch-closeout.ts::function-declaration:runCloseoutGit::spawnSync#1",
    "scripts/codex/branch-lifecycle-inventory.ts::function-declaration:runInventoryCommand::spawnSync#1",
    "scripts/codex/branch-recovery.ts::function-declaration:runRecoveryGit::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultChangedPathsV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultGitRevisionV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentDefaultTrackedTreeIsCleanV1::spawnSync#1",
    "scripts/codex/ci-orchestration-core.ts::function-declaration:CodexDevelopmentRunGateProcessV1::spawn#1",
    "scripts/codex/exact-git-blob.ts::function-declaration:runGit::spawnSync#1",
    "scripts/codex/issue-disposition-github.ts::function-declaration:gh::spawnSync#1",
    "scripts/codex/local-github-actions-runner.ts::function-declaration:runCommand::spawn#1",
    "scripts/codex/skill-applicability.ts::function-declaration:gitOutput::spawnSync#1",
    "scripts/codex/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeupV2::spawnSync#1",
    "scripts/codex/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1",
    "scripts/codex/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1",
    "scripts/codex/verification-session-github.ts::function-declaration:runVerificationSessionGh::spawnSync#1",
    "scripts/codex/verification-session.ts::function-declaration:runVerificationSessionCommand::spawnSync#1",
    "scripts/codex/work-selection.ts::function-declaration:runDefault::spawnSync#1",
    "scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1"
  ],
  "reviewedNetworkDispatchers": [
    "scripts/codex/integration-authorization-status-github.ts::function-declaration:dispatchGitHubApiRequestV1::globalThis.fetch#1"
  ],
  "moduleBlobs": {
    "docs/scripts/docs-doctor-ledgers.ts": "d50827dc72b4982808a0041359349990121bf46e",
    "docs/scripts/docs-doctor-shared.ts": "5b1aa8ae950b6cfe371f2c86e62a948d62bde911",
    "docs/scripts/docs-doctor.ts": "c09c06ef8442e50fc897ec540d449423335a6aca",
    "platform/dev-runner.ts": "f5ba9d030ba62f36e2f1fd6a1fd9df734fd8893d",
    "platform/dev-runner/check-runner.ts": "0532888b914a53c1e2601b82312d6abccfcf6bc3",
    "platform/dev-runner/command-runner.ts": "1153ba825e53727c8cc72f6727c2d7308a9df2f9",
    "platform/dev-runner/dependency-bootstrap.ts": "e9be49f30e17a9e66d7deae65c53380b58ab4ff0",
    "platform/dev-runner/env-manager.ts": "8031c5c4cf0af2dc22f43b8b67df53a279add4ee",
    "platform/dev-runner/fast-test-policy.ts": "bbf01291148d01b95dba456816909688f4997392",
    "platform/dev-runner/import-organizer.ts": "cdceb97b710376552529afb3bb7b00a836c3c1ac",
    "platform/dev-runner/import-transform-transaction.ts": "1a0916434730596351437c347119523d301f5401",
    "platform/dev-runner/repository-mutation-fence.ts": "590ee15af7e6a3ffe70b1cee2f070b533d6a53dd",
    "platform/dev-runner/test-concurrency-policy.ts": "614dcca876dc8f15dfdcc265fdf33ce54c778e78",
    "platform/dev-runner/test-execution-policy.ts": "a637b18fe22c37215a44b9ba30a05175548f9748",
    "platform/dev-runner/test-runner.ts": "b40ca7b6d9197437adfe3e4e85661c96ddb6913b",
    "platform/dev-runner/typecheck-runner.ts": "28161aa38ffda39493699c69612ab7979b85d3bb",
    "platform/dev-runner/verification-action-executor.ts": "03fd171730005ce1fb326a05e179a8e5fe038d72",
    "platform/shared/active-documentation-contract.ts": "8894712cc4303fbc0a584029c5b4f6c00acf5ad8",
    "platform/shared/affected-test-inventory.ts": "49405c895038030cb3e70641146ff6b643761d05",
    "platform/shared/agent-operation-activation-contract.ts": "3788de8ee288a49aa64f253c668c53ab3c91a48a",
    "platform/shared/agent-operation-read-plan-contract.ts": "69a34ef30389b4d9970ff96e9704638fe4280dc2",
    "platform/shared/agent-skill-contract.ts": "a5d7406b251251612274705c9033890d14593bdc",
    "platform/shared/agent-task-capsule-contract.ts": "ad7f37cdc30d107b0d44333ba7eadf8b786b4549",
    "platform/shared/block-identity.ts": "9a3cd9e201884561cdd95f51dca573bbb2d4bacc",
    "platform/shared/bun-runtime-version.ts": "8f0eb0d85daa5c6f7ddf0255512cee6d9af133ab",
    "platform/shared/canonical-primitives.ts": "960c2fc4cbf4c16034a2414d7c206db1d70d4941",
    "platform/shared/ci-artifact-contract.ts": "08a347391a575bab2e5fb46e5af5d16cc0182f1f",
    "platform/shared/ci-artifact-types.ts": "0b00a3e5f46f56708b4ee96fae3d7e451e5197b9",
    "platform/shared/ci-contract.ts": "f279fdb4736eddaee583016844fc7922a3bdd3c8",
    "platform/shared/ci-evidence-contract.ts": "fe830162213c80b3b0a8eb00075ca165714ffd35",
    "platform/shared/ci-execution-environment.ts": "d39098bf12edaf89a630363852c8b9e34d34376a",
    "platform/shared/ci-git-changed-files.ts": "5213d014ac070da286bb9e6236223c266634bfb5",
    "platform/shared/ci-hosted-sut-observation-contract.ts": "62eac8581fc09802975efe743e8a8cb393c1449c",
    "platform/shared/ci-pr-risk-selection.ts": "6999b72f2f46e44e4224182a3eb56af2832064cb",
    "platform/shared/ci-verification-plan.ts": "ef1bd7cef28ad0506b508ae35ca7989aa2b8374b",
    "platform/shared/ci-verification-revision.ts": "c211f53390567f991dc1ae3dd41b530658c7616d",
    "platform/shared/collections.ts": "8f8ecb1395714b83e995bcc560304ab1e0d9617f",
    "platform/shared/concurrency.ts": "4168d40bb28ebd230a88322e6bd2a4f8a0fe2caf",
    "platform/shared/constants.ts": "78e19d1d79f8d6f5e729d66cb9ee74b4c6538088",
    "platform/shared/contract-freeze-contract.ts": "dcc6ea490001f528fda99787a41c81a330d5042d",
    "platform/shared/documentation-authority-contract.ts": "3255db2a229f32249470fed26367cd17d68eb69e",
    "platform/shared/errors.ts": "160c3b00d95d8457f59801762ae55c5f89e24784",
    "platform/shared/fs.ts": "06f88220c0165e040c94d931223706f794ea3414",
    "platform/shared/git-read-environment.ts": "41b18f7969138ba88278cea725fc3bf70a6df8bf",
    "platform/shared/heavy-verification-gate-lease.ts": "bfd3b62e9411abc339234451d5122a2c0230a3cc",
    "platform/shared/integration-authorization-contract.ts": "18bc72e4ffb195c44baacc19707c93af7c49e53b",
    "platform/shared/integration-platform-policy.ts": "192252f60bd1c478449eafed31e667a34384a356",
    "platform/shared/iso-instant-input.ts": "0c33ab8bda23c073481e9c6ad8b2b211b52c16cd",
    "platform/shared/issue-disposition-contract.ts": "e9da755b1f6f11ae2c98b3239d45d68f74a39316",
    "platform/shared/logical-path-component.ts": "2fb925f8e94c3bffa63a3fdcc6dce1c8eae04690",
    "platform/shared/logical-path-identity.ts": "f3a3e60b0c6643f13bc0725cc66e9488ed0b8c66",
    "platform/shared/main-health-contract.ts": "b013a77db2467a46485e5b5fe1302d72497ff4a9",
    "platform/shared/paths.ts": "01e6fb8443c001c62087073e520d52d4da7257ab",
    "platform/shared/physical-mutation-lease.ts": "afb3d96336d86c3db6849283500ef3c692a71757",
    "platform/shared/physical-no-follow.ts": "fb2273d4a3c537d0c65f5a846611c764791e33ae",
    "platform/shared/platform-command.ts": "6a59e27518b3e5d0b8c17d4d2cda67a987d68ff3",
    "platform/shared/process.ts": "07f9433bb08593c26863ade7b95b4090fea4fb8d",
    "platform/shared/project-runtime.ts": "055002051361b70b30cf66cc4a4389392de119e5",
    "platform/shared/repository-path-contract.ts": "0d655f17a56379651ed3da2de59048db43936f91",
    "platform/shared/retained-file-read.ts": "76cfbc2380cbfd22f8efd376e7daf5541dacdfb1",
    "platform/shared/review-stability-contract.ts": "1bf6f9c248323376c75e40bb8394d7d05cc6011d",
    "platform/shared/runtime-dependency-spec.ts": "a2aa17278533a79582636a4266d4beff9869d8bf",
    "platform/shared/runtime-layout.ts": "5212a501756b354a7e2088a6662319fda08431a5",
    "platform/shared/scope-authorization-contract.ts": "cbd15a4a0216c64f44b8e07bac84ebffd42b6625",
    "platform/shared/sec-runtime-state-contract.ts": "53321bc4bc658d6e5bc91fc8342292f29d0ae135",
    "platform/shared/semantic-mutation-staging-boundary.ts": "87c3fc387147c0b41cfab0c1d176e88cbd00e1b9",
    "platform/shared/tcb-trust-root-contract.ts": "97815689cbd7c47466378abdee19b81f2d7fcae8",
    "platform/shared/test-budget-contract.ts": "41a4025214064b5e8ab981bce79dcbcd7d563d89",
    "platform/shared/test-impact-contract.ts": "8f1c7735d54df42340e13d5980ead689c34eda9b",
    "platform/shared/test-impact-rules/governance.ts": "39eb3fcc8d24548164f6b976c61c722b3e717e08",
    "platform/shared/test-impact-rules/pipeline.ts": "6cd978b9e52a2cca2a3a7adeaff65d62da78c310",
    "platform/shared/test-impact-rules/semantic.ts": "3f86f6d2e6eb566693fa557aa7bb8b31af07b191",
    "platform/shared/test-impact-rules/verification.ts": "888945a4e8f321b8158eb2422f2ae69b65325e57",
    "platform/shared/test-ownership-contract.ts": "4730a39e5facd0b0d1dccb1170c6c96d5d9492df",
    "platform/shared/verification-action-ci-contract.ts": "6ed975ac635d7c6f104a03c5fe14cffeb17d4180",
    "platform/shared/verification-action-contract.ts": "a2fa94d2757e4caa0067c072764e825c7eea9e43",
    "platform/shared/verification-action-provider-contract.ts": "7b8aafac41bd2413fd3c394f1ba568457cc789b3",
    "platform/shared/verification-provider-capability-contract.ts": "3d9b1804e9e54751753663f40bceef1becf5610d",
    "platform/shared/verification-result-contract.ts": "e7eead1b377ae6fd184ee8d31afdea43c46e6485",
    "platform/shared/verification-session-contract.ts": "d50d9657f65c4ea8dec5a3b396c1e18d5aa792b7",
    "platform/shared/windows-host-filesystem-authority.ts": "aa1fd9e5fc0ddd40332923562feadafa8ea84600",
    "platform/shared/work-selection-contract.ts": "fb336a7b18c3fed3cfc26442a34434fcd939b965",
    "platform/shared/work-selection-live-contract.ts": "7587e163db52c86ed8bbaa47a73f43ada9000686",
    "platform/shared/workspace-path-contract.ts": "bf0efad0e2f0fe1036880c3aef7ec5c273639ff6",
    "platform/shared/workspace-write-lease.ts": "aa84757aeb1c3c31e6909725510b69516ca1e8ef",
    "platform/toolchain/typecheck-provider.ts": "5afd71292782351a4be27c8f5a9bd4c7a319c346",
    "scripts/ci-pr-risk.ts": "1d1a4ea6ca18562ad5bb4a43f13bf8743371c0c1",
    "scripts/ci-verification.ts": "ea7ed098dd5cf442c581bd0c94eda76b3c136e31",
    "scripts/ci-workspace-fast.ts": "62e063402a481f47be0926108e70f053c277e5a1",
    "scripts/codex/agent-operation-activation-census.ts": "6f1c70d4f5fa3f2dc9174e70b7d6fed6dc6b88de",
    "scripts/codex/agent-operation-activation.ts": "e3d545cf40a8df8f91143e9a3d45a7d1b4b37c37",
    "scripts/codex/branch-closeout-contract.ts": "94f7dfc0efc46708ba3288c57a75970e394a681f",
    "scripts/codex/branch-closeout-receipt.ts": "c15183b9b1235bd47da5d04bbd1e714d854a0d06",
    "scripts/codex/branch-closeout.ts": "953926862a8079a6b2f3bf197afdeefae9e35da6",
    "scripts/codex/branch-lifecycle-audit.ts": "c711acb19f0cc686abad292086e98c97e3568603",
    "scripts/codex/branch-lifecycle-command.ts": "e85318eb4ae77624def9c9e3bf2879ba26f7ff8e",
    "scripts/codex/branch-lifecycle-contract.ts": "7be4c7077921505915bd4e6ab53915570ad4dced",
    "scripts/codex/branch-lifecycle-health.ts": "8c95642c51b8a5343b0a4f27ca456a9b3ecad227",
    "scripts/codex/branch-lifecycle-inventory.ts": "a127b36400d171bc0489260411549b4b667d30b8",
    "scripts/codex/branch-lifecycle-parsers.ts": "a9e7a2412279ded68e9fdc4cf238b8083acf30e5",
    "scripts/codex/branch-lifecycle-types.ts": "d0f343c3c4491265e6bfcfe0d096b7ad829a3b0c",
    "scripts/codex/branch-recovery.ts": "d2b86ae33a8c8b4312b19e809d3c8dfa281ce82d",
    "scripts/codex/ci-orchestration-core.ts": "ea8f68ca87727c0a97067fad7794240c1da283e9",
    "scripts/codex/document-control-plane-contract.ts": "49910402fd0dd22338f4e193e0b18c4ec854bc13",
    "scripts/codex/document-control-plane-github-observation.ts": "d133648295bc313f25d83198e7f939225105fc79",
    "scripts/codex/exact-git-blob.ts": "658d2d724af2c13f8dc0b0f0801c1aaba156ad26",
    "scripts/codex/integration-authorization-publication.ts": "b9335204268985c416d01a3a6a2ab8de261d3b79",
    "scripts/codex/integration-authorization-status-github.ts": "b7c235263d48f3d0d4258d829a0210dc0444abf8",
    "scripts/codex/issue-disposition-github.ts": "10aac92f5aadd8d8aa706bc74c11d3c86a7b9810",
    "scripts/codex/local-github-actions-runner.ts": "f8f086e5175190000e3f4d67ae299129f5acf447",
    "scripts/codex/local-main-closeout.ts": "4772672fee4897a3cc908cd873032638367b1fdb",
    "scripts/codex/main-health-observation.ts": "354673be8eb2674127731321666169f839e3764d",
    "scripts/codex/merge-gate.ts": "fd7013e35def194056ff8c1f5f0208def11330f9",
    "scripts/codex/operation-read-plan.ts": "6ba70b3801d828827f6122925635fa3cec17dd78",
    "scripts/codex/skill-applicability.ts": "d05b4d4d6e8addda7e57a5079665d02640b14d21",
    "scripts/codex/task-capsule.ts": "c0ab1df88b88ff270fb476d8dbfaf267bf794f72",
    "scripts/codex/trusted-runtime-closeout.ts": "4c6c771dafa26802dc1bbb03c92c20654f67966c",
    "scripts/codex/trusted-runtime-container.ts": "2dd915eb30ba6d175b279477d1119bd0bb42fadb",
    "scripts/codex/verification-action-github-provider.ts": "3f4c1adb70d51a820713ece691eeb1e0aee8afff",
    "scripts/codex/verification-provider-capability-ledger.ts": "4dd028e20a7d975ba2f05dc23f384802c1e1a99d",
    "scripts/codex/verification-session-github.ts": "6c4a674a0886f0bebb375f50951aadb76592ab11",
    "scripts/codex/verification-session-journal.ts": "23d44d1a39d1f0c6075ee84d99a92ff7e7618f95",
    "scripts/codex/verification-session-runtime.ts": "1880254fd958b7dfb056eec3f0199db6f0b4c431",
    "scripts/codex/verification-session.ts": "4ac820d72a4d920017e866e4d51ea384f3e2af0e",
    "scripts/codex/work-package-contract.ts": "5179230c82073bc79ddd5f4fa18eb87a10a631a7",
    "scripts/codex/work-selection-main-health.ts": "1208bf077b1461c7f4e158e7496895e05c384f37",
    "scripts/codex/work-selection.ts": "23122f3891495862e2d2147905e6d82583543060",
    "scripts/codex/worktree-physical-closeout-contract.ts": "2319555be026f3f17774f734a05e40b6c2bc7675",
    "scripts/codex/worktree-physical-closeout.ts": "14c49122bf823d3cc24305d88989fc0a04340268",
    "scripts/install-git-hooks.ts": "b13fb3af64e67a67908698f4698002877aa7713b",
    "tests/setup/runtime-deps.setup.ts": "aca990462b47ac58e4823e668c03e3372d051fdd",
    "tooling/sec-dev/runtime-state-authority.ts": "c881c2e550126b6d64387c83de336a9f3f75af91",
    "tooling/sec-dev/runtime-state-journal-filesystem.ts": "7b7a2ac8266b61ca5bb647e8733aec36a45b2b5b",
    "tooling/sec-dev/runtime-state-paths.ts": "1ff5dd329a0509d33afc57a0b141078ab9a15715",
    "tooling/sec-dev/verification-action-journal.ts": "6fd54cfa82db1afeeea76705b0abea4a0a4b0a96",
    "tooling/sec-dev/verification-action-runner.ts": "da8257549c4604f10b0db44066fdacae7846d4d6"
  },
  "moduleContentDigests": {
    "docs/scripts/docs-doctor-ledgers.ts": "sha256:b9ba3cbd1beb9834f2e2e97c5cee5c557c071422a77ab609026a7a8f2c01fc1a",
    "docs/scripts/docs-doctor-shared.ts": "sha256:ecf605db8782097832e6de3ca2336f4311a1519a766962e7677d3fafd0cb2132",
    "docs/scripts/docs-doctor.ts": "sha256:2466a704b20377e4907d2f5ca68dd5b922a8cab3afbfb4b8d67ac25a46c6067c",
    "platform/dev-runner.ts": "sha256:760562e120649f9772177bc12116547eedb13e8b4020cb0a3b86109fb14cf937",
    "platform/dev-runner/check-runner.ts": "sha256:ee8e03c72eafe284df4ac70f22ea19457f6a3fc1608f7aa26bf7cd0edf07e8bb",
    "platform/dev-runner/command-runner.ts": "sha256:b45598f646f81bfd06d3ac4c53997d068d17fb3959bf3f5ff75d98da2d63ae2e",
    "platform/dev-runner/dependency-bootstrap.ts": "sha256:41923b58b2eb13c3f57499e30be29a5542087baecb7ce401b4ba375a52b0df36",
    "platform/dev-runner/env-manager.ts": "sha256:3c019be501d1edbb7586af26dd1c83deb5bbcb41014096a775e582b9d2b817b6",
    "platform/dev-runner/fast-test-policy.ts": "sha256:24e9452b8ca2488cbd85ab10f71c31bd8a77e820fbf350eb7f03903ac6ec4ad9",
    "platform/dev-runner/import-organizer.ts": "sha256:d21475c2f5cb1a8804590d3c6c9ca69f63e6b2a2500c28aff3275fb1d82010ea",
    "platform/dev-runner/import-transform-transaction.ts": "sha256:050d3e474c81cb1b31f23974f7df160f78384b791f49076f894c797473a07c76",
    "platform/dev-runner/repository-mutation-fence.ts": "sha256:a25ad31b72439f4a5cbc7371ec80e498784e8557ee544f1d4f8592e0cfad78c1",
    "platform/dev-runner/test-concurrency-policy.ts": "sha256:b0ae5d1f29a528dadf2bd7d91e703e1753baf4991aeb5d65940c05d4f8cf2e4f",
    "platform/dev-runner/test-execution-policy.ts": "sha256:c9c2078c179a9cbb81251851f7d45bd0d1542c8fea270845d1bde08e64c579e3",
    "platform/dev-runner/test-runner.ts": "sha256:e5995698531b76e1c7e15436d8871fa458e55982d2ddd8b3ba1c0cfa860fc201",
    "platform/dev-runner/typecheck-runner.ts": "sha256:4f85e995a97414253e581f9b81de73ea7ffb541c170f2b29c88b8fcbf0590ca6",
    "platform/dev-runner/verification-action-executor.ts": "sha256:35b2ec01e0c65da11e3cee0a12a80693aef214cd9a5ebee82b121beddae473d4",
    "platform/shared/active-documentation-contract.ts": "sha256:5990c41ce11be18985b63876c912819240ed9e1f3345e93e1856d43dda1e3e1f",
    "platform/shared/affected-test-inventory.ts": "sha256:e2355633e7fefe805466cc7408b010ad75c64722fef565c5c71e1795335cee98",
    "platform/shared/agent-operation-activation-contract.ts": "sha256:ca1df5841fe6f1a6b5c8404d0a63ffa9d417b183db2f2935dbf96791b65ef014",
    "platform/shared/agent-operation-read-plan-contract.ts": "sha256:b92238315d4a7be8587b4055889212c3368edabe933937327cb4f43affb3846a",
    "platform/shared/agent-skill-contract.ts": "sha256:e40b3b2c06c0ec30620ed09a32d3e43d390f15051ac2c3c51fe2dfc6ae879278",
    "platform/shared/agent-task-capsule-contract.ts": "sha256:d9caeb21fca4bebaa0989325ea390ade8a88d0f1c4fb348d045835fd3aa7ba66",
    "platform/shared/block-identity.ts": "sha256:b34fc80371669b920a15e5998953c74abcbbced5740a40c544f0881fd1649c46",
    "platform/shared/bun-runtime-version.ts": "sha256:56f352fcbbbc189dba528aaa520086edaaaa54ebe9671be6be234c78d2867434",
    "platform/shared/canonical-primitives.ts": "sha256:5bf7be826e00e5becfbfb0d5395cb03d0c1f9adbec64bd536e4ff6e5f62d38a3",
    "platform/shared/ci-artifact-contract.ts": "sha256:95c4f4ade4a9077f66a98eb5a66c9ea09a15bf4da9d31117f2555f62b93388b0",
    "platform/shared/ci-artifact-types.ts": "sha256:02da37c0130e85dc4289a1ae0aa99d746fa0dac8e541bbe0d86856c2823ca242",
    "platform/shared/ci-contract.ts": "sha256:e606685cc7e65032357f1b051e2e0a2b2871d4ddbf82eeaa27e4951e815d1bd9",
    "platform/shared/ci-evidence-contract.ts": "sha256:088d35055926ef92543632e428f652aaa433fd398fa51fc9fb66cc6f27cbeefa",
    "platform/shared/ci-execution-environment.ts": "sha256:b5dad090ac0b540bac75be683a62f745f07d4de39edd08017b3d74c2298d4240",
    "platform/shared/ci-git-changed-files.ts": "sha256:22caa6482735ffd00578e132faa4f994b6c6bbc5d373cd66e9ecf8cf0d681e24",
    "platform/shared/ci-hosted-sut-observation-contract.ts": "sha256:ec481ea1929404b6cf98bfe4119f6d218602f246d437dd05d51faa2a749763b7",
    "platform/shared/ci-pr-risk-selection.ts": "sha256:808fbc05fc579cdc0a15333a82668313604abec4903b12290f4979e55566fd72",
    "platform/shared/ci-verification-plan.ts": "sha256:5cab083486e7713853ca5b62266ca22a684077a965fcfd076d7fd391baed6227",
    "platform/shared/ci-verification-revision.ts": "sha256:b28fcadbab8143982ce9e336f83d3b854d5d78833ac88566759b47b0d0fd0e7d",
    "platform/shared/collections.ts": "sha256:8ff70a8bb6f89ba8355d900648d13caa4cc756542d808b7cf7e25efa5886bed4",
    "platform/shared/concurrency.ts": "sha256:f609c7092a435aeccfb27f3a12c947202b5c0512b952819174c8fb0069e379fe",
    "platform/shared/constants.ts": "sha256:bff35d03ea929d90b6f23a4246919011271bb86f0710cc86f51692ca51af26b5",
    "platform/shared/contract-freeze-contract.ts": "sha256:294ddf1a68d00ac41bff7b117a8e8882f918542e2ea4efe5eb06f8289edceb54",
    "platform/shared/documentation-authority-contract.ts": "sha256:b16b0b70662651eebc3a48321b87e23e3ba62208ca2a97ce12c782b6333ca6fc",
    "platform/shared/errors.ts": "sha256:6f2c91d5dda872f56f6e344d2b18a8cbf00fd1ffe3b46d5d36e48b11344c7e15",
    "platform/shared/fs.ts": "sha256:c8f2f1cc2fdc8aa3fe204ee4caac25e1f6de47c9f7d523b802fa63c53eabec73",
    "platform/shared/git-read-environment.ts": "sha256:ad2b9868d9b42de684f271288841e9295ddde033ccaf7842842641831bd1d229",
    "platform/shared/heavy-verification-gate-lease.ts": "sha256:823c007152110400a65a65702c962471a5a5b829c43c6d6fc35b877c937915bb",
    "platform/shared/integration-authorization-contract.ts": "sha256:3d121feb0ac7a8eb48a15becb19d314ad5c4c8486ab154320ac4a8d328c51807",
    "platform/shared/integration-platform-policy.ts": "sha256:a5dd08498039631d2f1d3690a32883b0752575dd14710ffa238d1674aaa1fd1b",
    "platform/shared/iso-instant-input.ts": "sha256:b5c4258ef27eea097bc64b1a629345e0567be81e1bc0c0435b9d54100aa6002a",
    "platform/shared/issue-disposition-contract.ts": "sha256:f1ee7831fa3424a82ec5b894ce495b2fe6c4bf6d282fe56c46bff9bb275b9a99",
    "platform/shared/logical-path-component.ts": "sha256:75f9bcad59e17be1a9fca25ecb3b9aa597b8b3e89fbb2794645188bfc7a1c7c6",
    "platform/shared/logical-path-identity.ts": "sha256:a1c914f957fe9865685b9c50a10cd47ad48d24d35722c5630638e62dff6a6381",
    "platform/shared/main-health-contract.ts": "sha256:d58862a761664e3a68e50bccceb70b2172f1d37befe3331ffbb09eada04addeb",
    "platform/shared/paths.ts": "sha256:7849e074e625f4955283bb41c0960ca3acfa43324ab0f59d8e74b4989fda60e3",
    "platform/shared/physical-mutation-lease.ts": "sha256:5060522603bcb592650ef535b612f598910112795055b0eaf15a58cc744b48d4",
    "platform/shared/physical-no-follow.ts": "sha256:225fa35041ea7c0f36defebad60188de27c8d02e19de8bee18de690c23ba1be4",
    "platform/shared/platform-command.ts": "sha256:dbb654a1697a0d73892b55bbd488f9fc2006a1fafe80f22fb82b8e0e15ba1a9c",
    "platform/shared/process.ts": "sha256:c73fbf7577dca08697a7932e55c9c0b31a1465d8518da62b8923b8217253473e",
    "platform/shared/project-runtime.ts": "sha256:09b1a1ec71d29da834e0d2f8f8f4e2a9d4060c0a63d924dc93852ee2233421a4",
    "platform/shared/repository-path-contract.ts": "sha256:262d0d7b19105bb20c232b88e0f71de0987956374034bb80f3548d92e27454ba",
    "platform/shared/retained-file-read.ts": "sha256:24a9dff61392f17184d5cc49f3bb6f1bc7eb638dc4855dc319bbb241c0612b95",
    "platform/shared/review-stability-contract.ts": "sha256:a08c088bcc0ced337f6c3e8ebabd63cafed6e3f4461cdb824b5b6603682454cd",
    "platform/shared/runtime-dependency-spec.ts": "sha256:c38f9853c22e6e6bf318d0bff907b506beb463a9e2f64bd13ab0b6c32a41613a",
    "platform/shared/runtime-layout.ts": "sha256:e0d35088bc01cb50bacd85222adad39246905f40569685f02d80f4e0f76c9e23",
    "platform/shared/scope-authorization-contract.ts": "sha256:fbea121ea41c47ecc5e679e8f5ab935342be9f5c724280185bb2d57879fb2e1c",
    "platform/shared/sec-runtime-state-contract.ts": "sha256:e8c38f0dd29de13f05d8a9b1838d46d80779841d8993338e8188431d82390127",
    "platform/shared/semantic-mutation-staging-boundary.ts": "sha256:c1a6db054e6f73b2792b8aa81a8938e1ec276127415f31f42f65838d39984145",
    "platform/shared/tcb-trust-root-contract.ts": "sha256:cb00f852520da5c4f9abe252f405a123bfd5354f2c6afeb6a124c63beb498bc0",
    "platform/shared/test-budget-contract.ts": "sha256:622b7d80ed1691e7bf889ab2c4ac01e96a79dc093d93acc9283aff5a6bfeac31",
    "platform/shared/test-impact-contract.ts": "sha256:2fd25de6cc732cb95d7c77f1db6631a99542ed9203752cde57bf59f682c0b827",
    "platform/shared/test-impact-rules/governance.ts": "sha256:b3bf367c82356c4d3efbc0169d2896421cd7a4f686eb2e45315e259947a85b24",
    "platform/shared/test-impact-rules/pipeline.ts": "sha256:a1da1b86593d44b4aa8049c30f95997f9e3a4f01d3714f5127221ff03a5a46aa",
    "platform/shared/test-impact-rules/semantic.ts": "sha256:0c5cc5daeec8456e44035d3d9ebf908190638e4146f16d516b0fa485a5714fa7",
    "platform/shared/test-impact-rules/verification.ts": "sha256:dae7dc52db70585d563763cf1a338c945472689953f3216a906b996182ae86d1",
    "platform/shared/test-ownership-contract.ts": "sha256:73a5bcacd2d090bcc473c4d69370a9920a1bdd23b87bda1cd08dac70127ca050",
    "platform/shared/verification-action-ci-contract.ts": "sha256:e3e28a0e6855ee8c540f32aa35e7341c9588283c8ed13d821c64aa6337941eec",
    "platform/shared/verification-action-contract.ts": "sha256:266241ad4eaa75bb58e2ec9c1e3cc04b36a283d82a6a668cf5f874e9732003b9",
    "platform/shared/verification-action-provider-contract.ts": "sha256:b530f7f683dd7d0c1952f094f729a3add2b6e8e619987f08c5791aa717bbdea8",
    "platform/shared/verification-provider-capability-contract.ts": "sha256:ea81ac9ce9d32dbeea51ab2d6d43bc81c543d08ca89e5908937bb2c3cf32fdc0",
    "platform/shared/verification-result-contract.ts": "sha256:fc4a889ff3183a864a9ff412b4a4aa0049c105b9b34dd4c7666da9ed51cb5ba6",
    "platform/shared/verification-session-contract.ts": "sha256:9c80c3eb37f52d424f9e72ea1f7fabc6dd14f7abb2bda5db2afe6837eafda782",
    "platform/shared/windows-host-filesystem-authority.ts": "sha256:6900915cdb20a0cba42374346e65341f0ee30693ffe0e56765e7728cb6b55e16",
    "platform/shared/work-selection-contract.ts": "sha256:5fc679ae2f004f28655cecdad1a6f1d039654c601c9e6d3647e0f0f9be18f635",
    "platform/shared/work-selection-live-contract.ts": "sha256:1b21caead6efdf2015edd8b8584f7d4e8bb334462aa59a20c8ecb77be0a15744",
    "platform/shared/workspace-path-contract.ts": "sha256:65235f9548e99be1e6b333bb3b018dc7e4eeaf866b7fb052db64b9fdef9df364",
    "platform/shared/workspace-write-lease.ts": "sha256:39fc95e31e6d31632fda3ec24be8bcf219b061027b6e082ce539dacffb47c87e",
    "platform/toolchain/typecheck-provider.ts": "sha256:c20e74acdab1380b946d0069242c80f2d8dac23068347557e6cbb2c2e96037a8",
    "scripts/ci-pr-risk.ts": "sha256:e076ffe161e3f4afc421066b531429e5267797d43e3693fa8ba5333e6d9b22f2",
    "scripts/ci-verification.ts": "sha256:1c53855c26a68c0f789f5a388be02bfc2adcc161a93b6d6a6adad75925f313fe",
    "scripts/ci-workspace-fast.ts": "sha256:33601169c3a867d9bfb53117734d90003976a9dc1d3aac84050c7153a73be623",
    "scripts/codex/agent-operation-activation-census.ts": "sha256:abd2b878a1b765509e5d50d21abbda1dc0110e18ab6a7a635cf8a4bd8229b748",
    "scripts/codex/agent-operation-activation.ts": "sha256:c16e1c2738525be264eaf8b027bfb32d0b2d596ed50fec5af315a8eb874b1578",
    "scripts/codex/branch-closeout-contract.ts": "sha256:dc2285b46abfae499b2ccd221330a54323486eebe3470a46a9586cfce6f35c3e",
    "scripts/codex/branch-closeout-receipt.ts": "sha256:674d1209b3cd1857728d2b2170e319c5f28d59e3fd792f7684b74f7464b9616c",
    "scripts/codex/branch-closeout.ts": "sha256:118d1f176b0f70641eafe67f4856f2620b20f6140f5855aa29dc261155f05041",
    "scripts/codex/branch-lifecycle-audit.ts": "sha256:9fa43191d89a4176cafa6e8f24e7bfe20f8ccd570815ea560d961ed8ec61ca7f",
    "scripts/codex/branch-lifecycle-command.ts": "sha256:3946e6d4469ae70845e2e42c27a9b45250c3bf04f9afdaddf00c0c9662208ab2",
    "scripts/codex/branch-lifecycle-contract.ts": "sha256:c40c8a3474585087f70a5f38200be923ccc9e8f43bc8b811bf14535825758b48",
    "scripts/codex/branch-lifecycle-health.ts": "sha256:bb04d4c870727e24c95a7d1b6c5c2a9fc72d1f4a75514eceef42a493a6d581ad",
    "scripts/codex/branch-lifecycle-inventory.ts": "sha256:722cf3ec4eca089b000e4619e6bccb24a1b47913d18837d0bdf682203c9697bf",
    "scripts/codex/branch-lifecycle-parsers.ts": "sha256:3ece92cc203fb44d72c7ce318e0405771a3c87ee741aaab2a42be476bb8c6fd8",
    "scripts/codex/branch-lifecycle-types.ts": "sha256:fff26ea4512d3e8c85092638981b37864a762c93b020400dca564883941b5ec4",
    "scripts/codex/branch-recovery.ts": "sha256:63beb9e571de9bef0e5b0f5e97bf56c36e84bcad3ed1bb210637336a865d6419",
    "scripts/codex/ci-orchestration-core.ts": "sha256:2ae5c9f9170f3f9fa7b58e19498f2abc961ebb49ebefcfb9bed177a21819c577",
    "scripts/codex/document-control-plane-contract.ts": "sha256:adbeb71143a7bb6739c9763f511ecc4df176d1754767f6717ce5e100856baa08",
    "scripts/codex/document-control-plane-github-observation.ts": "sha256:76ad2c02d0c430265be1c2510bc363d93168852a0f9e4fb058b38d9d86ce921b",
    "scripts/codex/exact-git-blob.ts": "sha256:6ae6be01ceb2129f45243b9a75c91592f6579d9b1b933b50fbb9d650b9d8aed4",
    "scripts/codex/integration-authorization-publication.ts": "sha256:c88dd7fa63d12e5c238b72292b20055f48e2f1de49e7fabd46b212b653289de9",
    "scripts/codex/integration-authorization-status-github.ts": "sha256:b2131a418557cb18987ac2973ca52ad626032d1dfa048a79a58c1021c7dbcf88",
    "scripts/codex/issue-disposition-github.ts": "sha256:fe05b1fed0ec46e1af6b1363bf5695046d72757065802ef51242270a6ac4c0cf",
    "scripts/codex/local-github-actions-runner.ts": "sha256:20a6a059f1f3e89bfcfc8f64b32091f1c494313479f98e554ebd52b1da0761f3",
    "scripts/codex/local-main-closeout.ts": "sha256:c4f48d5497cce32607b21f4fa3b130e7e04b93ade7850158426709c90cf8a351",
    "scripts/codex/main-health-observation.ts": "sha256:694c10496f84868ee04a96ce340d7f5f271347770691773019b5da17acfe9b09",
    "scripts/codex/merge-gate.ts": "sha256:2c139cc0eb1a4ff41bd83fe8f84b0f3fc847af1aa83b0df7340e30d047498205",
    "scripts/codex/operation-read-plan.ts": "sha256:1b9dc658ca1bf292956a1dd6ab93eb9d995ec42784c2382e19c2614bf03395cd",
    "scripts/codex/skill-applicability.ts": "sha256:12a406b260e588bfa6423c1abfa2695446c4058f864fed502bbe908f543b3510",
    "scripts/codex/task-capsule.ts": "sha256:bf3deba3bfd4ad9ea4359c84df4182b62539ed939db3b5a5d2486242242e1339",
    "scripts/codex/trusted-runtime-closeout.ts": "sha256:57a8ed3e0899b1d8c5f280b60616e17cde140b359da71d6a5d7528489f69f255",
    "scripts/codex/trusted-runtime-container.ts": "sha256:237c7b9466ff5452b3720af96c993e5aa35df61fd5d2bc6907b47d202b5e0e84",
    "scripts/codex/verification-action-github-provider.ts": "sha256:be2a8337cefa9274c4adf2822b90e205c59bfd73fe228063a248c8ef1bb249cd",
    "scripts/codex/verification-provider-capability-ledger.ts": "sha256:3fec5e9372337d62e8906367126946ebddf54227e97af15ad86246a165818794",
    "scripts/codex/verification-session-github.ts": "sha256:7da0e018c0cf3e6c102234e8e75de6597d874441e53a25227e22b9924b50dad3",
    "scripts/codex/verification-session-journal.ts": "sha256:e4fdaeffb02627cd1518c088b22a97709587fc159afb65cd2a8a5eb025d7a9fe",
    "scripts/codex/verification-session-runtime.ts": "sha256:cf9604f56d33cf58f0e8296d174a23862a2271300c046ac1d972cf971da51dec",
    "scripts/codex/verification-session.ts": "sha256:2bf6246d01a953d2ebb949a07fc41f3f028333e46bc22667c69b6064b65e5c7b",
    "scripts/codex/work-package-contract.ts": "sha256:c8f79e2c9cbf292146139583dede05076f6936e15bc923bd4e7903103078ac3e",
    "scripts/codex/work-selection-main-health.ts": "sha256:9861dade5b8c3e9f3fc6295b5f196bff72d8dc86e5f472ce68c8c0c35e23eed9",
    "scripts/codex/work-selection.ts": "sha256:6ef5fde8078027e95a4b5f439904abae89c6341a45503f56657f683859be3253",
    "scripts/codex/worktree-physical-closeout-contract.ts": "sha256:65871321fa18ac012d493642ad4249f97781e19b57ad9806e2da8a92ab2a6ff9",
    "scripts/codex/worktree-physical-closeout.ts": "sha256:148f02f8a1da3261c9496d3169b8f8c4f324ead406c9511398d6653848dabe61",
    "scripts/install-git-hooks.ts": "sha256:effb6154d7b41002086df75dc4acea3eaa68cc92cbe99357307c937f8e73098f",
    "tests/setup/runtime-deps.setup.ts": "sha256:28881acc94cd963df0d47950a1bd5578ff12a7687721cfc18ef02ec9e67866a1",
    "tooling/sec-dev/runtime-state-authority.ts": "sha256:68a5d750dd0f6939fb03cdb38a7d265c42b2002d5d32d5b725529ba4698dba02",
    "tooling/sec-dev/runtime-state-journal-filesystem.ts": "sha256:415ac3adf76557b322dd12141822ad923b27a003e9f74c8a846248edb5ffb305",
    "tooling/sec-dev/runtime-state-paths.ts": "sha256:0f173a6c1bf52d672b1bb81ef711a3a9b34ae758afc59c32ffac0b5977d76f37",
    "tooling/sec-dev/verification-action-journal.ts": "sha256:cf4931b75bb5bbde0cc97a08bf5e7bc8128c0abf328bb6254c7063b03086e2b4",
    "tooling/sec-dev/verification-action-runner.ts": "sha256:27e30dd3e0e358554c5bb4f8dcca58d39f1950863951dd4c84e319089baaa8d8"
  },
  "closureDigest": "sha256:667467f04f40903b7926d57a50f6ced13d3909c89b839eb92373811b36086d28"
};

export const TCB_CLOSURE_LOCK_RECEIPT = createTcbClosureLockReceiptV2(
  TCB_CLOSURE_LOCK,
  "2026-08-21T20:09:15.304Z"
);
// </sec-tcb-closure-lock-generated-v2>

let resolvedTcbTrustRootV3: SecTrustedBootstrapTrustRootV3 | null = null;

function resolveTcbTrustRootV3(): SecTrustedBootstrapTrustRootV3 {
  resolvedTcbTrustRootV3 ??= createSecTrustedBootstrapTrustRootV3({
    registry: SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3,
    causalRuntimePaths: TCB_CLOSURE_LOCK.modules
  });
  return resolvedTcbTrustRootV3;
}

// The apply writer must be able to load the pure closure compiler while the
// checked-in lock is stale relative to an intentionally changed registry. No
// trust-root consumer receives a lenient view: the first property read derives
// and validates the complete registry + generated-lock composition.
export const TCB_TRUST_ROOT_V3: SecTrustedBootstrapTrustRootV3 = Object.freeze({
  get schema() { return resolveTcbTrustRootV3().schema; },
  get registry() { return resolveTcbTrustRootV3().registry; },
  get causalRuntimePaths() { return resolveTcbTrustRootV3().causalRuntimePaths; },
  get paths() { return resolveTcbTrustRootV3().paths; },
  get prefixes() { return resolveTcbTrustRootV3().prefixes; }
});
