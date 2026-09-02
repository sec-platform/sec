import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramEntrypointAddress,
  SourceProgramOperationIdentity,
  SourceProgramOperationProducerClosure
} from './contract.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import {
  resolveSourceProgramTypeScriptModuleExport
} from './typescript.ts';

const issuedProducerClosures = new WeakSet<object>();

export type SourceProgramOperationProducerClosureErrorCode =
  | 'entrypoint-export-unresolved'
  | 'entrypoint-not-unique'
  | 'operation-owner-not-unique'
  | 'producer-export-projection-unavailable'
  | 'reachable-file-absent'
  | 'reachable-graph-unresolved';

export class SourceProgramOperationProducerClosureError extends Error {
  readonly code: SourceProgramOperationProducerClosureErrorCode;

  constructor(code: SourceProgramOperationProducerClosureErrorCode, detail: string) {
    super(`Source Program operation producer closure ${code}: ${detail}`);
    this.name = 'SourceProgramOperationProducerClosureError';
    this.code = code;
  }
}

/** Compile the exact descriptor entrypoint and its reachable file graph for one operation. */
export function compileSourceProgramOperationProducerClosure(
  compilation: RepositorySourceProgramCompilationReceipt,
  operation: SourceProgramOperationIdentity
): SourceProgramOperationProducerClosure {
  assertRepositorySourceProgramCompilationReceipt(compilation);
  const snapshot = compilation.workspaceSnapshot;
  const owners = snapshot.moduleMembership.descriptors.filter((descriptor) => (
    descriptor.capabilityProviders.some((provider) => (
      provider.capability === operation.capability
      && provider.operations.includes(operation.operation)
    ))
  ));
  if (owners.length !== 1) {
    throw new SourceProgramOperationProducerClosureError(
      'operation-owner-not-unique',
      `${operation.capability}:${operation.operation}`
    );
  }

  const owner = owners[0]!;
  const fileByPath = new Map(snapshot.files.map((file) => [file.path, file]));
  const descriptorPath = `${owner.root}/sec.module.json`;
  const moduleExports = resolveSourceProgramTypeScriptModuleExport(
    compilation.typeScriptCompilation.model,
    owner.externalEntrypoints,
    operation.operation
  );
  if (moduleExports === null) {
    throw new SourceProgramOperationProducerClosureError(
      'producer-export-projection-unavailable',
      `${owner.moduleId}:${operation.operation}`
    );
  }
  const unresolvedOperationExports = moduleExports.flatMap((resolution) => (
    resolution.status === 'unresolved'
      ? [`${resolution.entrypointPath}:${operation.operation}:${resolution.reason}`]
      : []
  ));
  if (unresolvedOperationExports.length > 0) {
    throw new SourceProgramOperationProducerClosureError(
      'entrypoint-export-unresolved',
      unresolvedOperationExports.join(',')
    );
  }
  const operationEntrypoints = moduleExports
    .filter(({ status }) => status === 'resolved')
    .map(({ entrypointPath }) => entrypointPath)
    .sort(compareCodeUnits);
  if (operationEntrypoints.length !== 1) {
    throw new SourceProgramOperationProducerClosureError(
      'entrypoint-not-unique',
      `${owner.moduleId}:${operation.operation}`
    );
  }

  const reachable = new Set<string>([descriptorPath]);
  const frontier = [...operationEntrypoints];
  while (frontier.length > 0) {
    const repositoryPath = frontier.pop()!;
    if (reachable.has(repositoryPath)) continue;
    const file = fileByPath.get(repositoryPath);
    if (file === undefined) {
      throw new SourceProgramOperationProducerClosureError(
        'reachable-file-absent',
        repositoryPath
      );
    }
    if (snapshot.moduleGraph.unresolvedFiles.includes(repositoryPath)) {
      throw new SourceProgramOperationProducerClosureError(
        'reachable-graph-unresolved',
        repositoryPath
      );
    }
    reachable.add(repositoryPath);
    for (const dependency of snapshot.moduleGraph.directDependencies(repositoryPath)) {
      if (!reachable.has(dependency)) frontier.push(dependency);
    }
  }

  const files = Object.freeze([...reachable].sort(compareCodeUnits).map((repositoryPath) => {
    const file = fileByPath.get(repositoryPath);
    if (file === undefined) {
      throw new SourceProgramOperationProducerClosureError(
        'reachable-file-absent',
        repositoryPath
      );
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
