import {
  compareCodeUnits,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import type {
  SourceProgramEntrypointAddress,
  SourceProgramModel,
  SourceProgramOperationIdentity,
  OperationProducerClosure,
  SourceProgramOperationSourceEvidence
} from './contract.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import {
  compileTypeScriptModel,
  isRuntimeBuiltinModuleSpecifier,
  resolveTypeScriptModuleExport
} from './typescript.ts';
import {
  assertWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const issuedProducerClosures = new WeakSet<object>();

export type ProducerClosureErrorCode =
  | 'entrypoint-export-unresolved'
  | 'entrypoint-not-unique'
  | 'operation-owner-not-unique'
  | 'producer-export-projection-unavailable'
  | 'reachable-file-absent'
  | 'reachable-file-digest-mismatch'
  | 'reachable-graph-unresolved'
  | 'reachable-loader-resource-unresolved';

export class ProducerClosureError extends Error {
  readonly code: ProducerClosureErrorCode;

  constructor(code: ProducerClosureErrorCode, detail: string) {
    super(`Source Program operation producer closure ${code}: ${detail}`);
    this.name = 'SourceProgramOperationProducerClosureError';
    this.code = code;
  }
}

function sourceEvidence(
  file: RepositorySourceProgramCompilationReceipt['workspaceSnapshot']['files'][number]
): SourceProgramOperationSourceEvidence {
  if (rawSha256(file.source) !== file.contentDigest) {
    throw new ProducerClosureError(
      'reachable-file-digest-mismatch',
      file.path
    );
  }
  return Object.freeze({
    path: file.path,
    source: file.source,
    contentDigest: file.contentDigest as `sha256:${string}`
  });
}

function compileOperationProducerClosure(
  snapshot: WorkspaceSourceSnapshot,
  typeScriptModel: SourceProgramModel,
  operation: SourceProgramOperationIdentity
): OperationProducerClosure {
  const owners = snapshot.moduleMembership.descriptors.filter((descriptor) => (
    descriptor.capabilityProviders.some((provider) => (
      provider.capability === operation.capability
      && provider.operations.includes(operation.operation)
    ))
  ));
  if (owners.length !== 1) {
    throw new ProducerClosureError(
      'operation-owner-not-unique',
      `${operation.capability}:${operation.operation}`
    );
  }

  const owner = owners[0]!;
  const fileByPath = new Map(snapshot.files.map((file) => [file.path, file]));
  const descriptorPath = `${owner.root}/module.json`;
  const moduleExports = resolveTypeScriptModuleExport(
    typeScriptModel,
    owner.externalEntrypoints,
    operation.operation
  );
  if (moduleExports === null) {
    throw new ProducerClosureError(
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
    throw new ProducerClosureError(
      'entrypoint-export-unresolved',
      unresolvedOperationExports.join(',')
    );
  }
  const operationEntrypoints = moduleExports
    .filter(({ status }) => status === 'resolved')
    .map(({ entrypointPath }) => entrypointPath)
    .sort(compareCodeUnits);
  if (operationEntrypoints.length !== 1) {
    throw new ProducerClosureError(
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
      throw new ProducerClosureError(
        'reachable-file-absent',
        repositoryPath
      );
    }
    if (snapshot.moduleGraph.unresolvedFiles.includes(repositoryPath)) {
      throw new ProducerClosureError(
        'reachable-graph-unresolved',
        repositoryPath
      );
    }
    reachable.add(repositoryPath);
    for (const dependency of snapshot.moduleGraph.directRuntimeDependencies(repositoryPath)) {
      if (!reachable.has(dependency)) frontier.push(dependency);
    }
  }

  const unresolvedLoaders = [
    ...typeScriptModel.unknowns
      .filter(({ code, path }) => reachable.has(path)
        && (code === 'dynamic-module-unresolved' || code === 'dynamic-runtime-opaque'))
      .map(({ code, detail, path }) => `${path}:${code}:${detail}`),
    ...snapshot.moduleGraph.references
      .filter(({ from, kind, resolvedTarget }) => reachable.has(from)
        && kind !== 'static'
        && resolvedTarget === null)
      .filter(({ specifier }) => !isRuntimeBuiltinModuleSpecifier(specifier))
      .map(({ from, kind, specifier }) => `${from}:${kind}:${specifier}`)
  ].sort(compareCodeUnits);
  if (unresolvedLoaders.length > 0) {
    throw new ProducerClosureError(
      'reachable-loader-resource-unresolved',
      unresolvedLoaders.join(',')
    );
  }

  const implementationFiles = Object.freeze([...reachable]
    .filter((repositoryPath) => repositoryPath !== descriptorPath)
    .sort(compareCodeUnits)
    .map((repositoryPath) => {
      const file = fileByPath.get(repositoryPath);
      if (file === undefined) {
        throw new ProducerClosureError(
          'reachable-file-absent',
          repositoryPath
        );
      }
      return sourceEvidence(file);
    }));
  const descriptorFile = fileByPath.get(descriptorPath);
  const entrypointFile = fileByPath.get(operationEntrypoints[0]!);
  if (descriptorFile === undefined || entrypointFile === undefined) {
    throw new ProducerClosureError(
      'reachable-file-absent',
      descriptorFile === undefined ? descriptorPath : operationEntrypoints[0]!
    );
  }
  const descriptor = sourceEvidence(descriptorFile);
  const entrypointEvidence = sourceEvidence(entrypointFile);
  const entrypoint = Object.freeze({
    ...entrypointEvidence,
    address: (
      `module-entrypoint:${descriptorPath}#${owner.moduleId}:${entrypointEvidence.path}`
    ) as SourceProgramEntrypointAddress
  });
  const unsigned = Object.freeze({
    authority: 'source-evidence-only' as const,
    operation: Object.freeze({
      capability: operation.capability,
      operation: operation.operation
    }),
    moduleId: owner.moduleId,
    descriptor,
    entrypoint,
    implementationFiles
  });
  const closure = Object.freeze({
    ...unsigned,
    closureDigest: sha256(unsigned) as `sha256:${string}`
  }) as OperationProducerClosure;
  issuedProducerClosures.add(closure);
  return closure;
}

/** Compile the exact descriptor entrypoint and its reachable file graph for one operation. */
export function compileProducerClosure(
  compilation: RepositorySourceProgramCompilationReceipt,
  operation: SourceProgramOperationIdentity
): OperationProducerClosure {
  assertRepositorySourceProgramCompilationReceipt(compilation);
  return compileOperationProducerClosure(
    compilation.workspaceSnapshot,
    compilation.typeScriptCompilation.model,
    operation
  );
}

/**
 * Compile only the owner-declared entrypoint surface needed to identify one
 * operation producer. The workspace snapshot remains the single module graph
 * and source-byte authority; this projection reuses the canonical TypeScript
 * compiler solely for export/re-export semantics and deliberately does not
 * assemble repository, test, or placement projections.
 */
export function compileProducerClosureFromSnapshot(
  snapshot: WorkspaceSourceSnapshot,
  operation: SourceProgramOperationIdentity
): OperationProducerClosure {
  assertWorkspaceSourceSnapshot(snapshot);
  const owners = snapshot.moduleMembership.descriptors.filter((descriptor) => (
    descriptor.capabilityProviders.some((provider) => (
      provider.capability === operation.capability
      && provider.operations.includes(operation.operation)
    ))
  ));
  if (owners.length !== 1) {
    throw new ProducerClosureError(
      'operation-owner-not-unique',
      `${operation.capability}:${operation.operation}`
    );
  }
  const owner = owners[0]!;
  const reachable = new Set<string>();
  const frontier = [...owner.externalEntrypoints];
  while (frontier.length > 0) {
    const repositoryPath = frontier.pop()!;
    if (reachable.has(repositoryPath)) continue;
    reachable.add(repositoryPath);
    for (const dependency of snapshot.moduleGraph.directRuntimeDependencies(repositoryPath)) {
      if (!reachable.has(dependency)) frontier.push(dependency);
    }
  }
  const files = snapshot.files.filter(({ path }) => reachable.has(path));
  if (files.length !== reachable.size) {
    const available = new Set(files.map(({ path }) => path));
    const absent = [...reachable].filter((path) => !available.has(path)).sort(compareCodeUnits);
    throw new ProducerClosureError(
      'reachable-file-absent',
      absent.join(',')
    );
  }
  const typeScriptModel = compileTypeScriptModel({
    sourceRevision: snapshot.sourceRevision,
    files,
    moduleMembership: snapshot.moduleMembership
  });
  return compileOperationProducerClosure(snapshot, typeScriptModel, operation);
}

export function requireProducerClosure(
  value: unknown
): OperationProducerClosure {
  if (value === null || typeof value !== 'object' || !issuedProducerClosures.has(value)) {
    throw new Error('Operation producer closure is not Source Program compiler-issued');
  }
  return value as OperationProducerClosure;
}
