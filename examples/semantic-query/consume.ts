import source from './input.json' with { type: 'json' };
import { createRuntime, type SemanticCompilationInput } from '../../src/bootstrap/create-runtime.ts';

// This profile returns semantic artifact source in memory. Consuming the set
// does not write the target paths, build a package or certify verification.
const runtime = createRuntime();
try {
  const result = await runtime.handle({
    purpose: 'generate',
    input: source as SemanticCompilationInput
  });
  if (result.purpose !== 'generate') throw new Error('Unexpected query result');
  console.log(JSON.stringify(result.artifacts, null, 2));
} finally {
  await runtime.close();
}
