import { SecError } from '../contracts/failure.ts';

/** Bounded in-process query lifetime, not a worker pool or a physical resource
 * sandbox. Accepted work owns its slot through settlement; close only drains. */
export function createRuntimeQueryScope(maximumPendingQueries: number) {
  if (!Number.isSafeInteger(maximumPendingQueries) || maximumPendingQueries < 1) {
    throw new TypeError('Semantic runtime maximumPendingQueries must be a positive safe integer');
  }
  let accepting = true;
  let closed: Promise<void> | undefined;
  const pending = new Set<Promise<void>>();
  const assertAccepting = (): void => {
    if (!accepting) throw new SecError('RUNTIME-CLOSED-001', 'Semantic runtime is closed');
  };

  const run = <Prepared, Result>(
    prepare: () => Prepared,
    execute: (prepared: Prepared) => Result | PromiseLike<Result>
  ): Promise<Result> => {
    try {
      assertAccepting();
      if (pending.size >= maximumPendingQueries) {
        throw new SecError('RUNTIME-BUSY-001', 'Semantic runtime query capacity is exhausted');
      }
    } catch (error) { return Promise.reject(error); }

    let finish!: () => void;
    const settled = new Promise<void>(resolve => { finish = resolve; });
    // Reserve before source capture. Reentrant close observes even a request
    // whose synchronous capture has not yet produced its execution promise.
    pending.add(settled);
    const release = () => { pending.delete(settled); finish(); };
    let prepared: Prepared;
    try {
      prepared = prepare();
      assertAccepting();
    } catch (error) {
      release();
      return Promise.reject(error);
    }
    const result = Promise.resolve().then(() => execute(prepared));
    void result.then(release, release);
    return result;
  };

  return Object.freeze({
    maximumPendingQueries,
    assertAccepting,
    run,
    close: (): Promise<void> => {
      accepting = false;
      // Tickets settle only when their corresponding capture/execution really
      // ends. Query rejection is returned to its caller, not turned into success.
      closed ??= Promise.all([...pending]).then(() => undefined);
      return closed;
    }
  });
}
