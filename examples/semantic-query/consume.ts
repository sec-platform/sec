import assert from 'node:assert/strict';
import { createRuntime, type SemanticCompilationInput } from '../../src/bootstrap/create-runtime.ts';
import source from './input.json' with { type: 'json' };

// This profile owns author candidates and returns semantic artifact source in
// memory. A save plan does not write files, build a package or execute a target.
const runtime = createRuntime();
try {
  const workspace = runtime.workspace(source as SemanticCompilationInput);
  const first = await runtime.handle({ purpose: 'generate', candidate: workspace.initial });
  if (first.purpose !== 'generate') throw new Error('Unexpected query result');
  const firstBytes = JSON.stringify(first.artifacts);
  const initialBytes = JSON.stringify(workspace.read(workspace.initial));

  // Edit the original author representation, never the generated TypeScript.
  // The current finite profile requires one outgoing transition per state.
  const edited = structuredClone(workspace.read(workspace.initial));
  const contract = edited.engineeringIRInput.semanticContracts
    ?.find(entry => entry.contract.id === 'item-core');
  const state = contract?.contract.states.find(entry => entry.id === 'item-status');
  const transition = state?.transitions.find(entry => entry.from === 'closed');
  if (transition === undefined) throw new Error('Example is missing its closed-state transition');
  transition.to = 'closed';
  const candidate = workspace.fork(workspace.initial, edited);
  const second = await runtime.handle({ purpose: 'generate', candidate });
  if (second.purpose !== 'generate') throw new Error('Unexpected query result');

  // Earlier candidates/results remain available. Repeating an unchanged
  // candidate reproduces its result without making it the current saved head.
  const repeated = await runtime.handle({ purpose: 'generate', candidate: workspace.initial });
  if (repeated.purpose !== 'generate') throw new Error('Unexpected query result');
  assert.equal(JSON.stringify(first.artifacts), firstBytes);
  assert.equal(JSON.stringify(workspace.read(workspace.initial)), initialBytes);
  assert.deepEqual(repeated.artifacts, first.artifacts);
  assert.equal(first.artifacts.identity.profile, 'blake3-256-canonical-json-v1');
  assert.equal(first.artifacts.identity.domain, 'semantic-artifact-set');
  assert.equal(first.artifacts.identity.schema, 'v1');
  assert.deepEqual(repeated.artifacts.identity, first.artifacts.identity);
  assert.notDeepEqual(second.artifacts.identity, first.artifacts.identity);
  assert.ok(first.artifacts.members.length > 0, 'The example must produce actual source');
  assert.deepEqual(second.artifacts.members.map(member => member.task.target),
    first.artifacts.members.map(member => member.task.target));
  assert.notDeepEqual(second.artifacts.members.map(member => member.source),
    first.artifacts.members.map(member => member.source));
  assert.notEqual(second.compilation.snapshot.ir.semanticRevision,
    first.compilation.snapshot.ir.semanticRevision);
  const save = workspace.planSave(workspace.initial, candidate);

  console.log(JSON.stringify({
    scope: 'in-memory-candidate-and-semantic-tasks',
    initial: { revision: workspace.initial.revision, artifacts: first.artifacts },
    edited: { revision: candidate.revision, artifacts: second.artifacts },
    savePlan: { expectedRevision: save.expected.revision, candidateRevision: save.candidate.revision },
    effects: { filesWritten: false, packageBuilt: false, targetExecuted: false }
  }, null, 2));
} finally {
  await runtime.close();
}
