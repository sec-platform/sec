import ts from 'typescript';
import type {
  SourceProgramFileInput
} from './contract.ts';
import {
  sourceProgramSurfaceForPath
} from './contract.ts';
import {
  compareCodeUnits,
  sha256
} from '../../../contracts/canonical.ts';
import {
  resolveSourceProgramCompilationOperation
} from './compilation-operation.ts';
import {
  SOURCE_EXTENSION,
  canonicalTypeScriptFile,
  sourceProgramFileSnapshotDigest
} from './typescript-input.ts';
import {
  compileExactTypeScriptProgram
} from './typescript-workspace.ts';

/** Exact-program diagnostics projected without constructing the repository semantic model. */
interface SourceProgramTypeScriptDiagnosticEvidence {
  readonly path: string | null;
  readonly code: number;
  readonly category: 'error' | 'warning' | 'suggestion' | 'message';
  readonly message: string;
}

export interface TypeScriptDiagnosticSnapshot {
  readonly sourceRevision: string;
  readonly diagnostics: readonly SourceProgramTypeScriptDiagnosticEvidence[];
  readonly evidenceDigest: string;
}

function diagnosticCategory(category: ts.DiagnosticCategory): SourceProgramTypeScriptDiagnosticEvidence['category'] {
  switch (category) {
    case ts.DiagnosticCategory.Error: return 'error';
    case ts.DiagnosticCategory.Warning: return 'warning';
    case ts.DiagnosticCategory.Suggestion: return 'suggestion';
    case ts.DiagnosticCategory.Message: return 'message';
  }
}

/**
 * Diagnostic evidence for a virtual reduction is compiled by the same exact
 * Program/LanguageService owner as repository facts.  Positions are omitted:
 * deleting a declaration may shift later nodes without changing diagnostics.
 */
export function compileTypeScriptDiagnosticSnapshot(input: Readonly<{
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
}>): TypeScriptDiagnosticSnapshot {
  const filesByPath = new Map<string, SourceProgramFileInput>();
  for (const raw of input.files) {
    if (!SOURCE_EXTENSION.test(raw.path)
        || sourceProgramSurfaceForPath(raw.path) !== 'production') continue;
    const file = canonicalTypeScriptFile(raw);
    if (filesByPath.has(file.path)) {
      throw new Error(`Source Program diagnostic snapshot contains duplicate path: ${file.path}`);
    }
    filesByPath.set(file.path, file);
  }
  const sourceFileIdentities = new Map([...filesByPath].map(([repositoryPathValue, file]) => [
    repositoryPathValue,
    Object.freeze({
      file,
      moduleDigest: sha256(null) as `sha256:${string}`,
      rawFileDigest: sourceProgramFileSnapshotDigest(file)
    })
  ] as const));
  const exact = compileExactTypeScriptProgram(
    filesByPath,
    sourceFileIdentities,
    resolveSourceProgramCompilationOperation()
  );
  const diagnostics = exact.sourceFiles.flatMap((sourceFile) => [
    ...exact.program.getSyntacticDiagnostics(sourceFile),
    ...exact.program.getSemanticDiagnostics(sourceFile)
  ]).map((diagnostic): SourceProgramTypeScriptDiagnosticEvidence => Object.freeze({
    path: diagnostic.file === undefined ? null : exact.repositoryPath(diagnostic.file),
    code: diagnostic.code,
    category: diagnosticCategory(diagnostic.category),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  })).sort((left, right) => compareCodeUnits(left.path ?? '', right.path ?? '')
    || left.code - right.code
    || compareCodeUnits(left.category, right.category)
    || compareCodeUnits(left.message, right.message));
  return Object.freeze({
    sourceRevision: input.sourceRevision,
    diagnostics: Object.freeze(diagnostics),
    evidenceDigest: sha256(diagnostics)
  });
}
