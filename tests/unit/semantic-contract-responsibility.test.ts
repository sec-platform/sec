import { expect, test } from 'bun:test';

import { CompilerError } from '../../src/compiler/errors.ts';
import { normalizeSemanticContract } from '../../src/semantics/definitions/normalize.ts';
import type { SemanticContract } from '../../src/semantics/definitions/types.ts';

function baseContract(): SemanticContract {
  return {
    formatVersion: '1',
    id: 'responsibility-check',
    namespace: 'responsibility-check',
    entities: [],
    states: [],
    responsibilities: [
      { id: 'First', role: 'First role', owns: [], implements: [], dependsOn: [] },
      { id: 'Second', role: 'Second role', owns: [], implements: ['execute'], dependsOn: [] }
    ],
    operations: [{
      id: 'execute',
      responsibility: 'First',
      inputs: [],
      reads: [],
      writes: [],
      mutates: [],
      requiresPolicies: [],
      requiresPermissions: [],
      performsEffects: [],
      emits: [],
      invokes: [],
      awaits: []
    }],
    events: [],
    policies: [],
    permissions: [],
    effects: [],
    scenarios: []
  };
}

function expectContractError(input: SemanticContract, code: string): void {
  try {
    normalizeSemanticContract(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected semantic contract validation failure ${code}`);
}

test('operation responsibility declarations must agree', () => {
  expectContractError(baseContract(), 'CONTRACT-SEMANTIC-017');
});

test('unknown operation responsibility keeps local reference error precedence', () => {
  const input = baseContract();
  input.responsibilities[1]!.implements = [];
  input.operations[0]!.responsibility = 'Missing';

  expectContractError(input, 'CONTRACT-SEMANTIC-003');
});
