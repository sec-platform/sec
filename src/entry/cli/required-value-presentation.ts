import type { JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

/** Entry presents one successfully read value. A rejected read emits no success frame. */
export async function presentRequiredValue<T>(
  read: () => Promise<T>,
  output: JsonOpts,
  formatText: (value: T) => string
): Promise<void> {
  if (typeof read !== 'function' || typeof formatText !== 'function') {
    throw new TypeError('Required value reader and formatter must be callable');
  }
  const value = await read();
  printJsonOrText(value, output, formatText);
}
