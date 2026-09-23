/** Value/formatter pairing preserves their type relation at the output boundary.
 * The presentation is immutable; a domain result retains its own lifecycle. */
export interface CommandValue {
  readonly value: unknown;
  readonly formatText: () => string;
}

export function commandValue<T>(value: T, format: (value: T) => string): CommandValue {
  return Object.freeze({ value, formatText: () => format(value) });
}
