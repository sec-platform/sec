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
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2,
  matchSecTrustedBootstrapPathV2
} from './tcb-trust-root-contract.ts';

// ---------------------------------------------------------------------------
// TCB closure constants (canonical source — moved from sec-merge-gate.test.ts)
// ---------------------------------------------------------------------------

export const TCB_RUNTIME_ENTRYPOINTS = SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.runtimeEntrypoints;

export const TCB_REVIEWED_SUT_EDGES = new Set(
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.reviewedSutEdges
);

export const TCB_REVIEWED_BOUNDARY_EDGES = new Set(
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V2.reviewedBoundaryEdges
);

export const TCB_REVIEWED_EXTERNAL_IMPORTS = new Set([
  'platform/shared/heavy-verification-gate-lease.ts -> bun:ffi',
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
  'platform/dev-runner.ts::function-declaration:executeVerifiedCiActionPlanV1::Bun.spawn#1',
  'platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1',
  'platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1',
  'platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1',
  'platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1',
  'scripts/ci-verification.ts::function-declaration:CodexDevelopmentInspectHostedActionArchiveV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:defaultHostedSutSandboxProcessV1::spawn#1',
  'scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:gitCandidateBytesV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:hostedActionGhReadJsonV2::spawnSync#1',
  'scripts/ci-verification.ts::function-declaration:runHostedMaterializerCommandV2::spawnSync#1',
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
  'scripts/codex/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeupV2::spawnSync#1',
  'scripts/codex/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1',
  'scripts/codex/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1',
  'scripts/codex/verification-action-runner.ts::function-declaration:inspectLocalRepository>const-arrow:git::spawnSync#1',
  'scripts/codex/verification-session-github.ts::function-declaration:runVerificationSessionGh::spawnSync#1',
  'scripts/codex/verification-session.ts::function-declaration:runVerificationSessionCommand::spawnSync#1',
  'scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#1',
  'docs/scripts/docs-doctor.ts::function-declaration:readCapturedGitTreeBlob::spawnSync#1',
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
  observedExternalImports: Set<string> = new Set(),
  options: TcbClosureCandidateRootOptions = {}
): string[] {
  const candidateRoot = resolveTcbClosureCandidateRoot(options);
  return runtimeRelativeImportsAtCandidateRoot(
    candidateRoot,
    repositoryPath,
    reviewedProcessDispatchers,
    reviewedExternalImports,
    observedExternalImports
  );
}

function runtimeRelativeImportsAtCandidateRoot(
  candidateRoot: TcbClosureCandidateRootReader,
  repositoryPath: string,
  reviewedProcessDispatchers: Set<string>,
  reviewedExternalImports: Set<string>,
  observedExternalImports: Set<string>
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
    observedExternalImports
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
  observedExternalImports: Set<string>;
} {
  const closure = new Set<string>();
  const reviewedEdges = new Set<string>();
  const reviewedBoundaryEdges = new Set<string>();
  const reviewedExternalImports = new Set<string>();
  const reviewedProcessDispatchers = new Set<string>();
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
      observedExternalImports
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
    observedExternalImports
  };
}

export function matchesCanonicalTrustRoot(repositoryPath: string): boolean {
  return matchSecTrustedBootstrapPathV2(repositoryPath) !== null;
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
  const identityMaterial: TcbClosureLockIdentityMaterialV2 = {
    schema: 'sec-tcb-closure-lock-v2' as const,
    moduleCount: modules.length,
    modules,
    reviewedEdges,
    reviewedBoundaryEdges,
    reviewedExternalImports,
    reviewedProcessDispatchers,
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
  assertGeneratedExactKeysV2(value, [
    'schema',
    'trustRevision',
    'moduleCount',
    'modules',
    'reviewedEdges',
    'reviewedBoundaryEdges',
    'reviewedExternalImports',
    'reviewedProcessDispatchers',
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
  return computeTcbClosureLockAtCandidateRoot(candidateRoot, closure);
}

// ---------------------------------------------------------------------------
// Frozen lock — the CLI may replace only this marked region.
// ---------------------------------------------------------------------------

// <sec-tcb-closure-lock-generated-v2>
export const TCB_CLOSURE_TRUST_REVISION = "sha256:3cd33fa8aec0874732ad0c04fb87f81e6310c22071a48aea6fbeeb12223c55ba";

// Generated from the exact live causal closure. Do not hand-edit this marked region.
export const TCB_CLOSURE_LOCK: TcbClosureLock = {
  "schema": "sec-tcb-closure-lock-v2",
  "trustRevision": "sha256:3cd33fa8aec0874732ad0c04fb87f81e6310c22071a48aea6fbeeb12223c55ba",
  "moduleCount": 99,
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
    "platform/shared/ci-hosted-sut-observation-contract.ts",
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
    "platform/shared/integration-authorization-contract.ts",
    "platform/shared/issue-disposition-contract.ts",
    "platform/shared/main-health-contract.ts",
    "platform/shared/paths.ts",
    "platform/shared/platform-command.ts",
    "platform/shared/process.ts",
    "platform/shared/project-runtime.ts",
    "platform/shared/repository-path-contract.ts",
    "platform/shared/review-stability-contract.ts",
    "platform/shared/runtime-dependency-spec.ts",
    "platform/shared/runtime-layout.ts",
    "platform/shared/scope-authorization-contract.ts",
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
    "platform/shared/verification-scope-inventory.ts",
    "platform/shared/verification-session-contract.ts",
    "platform/shared/workspace-path-contract.ts",
    "platform/shared/workspace-write-lease.ts",
    "scripts/ci-pr-risk.ts",
    "scripts/ci-verification.ts",
    "scripts/ci-workspace-fast.ts",
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
    "scripts/codex/exact-git-blob.ts",
    "scripts/codex/integration-authorization-publication.ts",
    "scripts/codex/issue-disposition-github.ts",
    "scripts/codex/local-main-closeout.ts",
    "scripts/codex/merge-gate.ts",
    "scripts/codex/verification-action-github-provider.ts",
    "scripts/codex/verification-action-journal.ts",
    "scripts/codex/verification-action-runner.ts",
    "scripts/codex/verification-provider-capability-ledger.ts",
    "scripts/codex/verification-session-github.ts",
    "scripts/codex/verification-session-journal.ts",
    "scripts/codex/verification-session-runtime.ts",
    "scripts/codex/verification-session.ts",
    "scripts/codex/work-package-contract.ts",
    "scripts/install-git-hooks.ts",
    "tests/setup/runtime-deps.setup.ts"
  ],
  "reviewedEdges": [
    "scripts/ci-workspace-fast.ts -> platform/orchestrator.ts"
  ],
  "reviewedBoundaryEdges": [
    "scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts",
    "scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts"
  ],
  "reviewedExternalImports": [
    "platform/shared/heavy-verification-gate-lease.ts -> bun:ffi",
    "scripts/ci-verification.ts -> bun:ffi"
  ],
  "reviewedProcessDispatchers": [
    "docs/scripts/docs-doctor.ts::function-declaration:captureDocsDoctorIndexTree::spawnSync#1",
    "docs/scripts/docs-doctor.ts::function-declaration:readCapturedGitTreeBlob::spawnSync#1",
    "docs/scripts/docs-doctor.ts::function-declaration:resolveChangedDocumentPathsSince::spawnSync#1",
    "platform/dev-runner.ts::function-declaration:executeVerifiedCiActionPlanV1::Bun.spawn#1",
    "platform/dev-runner/command-runner.ts::function-declaration:runDevCommand::spawn#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:changedTypeScriptFiles::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitBytes::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:gitText::spawnSync#1",
    "platform/dev-runner/import-organizer.ts::function-declaration:tryResolveGitCommit::spawnSync#1",
    "platform/shared/process.ts::function-declaration:runCommandCapture::spawn#1",
    "platform/shared/process.ts::function-declaration:terminateCommandProcessTree::spawn#1",
    "scripts/ci-verification.ts::function-declaration:CodexDevelopmentInspectHostedActionArchiveV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:defaultGitFiles::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:defaultHostedSutSandboxProcessV1::spawn#1",
    "scripts/ci-verification.ts::function-declaration:gitCandidateBytesV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:hostedActionGhReadJsonV2::spawnSync#1",
    "scripts/ci-verification.ts::function-declaration:runHostedMaterializerCommandV2::spawnSync#1",
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
    "scripts/codex/verification-action-github-provider.ts::function-declaration:dispatchVerificationActionRepositoryWakeupV2::spawnSync#1",
    "scripts/codex/verification-action-github-provider.ts::function-declaration:ghBytes::spawnSync#1",
    "scripts/codex/verification-action-github-provider.ts::function-declaration:runProcessText::spawnSync#1",
    "scripts/codex/verification-action-runner.ts::function-declaration:inspectLocalRepository>const-arrow:git::spawnSync#1",
    "scripts/codex/verification-session-github.ts::function-declaration:runVerificationSessionGh::spawnSync#1",
    "scripts/codex/verification-session.ts::function-declaration:runVerificationSessionCommand::spawnSync#1",
    "scripts/install-git-hooks.ts::function-declaration:gitText::spawnSync#1"
  ],
  "moduleBlobs": {
    "docs/scripts/docs-doctor-ledgers.ts": "785b20e41f47c5646811d277f905878a75c47490",
    "docs/scripts/docs-doctor-shared.ts": "5b1aa8ae950b6cfe371f2c86e62a948d62bde911",
    "docs/scripts/docs-doctor.ts": "0a074b1fb733d1ccd9be06b15ba8ecb5f18e55b5",
    "platform/dev-runner.ts": "2950935d82e335d2c94af7a6746277465bbbaefc",
    "platform/dev-runner/check-runner.ts": "0532888b914a53c1e2601b82312d6abccfcf6bc3",
    "platform/dev-runner/command-runner.ts": "1153ba825e53727c8cc72f6727c2d7308a9df2f9",
    "platform/dev-runner/dependency-bootstrap.ts": "88e613911fcbb992bf780da3d0e635df85ed6a44",
    "platform/dev-runner/env-manager.ts": "67a3397e38b5fd754686787ed2d364828402e87c",
    "platform/dev-runner/fast-test-policy.ts": "09f1c023e7a3bb960fd237cf73ade98a11da9ed6",
    "platform/dev-runner/import-organizer.ts": "66ee53f11b5ce361663ff2440896c2fc07ada9c4",
    "platform/dev-runner/import-transform-transaction.ts": "1a0916434730596351437c347119523d301f5401",
    "platform/dev-runner/test-concurrency-policy.ts": "614dcca876dc8f15dfdcc265fdf33ce54c778e78",
    "platform/dev-runner/test-runner.ts": "d8d51aa962a430bb03fede7541d6cb20d2092e1a",
    "platform/dev-runner/typecheck-runner.ts": "022ab5222723f468ac7ab9d7611e64addfe52b0f",
    "platform/shared/active-documentation-contract.ts": "8894712cc4303fbc0a584029c5b4f6c00acf5ad8",
    "platform/shared/affected-test-inventory.ts": "03032e5d1a4a6a84d3d1c94fc897b6d0c3af31e6",
    "platform/shared/bun-runtime-version.ts": "8f0eb0d85daa5c6f7ddf0255512cee6d9af133ab",
    "platform/shared/canonical-primitives.ts": "960c2fc4cbf4c16034a2414d7c206db1d70d4941",
    "platform/shared/ci-artifact-contract.ts": "08a347391a575bab2e5fb46e5af5d16cc0182f1f",
    "platform/shared/ci-artifact-types.ts": "0b00a3e5f46f56708b4ee96fae3d7e451e5197b9",
    "platform/shared/ci-contract.ts": "f279fdb4736eddaee583016844fc7922a3bdd3c8",
    "platform/shared/ci-evidence-composition-policy-registry.ts": "440a2ec821b1e816759423ad8de5495875e1c99f",
    "platform/shared/ci-evidence-contract.ts": "57f25ad65d30913ca14442292b3ae75c122fcbaf",
    "platform/shared/ci-evidence-reuse-contract.ts": "671b19777e233533c87e6ce3b759b03bdcec1a2c",
    "platform/shared/ci-execution-environment.ts": "d39098bf12edaf89a630363852c8b9e34d34376a",
    "platform/shared/ci-git-changed-files.ts": "bf27b8ad4383390a24d93bc41a0a66de7f0ebac4",
    "platform/shared/ci-hosted-sut-observation-contract.ts": "c6820279c4832e9b669e3d07e3521b8a7151989a",
    "platform/shared/ci-pr-risk-selection.ts": "4f5c64469299042bee9d1ce8f7b489ad52014fca",
    "platform/shared/ci-verification-plan.ts": "a72aec25290bf9725761bf638543fb1508df8e98",
    "platform/shared/ci-verification-revision.ts": "1961aaf58b47f00922721831adee99148300fb80",
    "platform/shared/collections.ts": "8f8ecb1395714b83e995bcc560304ab1e0d9617f",
    "platform/shared/constants.ts": "78e19d1d79f8d6f5e729d66cb9ee74b4c6538088",
    "platform/shared/contract-freeze-contract.ts": "dcc6ea490001f528fda99787a41c81a330d5042d",
    "platform/shared/documentation-authority-contract.ts": "5d703f577d1c58b3812207776f6595be21ed802a",
    "platform/shared/errors.ts": "160c3b00d95d8457f59801762ae55c5f89e24784",
    "platform/shared/fs.ts": "cbf7dae627ff588418da759b581135864a3a2c10",
    "platform/shared/heavy-verification-gate-lease.ts": "27e4d5942c9b1467cb3a8df9d29b907eadc9be32",
    "platform/shared/integration-authorization-contract.ts": "18bc72e4ffb195c44baacc19707c93af7c49e53b",
    "platform/shared/issue-disposition-contract.ts": "e9da755b1f6f11ae2c98b3239d45d68f74a39316",
    "platform/shared/main-health-contract.ts": "57950ae0ca894acec277a8dddd1921f3c711ecac",
    "platform/shared/paths.ts": "9f224ae82ce73ea65691ec316afb3ec0a9a0964f",
    "platform/shared/platform-command.ts": "6a59e27518b3e5d0b8c17d4d2cda67a987d68ff3",
    "platform/shared/process.ts": "b75c14e9f05723ddbf1b82ae22303aa0c3f49def",
    "platform/shared/project-runtime.ts": "a7b651b6c57da078a148bb1c07b91dd9a1b25ffc",
    "platform/shared/repository-path-contract.ts": "0d655f17a56379651ed3da2de59048db43936f91",
    "platform/shared/review-stability-contract.ts": "83273c6c0eecb8196be66fbffd040b2cd215d731",
    "platform/shared/runtime-dependency-spec.ts": "26c48ef3c4c03c88aeca354a03955a220cb595c6",
    "platform/shared/runtime-layout.ts": "67d597cb2845aaa942e5a5e2d2457275dd17624e",
    "platform/shared/scope-authorization-contract.ts": "cbd15a4a0216c64f44b8e07bac84ebffd42b6625",
    "platform/shared/semantic-mutation-staging-boundary.ts": "87c3fc387147c0b41cfab0c1d176e88cbd00e1b9",
    "platform/shared/tcb-trust-root-contract.ts": "c80f655102f2b9f530bcefe70f1824deebbbcc5d",
    "platform/shared/test-budget-contract.ts": "55bbc0da6f967ef764b138bfcf7a06f6622ce395",
    "platform/shared/test-impact-contract.ts": "277a229bedee5d8aacfb639b5486d81a7a5858ef",
    "platform/shared/test-impact-rules/governance.ts": "3370fedb65c10a6112c33bfa3967bb4af42ac4f4",
    "platform/shared/test-impact-rules/pipeline.ts": "795ef711b12cf8b631dba3f17c07e20e4ef79c9c",
    "platform/shared/test-impact-rules/semantic.ts": "c5be3c5a69ae34115706a44dceb08b375dd91068",
    "platform/shared/test-impact-rules/verification.ts": "d3dc0d65fdb3ac2d42972b913ae960c9e48d4092",
    "platform/shared/test-ownership-contract.ts": "7f0397e7343dbd9cc69e3420973822e308eb8e0d",
    "platform/shared/verification-action-ci-contract.ts": "6ed975ac635d7c6f104a03c5fe14cffeb17d4180",
    "platform/shared/verification-action-contract.ts": "a2fa94d2757e4caa0067c072764e825c7eea9e43",
    "platform/shared/verification-action-provider-contract.ts": "7b8aafac41bd2413fd3c394f1ba568457cc789b3",
    "platform/shared/verification-provider-capability-contract.ts": "b8f26d701a4f679b3579e6e4cd447713b41ad3d3",
    "platform/shared/verification-result-contract.ts": "059b9fd5996beb95eaf7baaff5bea516fd8a3478",
    "platform/shared/verification-scope-inventory.ts": "68c3e1b7511dba0d5c7ee209639f330cdacc342c",
    "platform/shared/verification-session-contract.ts": "1a1cedc4264ede15887fdf9e629fcb7ca2eb6cdb",
    "platform/shared/workspace-path-contract.ts": "bf0efad0e2f0fe1036880c3aef7ec5c273639ff6",
    "platform/shared/workspace-write-lease.ts": "5d8a9f876cf6b5c0c20cd14559d13a7237a53e16",
    "scripts/ci-pr-risk.ts": "30d444e88161f76d45a2af87b26c6add566dcb87",
    "scripts/ci-verification.ts": "4fbee49671544e5a1fca27e5b2445cb86ba6d5cd",
    "scripts/ci-workspace-fast.ts": "053e4ddd2db47e8fed05dd39ed88fdaa1a818c23",
    "scripts/codex/branch-closeout-contract.ts": "e1267c00160e8796655ca02a1584de22947ce78c",
    "scripts/codex/branch-closeout-receipt.ts": "dad9aa9afebdebece60c726c0b146ecefbe1b639",
    "scripts/codex/branch-closeout.ts": "9190f6a8e6d5fea36366c5d126c636f76ba46dcd",
    "scripts/codex/branch-lifecycle-audit.ts": "2d45069a94ae70c143461798653c7f6c1a3a21ab",
    "scripts/codex/branch-lifecycle-command.ts": "0a43f79e0958fb3574521eba967c331cf82c8efb",
    "scripts/codex/branch-lifecycle-contract.ts": "7be4c7077921505915bd4e6ab53915570ad4dced",
    "scripts/codex/branch-lifecycle-health.ts": "d02460a4df8f2717ed7f23cbadfa180a7d339f6c",
    "scripts/codex/branch-lifecycle-inventory.ts": "9da4bf016e2dccdda50fe945c8a3c53056b3ad6d",
    "scripts/codex/branch-lifecycle-parsers.ts": "a7982dbae959b7f124a8f87ded62ae657181d768",
    "scripts/codex/branch-lifecycle-types.ts": "d0f343c3c4491265e6bfcfe0d096b7ad829a3b0c",
    "scripts/codex/branch-recovery.ts": "d2b86ae33a8c8b4312b19e809d3c8dfa281ce82d",
    "scripts/codex/ci-orchestration-core.ts": "7048c0e36e10a270c4fe646801bf4a2c3834fb91",
    "scripts/codex/document-control-plane-contract.ts": "115b966544fdb19769328563703253488cb5fac6",
    "scripts/codex/exact-git-blob.ts": "c31f795a85cecf3dc9cc1ed4426ef268b95468ba",
    "scripts/codex/integration-authorization-publication.ts": "102adb348bbbd33ea92d47b94676ce7e1bbedab8",
    "scripts/codex/issue-disposition-github.ts": "10aac92f5aadd8d8aa706bc74c11d3c86a7b9810",
    "scripts/codex/local-main-closeout.ts": "4772672fee4897a3cc908cd873032638367b1fdb",
    "scripts/codex/merge-gate.ts": "5da050dfed603f33922028f730018163be69b6e8",
    "scripts/codex/verification-action-github-provider.ts": "9d4c0f80077cc47c07ebebfad339303c4479d8bf",
    "scripts/codex/verification-action-journal.ts": "c5e7dd3b9a3c0770671bb39270f74b6fe9e41812",
    "scripts/codex/verification-action-runner.ts": "51657ff55d1e7b191ba16b4ffd0a38e9fa2785a1",
    "scripts/codex/verification-provider-capability-ledger.ts": "4dd028e20a7d975ba2f05dc23f384802c1e1a99d",
    "scripts/codex/verification-session-github.ts": "fd36f3a9dcd2b0512066d58e1f0a992ec21ca1cc",
    "scripts/codex/verification-session-journal.ts": "dc938985c8741825ec7864248bc9296fa907bf63",
    "scripts/codex/verification-session-runtime.ts": "8a9d67ee56294a606b2c215d45dbaffd45005f33",
    "scripts/codex/verification-session.ts": "53d3e8ed40a7be40fc6f399699b425456de5251a",
    "scripts/codex/work-package-contract.ts": "21775765b7cfc2fda1063f10672eb803e8e7f418",
    "scripts/install-git-hooks.ts": "b13fb3af64e67a67908698f4698002877aa7713b",
    "tests/setup/runtime-deps.setup.ts": "88b15eb0053a2af75bbefb00df3d09a6bd255e08"
  },
  "moduleContentDigests": {
    "docs/scripts/docs-doctor-ledgers.ts": "sha256:50abd7016e824d10a4fbd3a86373bc6dd9b2c4efdd0b0d7b3805dda669a42af6",
    "docs/scripts/docs-doctor-shared.ts": "sha256:ecf605db8782097832e6de3ca2336f4311a1519a766962e7677d3fafd0cb2132",
    "docs/scripts/docs-doctor.ts": "sha256:5d5d2f07ec53c71d708a73156d201ff47f307e213f6f3f303744697bf2fb4e87",
    "platform/dev-runner.ts": "sha256:1c304a46d93dba60c786efa284faf0e9af15483457a91ce5c45bdcbcb0b91f32",
    "platform/dev-runner/check-runner.ts": "sha256:ee8e03c72eafe284df4ac70f22ea19457f6a3fc1608f7aa26bf7cd0edf07e8bb",
    "platform/dev-runner/command-runner.ts": "sha256:b45598f646f81bfd06d3ac4c53997d068d17fb3959bf3f5ff75d98da2d63ae2e",
    "platform/dev-runner/dependency-bootstrap.ts": "sha256:d07fd219efbed34a326aa5d2766e15a7f944d2102bafc8fee1857f2d87e4d794",
    "platform/dev-runner/env-manager.ts": "sha256:4d39bc7584603d4bb984a568428bae685d60d2381faaf848935730eef4103f56",
    "platform/dev-runner/fast-test-policy.ts": "sha256:103a7e5b1187d227d653bed08168cff00f8b507e4c6f6f2e868e70005752f211",
    "platform/dev-runner/import-organizer.ts": "sha256:b165a145166294cc9ef69ee7f8f242ead68d8b7e0aa4cff10d37db4bf08438cf",
    "platform/dev-runner/import-transform-transaction.ts": "sha256:050d3e474c81cb1b31f23974f7df160f78384b791f49076f894c797473a07c76",
    "platform/dev-runner/test-concurrency-policy.ts": "sha256:b0ae5d1f29a528dadf2bd7d91e703e1753baf4991aeb5d65940c05d4f8cf2e4f",
    "platform/dev-runner/test-runner.ts": "sha256:da1a9245bbdc34c84eca1f9204e3b70b9e17d48d6039b8f5428c0e5cdf324036",
    "platform/dev-runner/typecheck-runner.ts": "sha256:3f11a7044ad184445620c3e51362e929c0b2e48d9bcb39b9205a239e8843de8f",
    "platform/shared/active-documentation-contract.ts": "sha256:5990c41ce11be18985b63876c912819240ed9e1f3345e93e1856d43dda1e3e1f",
    "platform/shared/affected-test-inventory.ts": "sha256:a4b85dbc8ac4542b6f0a78e2379aec84a646e0cebdfca0c3ce9d66c67134f421",
    "platform/shared/bun-runtime-version.ts": "sha256:56f352fcbbbc189dba528aaa520086edaaaa54ebe9671be6be234c78d2867434",
    "platform/shared/canonical-primitives.ts": "sha256:5bf7be826e00e5becfbfb0d5395cb03d0c1f9adbec64bd536e4ff6e5f62d38a3",
    "platform/shared/ci-artifact-contract.ts": "sha256:95c4f4ade4a9077f66a98eb5a66c9ea09a15bf4da9d31117f2555f62b93388b0",
    "platform/shared/ci-artifact-types.ts": "sha256:02da37c0130e85dc4289a1ae0aa99d746fa0dac8e541bbe0d86856c2823ca242",
    "platform/shared/ci-contract.ts": "sha256:e606685cc7e65032357f1b051e2e0a2b2871d4ddbf82eeaa27e4951e815d1bd9",
    "platform/shared/ci-evidence-composition-policy-registry.ts": "sha256:f19706e8b83415e80b44b6e54577500b03994dbb381f374c227ba96a2c53bb5d",
    "platform/shared/ci-evidence-contract.ts": "sha256:da254087321b3aba653ed57cb087188c73ce252f09b16d10c482b8974a720bc1",
    "platform/shared/ci-evidence-reuse-contract.ts": "sha256:df74f9439c07f31601dcd2ed5166f2118768795acde2684b59f329a3f02a0a9c",
    "platform/shared/ci-execution-environment.ts": "sha256:b5dad090ac0b540bac75be683a62f745f07d4de39edd08017b3d74c2298d4240",
    "platform/shared/ci-git-changed-files.ts": "sha256:ca7dd603e05e05fe0e061c1406c8c1f728fac359d3ad8f27501f24f65b458098",
    "platform/shared/ci-hosted-sut-observation-contract.ts": "sha256:b304fa26a0a579364818bbf71b6eed8ed5ae595dbca186d430084115b09946c6",
    "platform/shared/ci-pr-risk-selection.ts": "sha256:28fca7c9edf69fac98e6a4aeca9239c9d1898a23f37e2d34a029b36861436848",
    "platform/shared/ci-verification-plan.ts": "sha256:1b3894beb2f8facb29ec188085720772fc8cc22d6bf14b36a85489355c082b76",
    "platform/shared/ci-verification-revision.ts": "sha256:6fec09561e06db6b93ed6d940f8653de4acd4ed54b2a0dd630c728bbdbc72194",
    "platform/shared/collections.ts": "sha256:8ff70a8bb6f89ba8355d900648d13caa4cc756542d808b7cf7e25efa5886bed4",
    "platform/shared/constants.ts": "sha256:bff35d03ea929d90b6f23a4246919011271bb86f0710cc86f51692ca51af26b5",
    "platform/shared/contract-freeze-contract.ts": "sha256:294ddf1a68d00ac41bff7b117a8e8882f918542e2ea4efe5eb06f8289edceb54",
    "platform/shared/documentation-authority-contract.ts": "sha256:98c98a6a75b3468e4f7657f5077350128edf8e865e717a376a2b6038a209062c",
    "platform/shared/errors.ts": "sha256:6f2c91d5dda872f56f6e344d2b18a8cbf00fd1ffe3b46d5d36e48b11344c7e15",
    "platform/shared/fs.ts": "sha256:a224bb682431c521432c2c35829af3ef8f797a644b176fd9199cf49f6bc4a243",
    "platform/shared/heavy-verification-gate-lease.ts": "sha256:381f6de4f81b27e6fa6950bc76153d7dba03a9f38739c142e35bb57009d809a4",
    "platform/shared/integration-authorization-contract.ts": "sha256:3d121feb0ac7a8eb48a15becb19d314ad5c4c8486ab154320ac4a8d328c51807",
    "platform/shared/issue-disposition-contract.ts": "sha256:f1ee7831fa3424a82ec5b894ce495b2fe6c4bf6d282fe56c46bff9bb275b9a99",
    "platform/shared/main-health-contract.ts": "sha256:e80d2ee9cb08e196c10adbc27e81c1d35de20cccb467b9fe421c9216b57e8ff7",
    "platform/shared/paths.ts": "sha256:82737bda5c4efa4f0338d3c3a3434a23daefd9918f440cddd044da62de2e0d20",
    "platform/shared/platform-command.ts": "sha256:dbb654a1697a0d73892b55bbd488f9fc2006a1fafe80f22fb82b8e0e15ba1a9c",
    "platform/shared/process.ts": "sha256:de6846b34674ba96a409b3769083d3a427939fcacfb9c437b59fe612e7493660",
    "platform/shared/project-runtime.ts": "sha256:02b26befcc432bba4055f8b78ffd53f84493b599f51e748a47c44f9e20ee5562",
    "platform/shared/repository-path-contract.ts": "sha256:262d0d7b19105bb20c232b88e0f71de0987956374034bb80f3548d92e27454ba",
    "platform/shared/review-stability-contract.ts": "sha256:ec612772c46a23122a5a208ab8a71ef50c71057f31b8482b47bc48596311db40",
    "platform/shared/runtime-dependency-spec.ts": "sha256:f41eb62d9ed4c8beb3655210719fff1ecd324d44a198bbdad3280959b7210f5d",
    "platform/shared/runtime-layout.ts": "sha256:6b7a07641c2504b9a4a2e588483e9e47fddcab308547df4cc10e9000dc2420d0",
    "platform/shared/scope-authorization-contract.ts": "sha256:fbea121ea41c47ecc5e679e8f5ab935342be9f5c724280185bb2d57879fb2e1c",
    "platform/shared/semantic-mutation-staging-boundary.ts": "sha256:c1a6db054e6f73b2792b8aa81a8938e1ec276127415f31f42f65838d39984145",
    "platform/shared/tcb-trust-root-contract.ts": "sha256:abbccc93ccef53143870110ebcdbd7a70ee89e7c4af6404e1ac36b45cab6f3ac",
    "platform/shared/test-budget-contract.ts": "sha256:dd1d4330c461ec58568e2af74a09aa2151fec9dd5f010eed8d38e06b9c1f856e",
    "platform/shared/test-impact-contract.ts": "sha256:9d0fb869dfa226a502a06c1fe8b396b528dd977492084f07cd251653f1a122db",
    "platform/shared/test-impact-rules/governance.ts": "sha256:c709540823796895872e9d0d488d79862359cb9abea68352cda5fffe75cc1ebb",
    "platform/shared/test-impact-rules/pipeline.ts": "sha256:60230c98d9aecf6eade848528a6cf097766f6bdfa38f27b3e584d0a385f23981",
    "platform/shared/test-impact-rules/semantic.ts": "sha256:711d4b45d0bb7d91dc09d7e637e671cf1e6024654f64b3a2dd23b20abdeabb72",
    "platform/shared/test-impact-rules/verification.ts": "sha256:8cf3774474d93b6ed656190d73d177d3af6c846e323ca8ed71ed71abf2d7327f",
    "platform/shared/test-ownership-contract.ts": "sha256:622ab63efb28ce13e2023b7e08da72a63b01b2a1c030b70b221327cd5ffda5c7",
    "platform/shared/verification-action-ci-contract.ts": "sha256:e3e28a0e6855ee8c540f32aa35e7341c9588283c8ed13d821c64aa6337941eec",
    "platform/shared/verification-action-contract.ts": "sha256:266241ad4eaa75bb58e2ec9c1e3cc04b36a283d82a6a668cf5f874e9732003b9",
    "platform/shared/verification-action-provider-contract.ts": "sha256:b530f7f683dd7d0c1952f094f729a3add2b6e8e619987f08c5791aa717bbdea8",
    "platform/shared/verification-provider-capability-contract.ts": "sha256:0a137da968f97c76125e183d85e47bc20b211bc15a740d9f2f8d7757c910dc67",
    "platform/shared/verification-result-contract.ts": "sha256:a226b4a0c7475f0fa45f90eb485b697e9751b6f923d2a67f54dbaef9e8720f9c",
    "platform/shared/verification-scope-inventory.ts": "sha256:94b1fb0e198662868b1a658cc6932fb0f5027784cd585fc01c606e97fa209e59",
    "platform/shared/verification-session-contract.ts": "sha256:f3e0580c99a68ed24f44b56c348423328b2b3bf7f57b265d750615eb576016d9",
    "platform/shared/workspace-path-contract.ts": "sha256:65235f9548e99be1e6b333bb3b018dc7e4eeaf866b7fb052db64b9fdef9df364",
    "platform/shared/workspace-write-lease.ts": "sha256:12286e61c0283b197279d14115a689c7d22a0e3f255ae71c3f59bed2b9534ff4",
    "scripts/ci-pr-risk.ts": "sha256:47cad822bddd8e10a90e257b92b505ed12fe03597938474dfdbb5b56acd85ed6",
    "scripts/ci-verification.ts": "sha256:4daaa2096f0084e9d94043e79591ac0a67092bfb1ed106f6abc4afe128951ba0",
    "scripts/ci-workspace-fast.ts": "sha256:a4500b0271ae1251600c1656495a0f970615d229b6ab7cbce885dead0af01d9c",
    "scripts/codex/branch-closeout-contract.ts": "sha256:4c3256b7a30505e554b850412dd01fd283bf704ea793485fe363aba024bb0eca",
    "scripts/codex/branch-closeout-receipt.ts": "sha256:dc8381e6f14dbc5f43d330efa6b9a67a89b92ab373671f22150ff46a1e051314",
    "scripts/codex/branch-closeout.ts": "sha256:be4262765ca9675e2e75242be69301b321f7204a826b5111aff71821dc8d53a9",
    "scripts/codex/branch-lifecycle-audit.ts": "sha256:f8c453575ef58f49613b5cb79f75cc1377c08ef696866b0ca8b42bd950f6571b",
    "scripts/codex/branch-lifecycle-command.ts": "sha256:35b5bc3ed084b19ce57801b98498d9f169aca9ef0aa2f70a3329da43dcaf6275",
    "scripts/codex/branch-lifecycle-contract.ts": "sha256:c40c8a3474585087f70a5f38200be923ccc9e8f43bc8b811bf14535825758b48",
    "scripts/codex/branch-lifecycle-health.ts": "sha256:4b56e90ac0899279f9637d711d25b403b0a2c23030a6eef1e5d5aa32994811c7",
    "scripts/codex/branch-lifecycle-inventory.ts": "sha256:03afdfc56205ef1d823a399a70fde9d1346f9d52262dbc873cd3219011a880e5",
    "scripts/codex/branch-lifecycle-parsers.ts": "sha256:4d18ec803915553ea928dd779de0011174889eaa27b6154a28c6b0bf697b6ad0",
    "scripts/codex/branch-lifecycle-types.ts": "sha256:fff26ea4512d3e8c85092638981b37864a762c93b020400dca564883941b5ec4",
    "scripts/codex/branch-recovery.ts": "sha256:63beb9e571de9bef0e5b0f5e97bf56c36e84bcad3ed1bb210637336a865d6419",
    "scripts/codex/ci-orchestration-core.ts": "sha256:0e727c9a4d2530c22a954615af2b77a41b9e2023a7ef203989694fddb60ba336",
    "scripts/codex/document-control-plane-contract.ts": "sha256:7a1a8b69aefcc33ebd8a22978676d9bdd6240289539261d73ef357a95627554f",
    "scripts/codex/exact-git-blob.ts": "sha256:6bd0052de607521e2a6f1d982de8facbdec5def749af5d1749370ebd5f0269b5",
    "scripts/codex/integration-authorization-publication.ts": "sha256:b787d0dfa738d77984864c37da8251c6faae1e27e195136e7cf08d8fee49661b",
    "scripts/codex/issue-disposition-github.ts": "sha256:fe05b1fed0ec46e1af6b1363bf5695046d72757065802ef51242270a6ac4c0cf",
    "scripts/codex/local-main-closeout.ts": "sha256:c4f48d5497cce32607b21f4fa3b130e7e04b93ade7850158426709c90cf8a351",
    "scripts/codex/merge-gate.ts": "sha256:b80495c21ae16bdabc8f0b3a5e9507afc262a19bc2c86650c01b834a6ee001d9",
    "scripts/codex/verification-action-github-provider.ts": "sha256:de24725a9b778f3e2ec75a91df33fe63222992d10f0873bf2e9147fa854185ef",
    "scripts/codex/verification-action-journal.ts": "sha256:8cdba9e94f7785e9f6eff29027b97b50beee40ed210c1f1646b41bea59099ac2",
    "scripts/codex/verification-action-runner.ts": "sha256:0261873866177c291028072615d1703807952be947fd2f73237c1a617d9249a6",
    "scripts/codex/verification-provider-capability-ledger.ts": "sha256:3fec5e9372337d62e8906367126946ebddf54227e97af15ad86246a165818794",
    "scripts/codex/verification-session-github.ts": "sha256:11ee9e41a270d020cdacdd7fd2d4814eca58cc9d2a14c5eebcd34f99568c7d5a",
    "scripts/codex/verification-session-journal.ts": "sha256:d85e4eaf49ec509227a977e4ad322a24032967e01167b07690ad1222e505f29b",
    "scripts/codex/verification-session-runtime.ts": "sha256:9b44a9494ee0a7f32b3306f25ac6c734cb209ba62ceb98c38aae085fe94b6404",
    "scripts/codex/verification-session.ts": "sha256:bfcad919c9bc097cac369920da7bd2822b8110ae20510925be9b2901355c2c55",
    "scripts/codex/work-package-contract.ts": "sha256:802dbb0f940a4f278d6cccb299cc4f955a162816550314e910a330a9bcaf08f4",
    "scripts/install-git-hooks.ts": "sha256:effb6154d7b41002086df75dc4acea3eaa68cc92cbe99357307c937f8e73098f",
    "tests/setup/runtime-deps.setup.ts": "sha256:6e6887ffcb8fead51f11fe8b223789f71a9512bd0805313c01035ec035c01441"
  },
  "closureDigest": "sha256:b0dced8e097d62812acc1c5d4db6e1af3813b99fe400b6785cbbc16a5f9c5de3"
};

export const TCB_CLOSURE_LOCK_RECEIPT = createTcbClosureLockReceiptV2(
  TCB_CLOSURE_LOCK,
  "2026-08-11T18:21:35.052Z"
);
// </sec-tcb-closure-lock-generated-v2>
