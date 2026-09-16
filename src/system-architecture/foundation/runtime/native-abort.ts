// Capture the native state operations once. An AbortSignal's own properties,
// overridden methods and synthetic EventTarget events do not define cancellation.
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const throwAborted = AbortSignal.prototype.throwIfAborted;
const combine = AbortSignal.any;
const abortedSignal = AbortSignal.abort;
const reason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;

export function assertNativeAbortSignal(value: unknown): asserts value is AbortSignal {
  Reflect.apply(aborted, value, []);
}

export function isNativeAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && Reflect.apply(aborted, signal, []);
}

export function throwIfNativeAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined) Reflect.apply(throwAborted, signal, []);
}

/** A private dependent signal observes real abort state, not source dispatchEvent.
 * Native combinators may consult public state accessors during construction.
 * Already-aborted parents are projected from native slots. Live parents must
 * retain native state accessors; reject overrides without invoking them.
 * This is cancellation plumbing, not permission or physical-stop evidence. */
export function linkNativeAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const sources: AbortSignal[] = [];
  for (const signal of signals) {
    if (signal === undefined) continue;
    assertNativeAbortSignal(signal);
    sources.push(signal);
  }
  for (const signal of sources) {
    if (isNativeAborted(signal)) return Reflect.apply(abortedSignal, AbortSignal, [Reflect.apply(reason, signal, [])]);
  }
  for (const signal of sources) {
    for (const [key, getter] of [['aborted', aborted], ['reason', reason]] as const) {
      let owner: object | null = signal;
      while (owner !== null) {
        const slot = Object.getOwnPropertyDescriptor(owner, key);
        if (slot !== undefined) {
          if (slot.get !== getter) throw new TypeError('Live cancellation sources must expose native state accessors');
          break;
        }
        owner = Object.getPrototypeOf(owner);
      }
      if (owner === null) throw new TypeError('Live cancellation source has no native state accessor');
    }
  }
  return Reflect.apply(combine, AbortSignal, [sources]);
}
