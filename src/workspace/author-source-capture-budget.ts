import { types as nodeTypes } from 'node:util';
import { isPlainObject } from '../contracts/canonical.ts';
import { CodedFailure } from '../contracts/failure.ts';

/** One capture-scoped work budget, not a heap ceiling or a compiler execution deadline.
 * Hosts may replace all fields with their own positive safe-integer limits. */
export interface AuthorSourceCaptureBudget {
  readonly maximumNodes: number;
  readonly maximumEntries: number;
  readonly maximumTextBytes: number;
  readonly maximumDepth: number;
}

export const DEFAULT_AUTHOR_SOURCE_CAPTURE_BUDGET: Readonly<AuthorSourceCaptureBudget> =
  Object.freeze({
    maximumNodes: 100_000,
    maximumEntries: 100_000,
    maximumTextBytes: 16 * 1024 * 1024,
    maximumDepth: 4_096
  });

/** Freeze policy before inspecting input; unknown or accessor-backed options
 * cannot silently omit a required ceiling. The caller owns its chosen policy. */
export function requireAuthorSourceCaptureBudget(
  value: AuthorSourceCaptureBudget = DEFAULT_AUTHOR_SOURCE_CAPTURE_BUDGET
): Readonly<AuthorSourceCaptureBudget> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || nodeTypes.isProxy(value)
      || !isPlainObject(value)) {
    throw new TypeError('Author source capture budget must be a plain data object');
  }
  const keys = ['maximumNodes', 'maximumEntries', 'maximumTextBytes', 'maximumDepth'] as const;
  const observed = Reflect.ownKeys(value);
  if (observed.length !== keys.length || observed.some(key => !keys.includes(key as typeof keys[number]))) {
    throw new TypeError('Author source capture budget must specify exactly its four ceilings');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const checked = {} as Record<typeof keys[number], number>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')
        || !Number.isSafeInteger(descriptor.value) || descriptor.value < 1) {
      throw new TypeError('Author source capture ceilings must be positive safe integers');
    }
    checked[key] = descriptor.value as number;
  }
  return Object.freeze(checked);
}

/** Admit an ordinary value graph before structuredClone can evaluate getters
 * or materialize an adversarial sparse array. Count each reference edge for
 * work, but traverse a shared/cyclic container's own entries only once.
 * Structural drafts remain valid even if later semantic compilation rejects
 * their meaning. This is not a process-memory or time preemption guarantee. */
export function assertAuthorSourceCaptureBudget(
  root: unknown,
  budget: Readonly<AuthorSourceCaptureBudget>,
  unsupportedCode: string = 'AUTHOR-CANDIDATE-001'
): void {
  const seen = new WeakSet<object>();
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value: root, depth: 0 }];
  let nodes = 0;
  let entries = 0;
  let textBytes = 0;

  const chargeText = (value: string): void => {
    // Every UTF-16 code unit uses at least one UTF-8 byte after replacement.
    if (value.length > budget.maximumTextBytes - textBytes) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source UTF-8 text budget exceeded');
    }
    const size = Buffer.byteLength(value, 'utf8');
    if (size > budget.maximumTextBytes - textBytes) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source UTF-8 text budget exceeded');
    }
    textBytes += size;
  };
  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (++nodes > budget.maximumNodes || depth > budget.maximumDepth) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source node or depth budget exceeded');
    }
    if (typeof value === 'string') {
      chargeText(value);
      continue;
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      throw new CodedFailure(unsupportedCode, 'Author source cannot capture executable or symbol values');
    }
    if (value === null || typeof value !== 'object') continue;
    if (nodeTypes.isProxy(value) || (!Array.isArray(value) && !isPlainObject(value))) {
      throw new CodedFailure(unsupportedCode, 'Author source accepts ordinary data containers only');
    }
    if (seen.has(value)) continue;
    seen.add(value);

    const isArray = Array.isArray(value);
    const memberCount = isArray ? value.length : 0;
    if (isArray && memberCount > budget.maximumEntries - entries) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source entry budget exceeded');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > budget.maximumEntries - entries + (isArray ? 1 : 0)) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source entry budget exceeded');
    }
    // Dense indices are already charged by array.length. Extra properties
    // must not borrow those slots to escape the aggregate entry budget.
    let extraKeys = 0;
    if (isArray) {
      for (const key of keys) {
        if (key === 'length') continue;
        const numeric = typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(key)
          ? Number(key) : NaN;
        if (!Number.isSafeInteger(numeric) || numeric >= memberCount) extraKeys += 1;
      }
    }
    entries += isArray ? memberCount + extraKeys : keys.length;
    if (entries > budget.maximumEntries) {
      throw new CodedFailure('AUTHOR-SOURCE-RESOURCE-001', 'Author source entry budget exceeded');
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]!;
      if (isArray && key === 'length') continue;
      if (typeof key !== 'string') {
        throw new CodedFailure(unsupportedCode, 'Author source has unsupported symbol fields');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw new CodedFailure(unsupportedCode, 'Author source cannot evaluate getter-backed fields');
      }
      chargeText(key);
      // Nonenumerable metadata does not become cloned source. It is counted
      // and checked but deliberately does not acquire semantic authority.
      if (descriptor.enumerable) pending.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}
