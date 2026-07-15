import { fileURLToPath } from 'node:url';

import {
  SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES,
  SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_TOKEN,
  semanticMutationRunnerBuildSuccessFrame
} from './semantic-mutation-runner-build-protocol.ts';

const ISOLATED_RUNNER_PATH = fileURLToPath(new URL(
  '../../orchestrator/semantic-mutation-isolated-verification-runner.ts',
  import.meta.url
));

async function runSemanticMutationRunnerBuildChild(): Promise<number> {
  if (process.argv.length !== 3 ||
    process.argv[2] !== SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_TOKEN) {
    return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.invocation;
  }
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [ISOLATED_RUNNER_PATH],
      format: 'esm',
      minify: false,
      sourcemap: 'none',
      splitting: false,
      target: 'bun'
    });
  } catch {
    return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.invocation;
  }
  if (!result.success) return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.unsuccessful;
  if (result.outputs.length !== 1) {
    return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputCount;
  }
  let frame: Uint8Array;
  try {
    const payload = Uint8Array.from(new Uint8Array(await result.outputs[0].arrayBuffer()));
    frame = semanticMutationRunnerBuildSuccessFrame(payload);
  } catch {
    return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputRead;
  }
  try {
    const written = await Bun.write(Bun.stdout, frame);
    return written === frame.byteLength
      ? 0
      : SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputRead;
  } catch {
    return SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputRead;
  }
}

if (import.meta.main) {
  const exitCode = await runSemanticMutationRunnerBuildChild();
  process.exit(exitCode);
}
