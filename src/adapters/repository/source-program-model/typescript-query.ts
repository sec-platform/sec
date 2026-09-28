import type {
  SourceProgramModel,
  SourceProgramQueryResult
} from './contract.ts';

/** Read-only semantic queries over an already-issued Source Program model. */
export function querySourceProgramModel(
  model: SourceProgramModel,
  query: string
): SourceProgramQueryResult {
  const normalized = query.trim().toLocaleLowerCase('en-US');
  if (normalized.length === 0) throw new Error('Source Program Model query cannot be blank');
  const includes = (value: string): boolean => value.toLocaleLowerCase('en-US').includes(normalized);
  const declarations = model.declarations.filter((entry) => includes(entry.name) || includes(entry.path));
  const declarationIds = new Set(declarations.map(({ observationId }) => observationId));
  return Object.freeze({
    query,
    declarations: Object.freeze(declarations),
    references: Object.freeze(model.references.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || (entry.targetObservationId !== null && declarationIds.has(entry.targetObservationId))
    )),
    literals: Object.freeze(model.literals.filter((entry) => includes(entry.value) || includes(entry.path))),
    entrypoints: Object.freeze(model.entrypoints.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || includes(entry.command ?? '')
      || entry.targetEntrypoints.some(includes)
      || entry.targetPaths.some(includes)
      || entry.targetPackages.some(includes)
    )),
    entrypointClosures: Object.freeze(model.entrypointClosures.filter((entry) =>
      includes(entry.name)
      || includes(entry.path)
      || entry.targetPaths.some(includes)
      || entry.targetPackages.some(includes)
      || entry.reachablePaths.some(includes)
      || entry.capabilityPaths.some(includes)
      || entry.transports.some(includes)
      || entry.providerModuleIds.some(includes)
      || entry.unknownPaths.some(includes)
    )),
    packages: Object.freeze(model.packages.filter((entry) =>
      includes(entry.name) || includes(entry.manifestPath)
    )),
    dependencies: Object.freeze(model.dependencies.filter((entry) =>
      includes(entry.name)
      || includes(entry.manifestPath)
      || entry.consumerPaths.some(includes)
    )),
    capabilities: Object.freeze(model.capabilities.filter((entry) =>
      includes(entry.capability)
      || includes(entry.operation)
      || includes(entry.subject ?? '')
      || includes(entry.path)
    )),
    candidates: Object.freeze(model.candidates.filter((entry) =>
      includes(entry.code)
      || includes(entry.subject)
      || includes(entry.reason)
      || entry.paths.some(includes)
    )),
    files: Object.freeze(model.files.filter((entry) => includes(entry.path) || includes(entry.moduleId ?? ''))),
    unknowns: Object.freeze(model.unknowns.filter((entry) => includes(entry.detail) || includes(entry.path) || includes(entry.code)))
  });
}
