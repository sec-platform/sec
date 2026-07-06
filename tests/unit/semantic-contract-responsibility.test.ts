import { expect, test } from 'bun:test';

import { normalizeSemanticContract } from '../../platform/compiler/index.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type { SemanticContract } from '../../platform/shared/semantic-contract-types.ts';

const input: SemanticContract = {
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

test('operation responsibility declarations must agree', () => {
  try {
    normalizeSemanticContract(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe('CONTRACT-SEMANTIC-017');
    return;
  }
  throw new Error('Expected semantic contract validation failure');
});
