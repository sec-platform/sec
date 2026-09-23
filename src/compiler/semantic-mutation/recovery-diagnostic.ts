import type { SemanticMutationDiagnostic } from '../../semantics/mutation/types.ts';

export function recoveryDiagnostic(
  message: string,
  details?: Readonly<Record<string, unknown>>
): SemanticMutationDiagnostic {
  return {
    origin: 'semantic-mutation',
    code: 'SEMANTIC-MUTATION-012',
    stage: 'rollback',
    message,
    ...(details === undefined ? {} : { details })
  };
}
