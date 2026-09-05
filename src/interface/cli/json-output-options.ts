import { decodeBooleanFlag } from './boolean-option.ts';

/** One owner for JSON output fields, defaults, CLI spelling and dependencies. */
export const JSON_OUTPUT_OPTIONS = Object.freeze([
  Object.freeze({ name: 'json', flags: '--json', description: 'Output as JSON',
    defaultValue: false, requires: Object.freeze([]) }),
  Object.freeze({ name: 'compact', flags: '--compact', description: 'Compact JSON output',
    defaultValue: false, requires: Object.freeze(['json'] as const) })
] as const);

export type JsonOutputOptionName = (typeof JSON_OUTPUT_OPTIONS)[number]['name'];
export type JsonOutputOptions = Readonly<Record<JsonOutputOptionName, boolean>>;
export type JsonOutputIssue = Readonly<{
  kind: 'invalid-boolean' | 'missing-dependency';
  option: JsonOutputOptionName;
  message: string;
}>;

/** Decode once before effects. Callers only translate diagnostics, not policy. */
export function parseJsonOutputOptions(
  input: Readonly<Record<string, unknown>>,
  reject: (issue: JsonOutputIssue) => never
): JsonOutputOptions {
  // Capture every owned field before invoking a caller's error adapter. Do
  // not enumerate unrelated options or invoke any input conversion hook.
  const captured = JSON_OUTPUT_OPTIONS.map((definition) =>
    [definition, input[definition.name]] as const);
  const output = Object.fromEntries(captured.map(([definition, value]) => {
    return [definition.name, decodeBooleanFlag(value, definition.defaultValue, () =>
      reject({ kind: 'invalid-boolean', option: definition.name,
        message: `${definition.flags} must be a boolean flag` }))];
  })) as Record<JsonOutputOptionName, boolean>;
  for (const definition of JSON_OUTPUT_OPTIONS) {
    if (!output[definition.name]) continue;
    for (const required of definition.requires) {
      if (!output[required]) return reject({ kind: 'missing-dependency', option: definition.name,
        message: `${definition.flags} requires --${required}` });
    }
  }
  return Object.freeze(output);
}
