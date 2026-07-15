import { createHash, timingSafeEqual } from 'node:crypto';

export const SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_TOKEN =
  'semantic-mutation-runner-build-v1';

export const SEMANTIC_MUTATION_RUNNER_BUILD_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export const SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES = Object.freeze({
  invocation: 71,
  unsuccessful: 72,
  outputCount: 73,
  outputRead: 74
} as const);

export type SemanticMutationRunnerBuildFailureSubstage =
  | 'runner-build-invocation'
  | 'runner-build-unsuccessful'
  | 'runner-build-output-count'
  | 'runner-build-output-read';

const FRAME_MAGIC = Uint8Array.from([0x53, 0x4d, 0x52, 0x42, 0x01, 0x00, 0x00, 0x00]);
const FRAME_LENGTH_BYTES = 8;
const FRAME_DIGEST_BYTES = 32;
export const SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES =
  FRAME_MAGIC.byteLength + FRAME_LENGTH_BYTES + FRAME_DIGEST_BYTES;
export const SEMANTIC_MUTATION_RUNNER_BUILD_MAX_FRAME_BYTES =
  SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES +
  SEMANTIC_MUTATION_RUNNER_BUILD_MAX_BUNDLE_BYTES;

function digest(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(bytes).digest());
}

export function semanticMutationRunnerBuildFailureSubstage(
  exitCode: number | null
): SemanticMutationRunnerBuildFailureSubstage | undefined {
  switch (exitCode) {
    case SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.invocation:
      return 'runner-build-invocation';
    case SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.unsuccessful:
      return 'runner-build-unsuccessful';
    case SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputCount:
      return 'runner-build-output-count';
    case SEMANTIC_MUTATION_RUNNER_BUILD_EXIT_CODES.outputRead:
      return 'runner-build-output-read';
    default:
      return undefined;
  }
}

export function semanticMutationRunnerBuildSuccessFrame(payload: Uint8Array): Uint8Array {
  if (!(payload instanceof Uint8Array) || payload.byteLength === 0 ||
    payload.byteLength > SEMANTIC_MUTATION_RUNNER_BUILD_MAX_BUNDLE_BYTES) {
    throw new Error('Semantic Mutation runner build payload is invalid');
  }
  const frame = new Uint8Array(
    SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES + payload.byteLength
  );
  frame.set(FRAME_MAGIC, 0);
  new DataView(frame.buffer).setBigUint64(
    FRAME_MAGIC.byteLength,
    BigInt(payload.byteLength),
    true
  );
  frame.set(digest(payload), FRAME_MAGIC.byteLength + FRAME_LENGTH_BYTES);
  frame.set(payload, SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES);
  return frame;
}

export function parseSemanticMutationRunnerBuildSuccessFrame(frame: Uint8Array): Uint8Array {
  if (!(frame instanceof Uint8Array) ||
    frame.byteLength < SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES ||
    frame.byteLength > SEMANTIC_MUTATION_RUNNER_BUILD_MAX_FRAME_BYTES) {
    throw new Error('Semantic Mutation runner build frame size is invalid');
  }
  if (!timingSafeEqual(
    Buffer.from(frame.subarray(0, FRAME_MAGIC.byteLength)),
    Buffer.from(FRAME_MAGIC)
  )) {
    throw new Error('Semantic Mutation runner build frame version is invalid');
  }
  const payloadLength = new DataView(
    frame.buffer,
    frame.byteOffset + FRAME_MAGIC.byteLength,
    FRAME_LENGTH_BYTES
  ).getBigUint64(0, true);
  if (payloadLength === 0n ||
    payloadLength > BigInt(SEMANTIC_MUTATION_RUNNER_BUILD_MAX_BUNDLE_BYTES) ||
    payloadLength > BigInt(Number.MAX_SAFE_INTEGER) ||
    BigInt(frame.byteLength - SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES) !== payloadLength) {
    throw new Error('Semantic Mutation runner build frame length is invalid');
  }
  const payloadOffset = SEMANTIC_MUTATION_RUNNER_BUILD_FRAME_HEADER_BYTES;
  const payload = Uint8Array.from(frame.subarray(payloadOffset));
  const expectedDigest = frame.subarray(
    FRAME_MAGIC.byteLength + FRAME_LENGTH_BYTES,
    payloadOffset
  );
  if (!timingSafeEqual(Buffer.from(digest(payload)), Buffer.from(expectedDigest))) {
    throw new Error('Semantic Mutation runner build frame digest is invalid');
  }
  return payload;
}
