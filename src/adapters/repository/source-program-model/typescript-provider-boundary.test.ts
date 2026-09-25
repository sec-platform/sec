import { test } from 'bun:test';
import assert from 'node:assert/strict';
import * as provider from './typescript.ts';

// This is the pre-existing public provider ABI, not an export of every
// implementation peer. Adding an internal helper must not widen that ABI.
test('TypeScript provider exports only its public operations, not internal issuers or state', () => {
  assert.deepEqual(Object.keys(provider).sort(), [
  "adoptTypeScriptFactShards",
  "assertTypeScriptCompilerIdentity",
  "assertTypeScriptRequiredApiClosure",
  "compileRepositoryModuleGraph",
  "compileTypeScriptDiagnosticSnapshot",
  "compileTypeScriptModel",
  "compileTypeScriptModelIncremental",
  "compileTypeScriptModelIncrementalWithCompilation",
  "compileTypeScriptModelWithCompilation",
  "currentExactReturnProvenances",
  "currentTypeScriptRequiredApiClosure",
  "identifierInitializer",
  "identifierIsAmbientGlobal",
  "identifierResolvesToImport",
  "isCompiledTypeScriptModel",
  "isRuntimeBuiltinModuleSpecifier",
  "observeDurableWorkerInput",
  "observeTypeScriptPerformanceForTests",
  "observeTypeScriptRename",
  "observeTypeScriptSyntax",
  "querySourceProgramModel",
  "releaseTypeScriptWorkspace",
  "resolveTypeScriptModuleExport",
  "typeScriptCompilerIdentity",
  "typeScriptExactFactGenerationReceipt",
  "typeScriptSourceFile",
  "workspaceSnapshotIdentityForTypeScriptModel"
]);
});
