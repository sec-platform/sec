/** Public TypeScript provider surface. State and effects live in their owning
 * modules. Only the previously public operations and types are exported here;
 * internal issuer helpers and mutable registries are not part of this API. */
export type {
  TypeScriptModelInput
} from './typescript-input.ts';
export type {
  TypeScriptIncrementalState,
  TypeScriptIncrementalResult
} from './typescript-incremental.ts';
export type {
  TypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export {
  isRuntimeBuiltinModuleSpecifier
} from './typescript-syntax.ts';
export type {
  TypeScriptPerformanceObservation
} from './typescript-performance.ts';
export {
  observeTypeScriptPerformanceForTests
} from './typescript-performance.ts';
export type {
  TypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export {
  assertTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export {
  workspaceSnapshotIdentityForTypeScriptModel,
  isCompiledTypeScriptModel
} from './typescript-model-assembly.ts';
export type {
  TypeScriptCompilerIdentity
} from './typescript-profile.ts';
export {
  typeScriptCompilerIdentity,
  assertTypeScriptCompilerIdentity
} from './typescript-profile.ts';
export type {
  TypeScriptRenameObservation
} from './typescript-workspace.ts';
export type {
  TypeScriptSyntaxObservation,
  TypeScriptExactFactGenerationReceipt,
  TypeScriptModuleExportResolution,
  DurableWorkerInputObservation
} from './typescript-exact-facts.ts';
export {
  releaseTypeScriptWorkspace
} from './typescript-workspace.ts';
export type {
  RepositoryModuleGraphInput
} from './typescript-module-graph.ts';
export {
  compileRepositoryModuleGraph
} from './typescript-module-graph.ts';
export {
  compileTypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export {
  currentExactReturnProvenances,
  typeScriptSourceFile,
  identifierIsAmbientGlobal,
  identifierResolvesToImport,
  identifierInitializer,
  observeTypeScriptSyntax,
  observeTypeScriptRename,
  observeDurableWorkerInput,
  resolveTypeScriptModuleExport,
  typeScriptExactFactGenerationReceipt,
  currentTypeScriptRequiredApiClosure
} from './typescript-exact-facts.ts';
export {
  adoptTypeScriptFactShards,
  compileTypeScriptModelIncremental,
  compileTypeScriptModelIncrementalWithCompilation
} from './typescript-incremental.ts';
export {
  compileTypeScriptModel,
  compileTypeScriptModelWithCompilation
} from './typescript-lowering.ts';
export {
  querySourceProgramModel
} from './typescript-query.ts';
