import type { SemanticGeneratorDeclaration } from '../semantics/generation/types.ts';
import { uniqueSorted } from '../contracts/canonical.ts';
import { CompilerError } from './errors.ts';
import { generatorEntityId } from './ir/ir-identity.ts';

/** Omission retains the all-roots profile; an explicit empty selection performs
 * no generation. Root identity comes from the existing IR generator owner. */
export function captureSemanticRoots(roots?: readonly string[]): readonly string[] | undefined {
  if (roots === undefined) return undefined;
  if (!Array.isArray(roots)) {
    throw new CompilerError('GENERATOR-ROOT-001', 'Semantic roots must be an array of generator identities');
  }
  const selected = [...roots];
  if (selected.some(root => typeof root !== 'string' || root.length === 0)) {
    throw new CompilerError('GENERATOR-ROOT-001', 'Semantic roots must be non-empty generator identities');
  }
  return Object.freeze(uniqueSorted(selected));
}

/** Select before generator planning, not after rendering every output. Full IR
 * validation still covers the supplied input; this is not incremental analysis. */
export function selectSemanticGeneratorRoots(
  declarations: readonly SemanticGeneratorDeclaration[],
  roots: readonly string[] | undefined
): readonly SemanticGeneratorDeclaration[] {
  if (roots === undefined) return declarations;
  const identity = (entry: SemanticGeneratorDeclaration) => generatorEntityId(entry.blockId, entry.declaration.id);
  const available = new Set(declarations.map(identity));
  const missing = roots.filter(root => !available.has(root));
  if (missing.length > 0) {
    throw new CompilerError('GENERATOR-ROOT-002', 'Requested semantic generators are absent from this input', { roots: missing });
  }
  const selected = new Set(roots);
  // Preserve duplicate declaration checks and canonical task ordering in the
  // original planner rather than replacing them with a map of last entries.
  return declarations.filter(entry => selected.has(identity(entry)));
}
