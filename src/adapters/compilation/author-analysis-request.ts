import { CodedFailure } from '../../contracts/failure.ts';

/** The existing /1 wire contract; byte arrays stay owned byte views until
 * admission. This is not a new author format or a semantic interpreter. */
export const AUTHOR_ANALYSIS_MAXIMUM_REQUEST_BYTES = 64 * 1024 * 1024;
export type AuthorCaptureOutcome = 'complete' | 'found' | 'partial' | 'absent' | 'denied' | 'unavailable' | 'failed';
export type AuthorCaptureObservation =
  | Readonly<{ kind: 'directory'; path: string; outcome: AuthorCaptureOutcome;
      entries: readonly Readonly<{ name: string; kind: 'file' | 'directory' | 'link' | 'other'; byte_length: number }>[] }>
  | Readonly<{ kind: 'file'; path: string; outcome: AuthorCaptureOutcome; bytes: Uint8Array }>;
export interface AuthorAnalysisRequestInput {
  readonly root: Readonly<{ locator: string; bytes: Uint8Array }>;
  readonly context: Readonly<{ project_instance: string; resolution_domain: string }>;
  readonly interpretation?: string;
  readonly observations: ReadonlyMap<string, AuthorCaptureObservation>;
  readonly budget: Readonly<{ work: number; allocation_bytes: number }>;
}

function exhausted(message: string): never {
  throw new CodedFailure('AUTHOR-ANALYSIS-RESOURCE', message);
}
function invalid(message: string): never {
  throw new CodedFailure('AUTHOR-ANALYSIS-PROTOCOL', message);
}
function natural(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid('Author analysis transport requires an exact nonnegative safe integer');
}

/** Two passes over the same private, synchronous capture. Count without a
 * number[] or a whole-message string; allocate only after exact wire
 * admission. JSON.stringify still owns string escaping on the write
 * pass. No caller-controlled JSON object or toJSON hook is traversed. */
class RequestWriter {
  size = 0;
  constructor(
    private readonly maximum: number,
    private readonly current: () => void,
    private readonly output?: Buffer
  ) {}

  private reserve(bytes: number): number {
    if (bytes > this.maximum - this.size) exhausted('Author analysis request exceeds its admitted transport budget');
    const offset = this.size;
    this.size += bytes;
    return offset;
  }

  raw(value: string): void {
    // All callers supply fixed ASCII JSON punctuation/property names or an
    // already checked natural number. Source text only enters string().
    const offset = this.reserve(value.length);
    if (this.output !== undefined && this.output.write(value, offset, value.length, 'ascii') !== value.length) {
      invalid('Author analysis request writer did not fill its admitted range');
    }
  }

  string(value: string): void {
    this.current();
    let bytes = 2;
    for (let index = 0; index < value.length; index++) {
      if ((index & 4095) === 0) this.current();
      const unit = value.charCodeAt(index);
      if (unit === 0x22 || unit === 0x5c || unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13) {
        bytes += 2;
      } else if (unit < 0x20) {
        bytes += 6;
      } else if (unit < 0x80) {
        bytes++;
      } else if (unit < 0x800) {
        bytes += 2;
      } else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length
          && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index++;
      } else if (unit >= 0xd800 && unit <= 0xdfff) {
        // Well-formed JSON.stringify escapes a lone surrogate as \udxxx.
        bytes += 6;
      } else {
        bytes += 3;
      }
      if (bytes > this.maximum - this.size) exhausted('Author analysis metadata exceeds its admitted transport budget');
    }
    const offset = this.reserve(bytes);
    if (this.output !== undefined) {
      const quoted = JSON.stringify(value);
      if (Buffer.byteLength(quoted, 'utf8') !== bytes || this.output.write(quoted, offset, bytes, 'utf8') !== bytes) {
        invalid('Author analysis string encoding changed after admission');
      }
    }
  }

  natural(value: number): void {
    natural(value);
    this.raw(String(value));
  }

  bytes(value: Uint8Array): void {
    this.raw('[');
    for (let index = 0; index < value.length; index++) {
      if ((index & 4095) === 0) this.current();
      const byte = value[index]!;
      const digits = byte < 10 ? 1 : byte < 100 ? 2 : 3;
      let offset = this.reserve(digits + (index === 0 ? 0 : 1));
      if (this.output !== undefined) {
        if (index !== 0) this.output[offset++] = 44;
        if (byte >= 100) this.output[offset++] = 48 + Math.floor(byte / 100);
        if (byte >= 10) this.output[offset++] = 48 + Math.floor(byte / 10) % 10;
        this.output[offset] = 48 + byte % 10;
      }
    }
    this.raw(']');
  }

  request(input: AuthorAnalysisRequestInput): void {
    this.current();
    this.raw('{"schema":"gift.author-analysis-request/1","purpose":"analyze","root":{"locator":');
    this.string(input.root.locator);
    this.raw(',"bytes":');
    this.bytes(input.root.bytes);
    this.raw('},"context":{"project_instance":');
    this.string(input.context.project_instance);
    this.raw(',"resolution_domain":');
    this.string(input.context.resolution_domain);
    this.raw('}');
    if (input.interpretation !== undefined) {
      this.raw(',"interpretation":');
      this.string(input.interpretation);
    }
    this.raw(',"observations":[');
    let first = true;
    for (const observation of input.observations.values()) {
      this.current();
      if (!first) this.raw(',');
      first = false;
      this.raw('{"kind":');
      this.string(observation.kind);
      this.raw(',"path":');
      this.string(observation.path);
      this.raw(',"outcome":');
      this.string(observation.outcome);
      if (observation.kind === 'file') {
        this.raw(',"bytes":');
        this.bytes(observation.bytes);
      } else {
        this.raw(',"entries":[');
        for (const [index, entry] of observation.entries.entries()) {
          this.current();
          if (index !== 0) this.raw(',');
          this.raw('{"name":');
          this.string(entry.name);
          this.raw(',"kind":');
          this.string(entry.kind);
          this.raw(',"byte_length":');
          this.natural(entry.byte_length);
          this.raw('}');
        }
        this.raw(']');
      }
      this.raw('}');
    }
    this.raw('],"budget":{"work":');
    this.natural(input.budget.work);
    this.raw(',"allocation_bytes":');
    this.natural(input.budget.allocation_bytes);
    this.raw('}}');
    this.current();
  }
}

/** maximumBytes is this caller's transport allocation ceiling, never a claim
 * about the selected native implementation's private work/allocation formula.
 * The original native budget is forwarded unchanged and settled by that owner. */
export function encodeAuthorAnalysisRequest(
  input: AuthorAnalysisRequestInput,
  current: () => void,
  maximumBytes: number = AUTHOR_ANALYSIS_MAXIMUM_REQUEST_BYTES
): Buffer {
  current();
  natural(input.budget.work);
  natural(input.budget.allocation_bytes);
  natural(maximumBytes);
  const maximum = Math.min(AUTHOR_ANALYSIS_MAXIMUM_REQUEST_BYTES, maximumBytes);
  const counter = new RequestWriter(maximum, current);
  counter.request(input);
  current();
  const output = Buffer.allocUnsafe(counter.size);
  const writer = new RequestWriter(counter.size, current, output);
  writer.request(input);
  if (writer.size !== counter.size) invalid('Author analysis request changed during synchronous encoding');
  return output;
}
