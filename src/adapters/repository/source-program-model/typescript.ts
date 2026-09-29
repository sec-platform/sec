/** Public TypeScript Source Program surface. Internal issuers remain owner-local. */
export type {
  TypeScriptModelInput as CompileTypeScriptSourceProgramModelInput
} from './typescript-input.ts';
export type {
  TypeScriptIncrementalState as TypeScriptSourceProgramIncrementalState,
  TypeScriptIncrementalResult as TypeScriptSourceProgramIncrementalResult
} from './typescript-incremental.ts';
export type {
  TypeScriptDiagnosticSnapshot as SourceProgramTypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export {
  isRuntimeBuiltinModuleSpecifier as isSourceProgramRuntimeBuiltinModuleSpecifier
} from './typescript-syntax.ts';
export type {
  TypeScriptPerformanceObservation as TypeScriptSourceProgramPerformanceObservation
} from './typescript-performance.ts';
export {
  observeTypeScriptPerformanceForTests as observeTypeScriptSourceProgramPerformanceForTests
} from './typescript-performance.ts';
export type {
  TypeScriptRequiredApiClosure as SourceProgramTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export {
  assertTypeScriptRequiredApiClosure as assertSourceProgramTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export {
  workspaceSnapshotIdentityForTypeScriptModel as workspaceSourceSnapshotIdentityForTypeScriptModel,
  isCompiledTypeScriptModel as isCompiledTypeScriptSourceProgramModel
} from './typescript-model-assembly.ts';
export type {
  TypeScriptCompilerIdentity as SourceProgramTypeScriptCompilerIdentity
} from './typescript-profile.ts';
export {
  typeScriptCompilerIdentity as sourceProgramTypeScriptCompilerIdentity,
  assertTypeScriptCompilerIdentity as assertSourceProgramTypeScriptCompilerIdentity
} from './typescript-profile.ts';
export type {
  TypeScriptRenameObservation as SourceProgramTypeScriptRenameObservation
} from './typescript-workspace.ts';
export type {
  TypeScriptSyntaxObservation as SourceProgramTypeScriptSyntaxObservation,
  TypeScriptExactFactGenerationReceipt as SourceProgramTypeScriptExactFactGenerationReceipt,
  TypeScriptModuleExportResolution as SourceProgramTypeScriptModuleExportResolution,
  DurableWorkerInputObservation as SourceProgramDurableWorkerInputObservation
} from './typescript-exact-facts.ts';
export {
  releaseTypeScriptWorkspace as releaseTypeScriptSourceProgramWorkspace
} from './typescript-workspace.ts';
export type {
  SecRepositoryModuleGraphInput as CompileTypeScriptRepositoryModuleGraphInput
} from './typescript-module-graph.ts';
export {
  compileSecRepositoryModuleGraph
} from './typescript-module-graph.ts';
export {
  compileTypeScriptDiagnosticSnapshot as compileSourceProgramTypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export {
  currentExactReturnProvenances as sourceProgramCurrentExactReturnProvenances,
  typeScriptSourceFile as sourceProgramTypeScriptSourceFile,
  identifierIsAmbientGlobal as sourceProgramTypeScriptIdentifierIsAmbientGlobal,
  identifierResolvesToImport as sourceProgramTypeScriptIdentifierResolvesToImport,
  identifierInitializer as sourceProgramTypeScriptIdentifierInitializer,
  observeTypeScriptSyntax as observeSourceProgramTypeScriptSyntax,
  observeTypeScriptRename as observeSourceProgramTypeScriptRename,
  observeDurableWorkerInput as observeSourceProgramDurableWorkerInput,
  resolveTypeScriptModuleExport as resolveSourceProgramTypeScriptModuleExport,
  typeScriptExactFactGenerationReceipt as sourceProgramTypeScriptExactFactGenerationReceipt,
  currentTypeScriptRequiredApiClosure as sourceProgramTypeScriptRequiredApiClosure
} from './typescript-exact-facts.ts';
export {
  adoptTypeScriptFactShards as adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot,
  compileTypeScriptModelIncremental as compileTypeScriptSourceProgramModelIncremental,
  compileTypeScriptModelIncrementalWithCompilation
    as compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot
} from './typescript-incremental.ts';
export {
  compileTypeScriptModel as compileTypeScriptSourceProgramModel,
  compileTypeScriptModelWithCompilation as compileTypeScriptSourceProgramModelFromWorkspaceSnapshot
} from './typescript-lowering.ts';
export {
  querySourceProgramModel
} from './typescript-query.ts';
