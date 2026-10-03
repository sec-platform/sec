import { test } from 'bun:test';
import assert from 'node:assert/strict';
import * as provider from './typescript.ts';

test('TypeScript provider exports only the current public runtime operations', () => {
  assert.deepEqual(Object.keys(provider).sort(), [
  "adoptTypeScriptSourceProgramFactShardsFromWorkspaceSnapshot",
  "assertSourceProgramTypeScriptCompilerIdentity",
  "assertSourceProgramTypeScriptRequiredApiClosure",
  "compileSourceProgramTypeScriptDiagnosticSnapshot",
  "compileTypeScriptSourceProgramModel",
  "compileTypeScriptSourceProgramModelFromWorkspaceSnapshot",
  "compileTypeScriptSourceProgramModelIncremental",
  "compileTypeScriptSourceProgramModelIncrementalFromWorkspaceSnapshot",
  "isCompiledTypeScriptSourceProgramModel",
  "isSourceProgramRuntimeBuiltinModuleSpecifier",
  "observeSourceProgramDurableWorkerInput",
  "observeSourceProgramTypeScriptRename",
  "observeSourceProgramTypeScriptSyntax",
  "observeTypeScriptSourceProgramPerformanceForTests",
  "querySourceProgramModel",
  "releaseTypeScriptSourceProgramWorkspace",
  "resolveSourceProgramTypeScriptModuleExport",
  "sourceProgramCurrentExactReturnProvenances",
  "sourceProgramTypeScriptCompilerIdentity",
  "sourceProgramTypeScriptExactFactGenerationReceipt",
  "sourceProgramTypeScriptIdentifierInitializer",
  "sourceProgramTypeScriptIdentifierIsAmbientGlobal",
  "sourceProgramTypeScriptIdentifierResolvesToImport",
  "sourceProgramTypeScriptRequiredApiClosure",
  "sourceProgramTypeScriptSourceFile",
  "workspaceSourceSnapshotIdentityForTypeScriptModel"
]);
});
