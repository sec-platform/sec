import { CompilerError } from '../../compiler/errors.ts';
import type { SemanticCompilationInput } from '../../compiler/semantic-compiler.ts';
import { isPlainObject } from '../../contracts/canonical.ts';
import { resolvePathInside } from '../../contracts/relative-path.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../runtime-state/physical/runtime/retained-file-read.ts';

/** One explicitly selected closed-input file. The retained reader owns physical
 * admission and its byte ceiling; the compiler still owns domain validation. */
function readSemanticQueryInput(filePath: string): SemanticCompilationInput {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, 'Semantic query input');
  if (bytes === null) throw new CompilerError('SEMANTIC-QUERY-003', 'Semantic query input file is missing');
  const value: unknown = JSON.parse(decodeExactUtf8(bytes, 'Semantic query input'));
  if (!isPlainObject(value) || !isPlainObject(value.engineeringIRInput)
      || (value.generatorDeclarations !== undefined && !Array.isArray(value.generatorDeclarations))) {
    throw new CompilerError('SEMANTIC-QUERY-003', 'Semantic query input requires engineeringIRInput and optional generatorDeclarations');
  }
  return value as unknown as SemanticCompilationInput;
}


/** Read one explicitly selected semantic input inside the workspace authority.
 * The CLI may choose a logical member, but cannot turn this operation into an
 * arbitrary host-file reader. Physical file admission remains with the retained reader. */
export function readWorkspaceSemanticQueryInput(
  workspaceRoot: string,
  relativePath: string
): SemanticCompilationInput {
  const filePath = resolvePathInside(workspaceRoot, relativePath);
  if (filePath === null) {
    throw new CompilerError(
      'SEMANTIC-QUERY-003',
      'Semantic query input must be one workspace-relative path without parent traversal'
    );
  }
  return readSemanticQueryInput(filePath);
}
