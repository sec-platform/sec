import ts from 'typescript';

import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramEntrypointAddress,
  SourceProgramOperationIdentity,
  SourceProgramOperationProducerClosure
} from './contract.ts';
import {
  assertWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const issuedProducerClosures = new WeakSet<object>();

function exportsOperation(sourcePath: string, source: string, operation: string): boolean {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, false);
  return file.statements.some((statement) => {
    const exported = ts.canHaveModifiers(statement)
      && ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
    if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))) {
      return statement.name?.text === operation;
    }
    if (exported && ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some(({ name }) => (
        ts.isIdentifier(name) && name.text === operation
      ));
    }
    return ts.isExportDeclaration(statement)
      && statement.exportClause !== undefined
      && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some(({ name }) => name.text === operation);
  });
}

/** Compile the exact descriptor entrypoint and its reachable file graph for one operation. */
export function compileSourceProgramOperationProducerClosure(
  snapshot: WorkspaceSourceSnapshot,
  operation: SourceProgramOperationIdentity
): SourceProgramOperationProducerClosure {
  assertWorkspaceSourceSnapshot(snapshot);
  const owners = snapshot.moduleMembership.descriptors.filter((descriptor) => (
    descriptor.capabilityProviders.some((provider) => (
      provider.capability === operation.capability
      && provider.operations.includes(operation.operation)
    ))
  ));
  if (owners.length !== 1) {
    throw new Error(
      `Source Program operation must resolve to one descriptor owner: `
      + `${operation.capability}:${operation.operation}`
    );
  }

  const owner = owners[0]!;
  const fileByPath = new Map(snapshot.files.map((file) => [file.path, file]));
  const descriptorPath = `${owner.root}/sec.module.json`;
  const operationEntrypoints = owner.externalEntrypoints.filter((repositoryPath) => {
    const source = fileByPath.get(repositoryPath)?.source;
    return source !== undefined && exportsOperation(repositoryPath, source, operation.operation);
  });
  if (operationEntrypoints.length !== 1) {
    throw new Error(
      `Source Program operation must resolve to one exact exported entrypoint: `
      + `${owner.moduleId}:${operation.operation}`
    );
  }

  const reachable = new Set<string>([descriptorPath]);
  const frontier = [...operationEntrypoints];
  while (frontier.length > 0) {
    const repositoryPath = frontier.pop()!;
    if (reachable.has(repositoryPath)) continue;
    const file = fileByPath.get(repositoryPath);
    if (file === undefined) {
      throw new Error(`Source Program operation entrypoint is absent: ${repositoryPath}`);
    }
    if (snapshot.moduleGraph.unresolvedFiles.includes(repositoryPath)) {
      throw new Error(`Source Program operation reachable graph is unresolved: ${repositoryPath}`);
    }
    reachable.add(repositoryPath);
    for (const dependency of snapshot.moduleGraph.directDependencies(repositoryPath)) {
      if (!reachable.has(dependency)) frontier.push(dependency);
    }
  }

  const files = Object.freeze([...reachable].sort(compareCodeUnits).map((repositoryPath) => {
    const file = fileByPath.get(repositoryPath);
    if (file === undefined) {
      throw new Error(`Source Program operation closure has no exact file digest: ${repositoryPath}`);
    }
    return Object.freeze({ path: repositoryPath, contentDigest: file.contentDigest });
  }));
  const entrypointAddresses = Object.freeze(operationEntrypoints.map((targetPath) => (
    `module-entrypoint:${descriptorPath}#${owner.moduleId}:${targetPath}`
  ) as SourceProgramEntrypointAddress));
  const unsigned = Object.freeze({
    operation: Object.freeze({
      capability: operation.capability,
      operation: operation.operation
    }),
    moduleId: owner.moduleId,
    entrypointAddresses,
    files
  });
  const closure = Object.freeze({
    ...unsigned,
    closureDigest: sha256(unsigned) as `sha256:${string}`
  }) as SourceProgramOperationProducerClosure;
  issuedProducerClosures.add(closure);
  return closure;
}

export function requireSourceProgramOperationProducerClosure(
  value: unknown
): SourceProgramOperationProducerClosure {
  if (value === null || typeof value !== 'object' || !issuedProducerClosures.has(value)) {
    throw new Error('Operation producer closure is not Source Program compiler-issued');
  }
  return value as SourceProgramOperationProducerClosure;
}
