/** Public TypeScript Source Program surface. Internal issuers remain owner-local. */
export {
  assertTypeScriptRequiredApiClosure as assertSourceProgramTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export type {
  TypeScriptRequiredApiClosure as SourceProgramTypeScriptRequiredApiClosure
} from './typescript-api-closure.ts';
export {
  compileTypeScriptDiagnosticSnapshot as compileSourceProgramTypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export type {
  TypeScriptDiagnosticSnapshot as SourceProgramTypeScriptDiagnosticSnapshot
} from './typescript-diagnostics.ts';
export {
  observeDurableWorkerInput as observeSourceProgramDurableWorkerInput, observeTypeScriptRename as observeSourceProgramTypeScriptRename, observeTypeScriptSyntax as observeSourceProgramTypeScriptSyntax, resolveTypeScriptModuleExport as resolveSourceProgramTypeScriptModuleExport, currentExactReturnProvenances as sourceProgramCurrentExactReturnProvenances, typeScriptExactFactGenerationReceipt as sourceProgramTypeScriptExactFactGenerationReceipt, identifierInitializer as sourceProgramTypeScriptIdentifierInitializer, identifierIsAmbientGlobal as sourceProgramTypeScriptIdentifierIsAmbientGlobal,
  identifierResolvesToImport as sourceProgramTypeScriptIdentifierResolvesToImport, currentTypeScriptRequiredApiClosure as sourceProgramTypeScriptRequiredApiClosure, typeScriptSourceFile as sourceProgramTypeScriptSourceFile
} from './typescript-exact-facts.ts';
export type {
  DurableWorkerInputObservation as SourceProgramDurableWorkerInputObservation, TypeScriptExactFactGenerationReceipt as SourceProgramTypeScriptExactFactGenerationReceipt,
  TypeScriptModuleExportResolution as SourceProgramTypeScriptModuleExportResolution, TypeScriptSyntaxObservation as SourceProgramTypeScriptSyntaxObservation
} from './typescript-exact-facts.ts';
export {
  adoptTypeScriptFactShards as adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot,
  compileTypeScriptModelIncremental as compileTypeScriptSourceProgramModelIncremental,
  compileTypeScriptModelIncrementalWithCompilation as compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot
} from './typescript-incremental.ts';
export type {
  TypeScriptIncrementalResult as TypeScriptSourceProgramIncrementalResult, TypeScriptIncrementalState as TypeScriptSourceProgramIncrementalState
} from './typescript-incremental.ts';
export type {
  TypeScriptModelInput as CompileTypeScriptSourceProgramModelInput
} from './typescript-input.ts';
export {
  compileTypeScriptModel as compileTypeScriptSourceProgramModel,
  compileTypeScriptModelWithCompilation as compileTypeScriptSourceProgramModelFromWorkspaceSnapshot
} from './typescript-lowering.ts';
export {
  isCompiledTypeScriptModel as isCompiledTypeScriptSourceProgramModel, workspaceSnapshotIdentityForTypeScriptModel as workspaceSourceSnapshotIdentityForTypeScriptModel
} from './typescript-model-assembly.ts';
export {
  observeTypeScriptPerformanceForTests as observeTypeScriptSourceProgramPerformanceForTests
} from './typescript-performance.ts';
export type {
  TypeScriptPerformanceObservation as TypeScriptSourceProgramPerformanceObservation
} from './typescript-performance.ts';
export {
  assertTypeScriptCompilerIdentity as assertSourceProgramTypeScriptCompilerIdentity, typeScriptCompilerIdentity as sourceProgramTypeScriptCompilerIdentity
} from './typescript-profile.ts';
export type {
  TypeScriptCompilerIdentity as SourceProgramTypeScriptCompilerIdentity
} from './typescript-profile.ts';
export {
  querySourceProgramModel
} from './typescript-query.ts';
export {
  isRuntimeBuiltinModuleSpecifier as isSourceProgramRuntimeBuiltinModuleSpecifier
} from './typescript-syntax.ts';
export {
  releaseTypeScriptWorkspace as releaseTypeScriptSourceProgramWorkspace
} from './typescript-workspace.ts';
export type {
  TypeScriptRenameObservation as SourceProgramTypeScriptRenameObservation
} from './typescript-workspace.ts';
