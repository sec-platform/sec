import { CompilerError } from '../errors.ts';

const TEMPLATE_CONTEXT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TEMPLATE_PLACEHOLDER = /__([A-Za-z_][A-Za-z0-9_]*)__/gu;
const TEMPLATE_IF_PREFIX = '/*#IF ';
const TEMPLATE_ENDIF = '/*#ENDIF*/';
export const TEMPLATE_MAX_INPUT_BYTES = 1024 * 1024;
const TEMPLATE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TEMPLATE_MAX_DIRECTIVES = 4096;
const TEMPLATE_MAX_NESTING_DEPTH = 64;

export type TemplateContextValue = string | number | boolean;
export type TemplateContext = Readonly<Record<string, TemplateContextValue>>;

function fail(code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new CompilerError(code, message, details);
}

function assertInputBound(content: string): void {
  const inputBytes = Buffer.byteLength(content, 'utf8');
  if (inputBytes > TEMPLATE_MAX_INPUT_BYTES) {
    fail('COMPOSE-TEMPLATE-006', 'Template input exceeds the canonical byte limit', {
      inputBytes,
      maximumBytes: TEMPLATE_MAX_INPUT_BYTES
    });
  }
}

function assertOutputBound(content: string): void {
  const outputBytes = Buffer.byteLength(content, 'utf8');
  if (outputBytes > TEMPLATE_MAX_OUTPUT_BYTES) {
    fail('COMPOSE-TEMPLATE-009', 'Rendered template exceeds the canonical byte limit', {
      outputBytes,
      maximumBytes: TEMPLATE_MAX_OUTPUT_BYTES
    });
  }
}

function normalizeContext(context: Readonly<Record<string, unknown>>): TemplateContext {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) {
    fail('COMPOSE-TEMPLATE-007', 'Template context must be a record of data values');
  }
  const normalized = Object.create(null) as Record<string, TemplateContextValue>;
  for (const key of Object.keys(context)) {
    if (!TEMPLATE_CONTEXT_KEY.test(key)) {
      fail('COMPOSE-TEMPLATE-007', `Template context key is not canonical: ${key}`, { key });
    }
    const descriptor = Object.getOwnPropertyDescriptor(context, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      fail('COMPOSE-TEMPLATE-007', `Template context must not contain accessors: ${key}`, { key });
    }
    const value: unknown = descriptor.value;
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      fail('COMPOSE-TEMPLATE-007', `Template context value is unsupported: ${key}`, {
        key,
        valueType: value === null ? 'null' : typeof value
      });
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function conditionValue(
  condition: string,
  context: TemplateContext
): boolean {
  const match = /^(!)?([A-Za-z_][A-Za-z0-9_]*)$/u.exec(condition);
  if (!match) {
    fail('COMPOSE-TEMPLATE-007', `Template condition is not canonical: ${condition}`, {
      condition
    });
  }
  const negated = match[1] === '!';
  const key = match[2]!;
  if (!Object.hasOwn(context, key)) {
    fail('COMPOSE-TEMPLATE-007', `Template condition references an unknown context key: ${key}`, {
      key
    });
  }
  const value = context[key];
  if (typeof value !== 'boolean') {
    fail('COMPOSE-TEMPLATE-007', `Template condition requires a boolean context value: ${key}`, {
      key,
      valueType: typeof value
    });
  }
  return negated ? !value : value;
}

function renderConditionals(content: string, context: TemplateContext): string {
  const parentActivity: boolean[] = [];
  let active = true;
  let cursor = 0;
  let directiveCount = 0;
  let output = '';

  while (cursor < content.length) {
    const marker = content.indexOf('/*#', cursor);
    if (marker === -1) {
      if (active) output += content.slice(cursor);
      break;
    }
    if (active) output += content.slice(cursor, marker);

    directiveCount += 1;
    if (directiveCount > TEMPLATE_MAX_DIRECTIVES) {
      fail('COMPOSE-TEMPLATE-008', 'Template contains too many conditional directives', {
        directiveCount,
        maximumDirectives: TEMPLATE_MAX_DIRECTIVES
      });
    }

    if (content.startsWith(TEMPLATE_ENDIF, marker)) {
      const parent = parentActivity.pop();
      if (parent === undefined) {
        fail('COMPOSE-TEMPLATE-004', 'Malformed template: unmatched /*#ENDIF*/');
      }
      active = parent;
      cursor = marker + TEMPLATE_ENDIF.length;
      continue;
    }

    if (!content.startsWith(TEMPLATE_IF_PREFIX, marker)) {
      fail('COMPOSE-TEMPLATE-002', 'Malformed template: unsupported conditional directive', {
        offset: marker
      });
    }
    const conditionEnd = content.indexOf('*/', marker + TEMPLATE_IF_PREFIX.length);
    if (conditionEnd === -1) {
      fail('COMPOSE-TEMPLATE-002', 'Malformed template: missing */ for /*#IF');
    }
    const condition = content.slice(marker + TEMPLATE_IF_PREFIX.length, conditionEnd).trim();
    const selected = conditionValue(condition, context);
    parentActivity.push(active);
    if (parentActivity.length > TEMPLATE_MAX_NESTING_DEPTH) {
      fail('COMPOSE-TEMPLATE-008', 'Template conditional nesting exceeds the canonical limit', {
        maximumDepth: TEMPLATE_MAX_NESTING_DEPTH
      });
    }
    active = active && selected;
    cursor = conditionEnd + 2;
  }

  if (parentActivity.length > 0) {
    fail('COMPOSE-TEMPLATE-003', 'Malformed template: missing /*#ENDIF*/');
  }
  assertOutputBound(output);
  return output;
}

function interpolate(content: string, context: TemplateContext): string {
  const parts: string[] = [];
  let outputBytes = 0;
  let trailingHighSurrogate = false;
  let cursor = 0;

  function append(part: string): void {
    if (part.length === 0) return;
    const first = part.charCodeAt(0);
    // A surrogate pair spanning two parts encodes as four bytes, not two
    // independent three-byte replacement characters. Count the joined text.
    outputBytes += Buffer.byteLength(part, 'utf8') - (
      trailingHighSurrogate && first >= 0xdc00 && first <= 0xdfff ? 2 : 0
    );
    if (outputBytes > TEMPLATE_MAX_OUTPUT_BYTES) {
      fail('COMPOSE-TEMPLATE-009', 'Rendered template exceeds the canonical byte limit', {
        outputBytes,
        maximumBytes: TEMPLATE_MAX_OUTPUT_BYTES
      });
    }
    const last = part.charCodeAt(part.length - 1);
    trailingHighSurrogate = last >= 0xd800 && last <= 0xdbff;
    parts.push(part);
  }

  // Check each expansion before joining it. A bounded input can otherwise
  // allocate gigabytes in String.replace before its output limit is checked.
  for (const match of content.matchAll(TEMPLATE_PLACEHOLDER)) {
    append(content.slice(cursor, match.index));
    const placeholder = match[0];
    const key = match[1]!;
    if (!Object.hasOwn(context, key)) {
      fail('COMPOSE-TEMPLATE-007', `Template placeholder references an unknown context key: ${key}`, {
        key,
        placeholder
      });
    }
    const value = context[key];
    if (typeof value !== 'string' && typeof value !== 'number') {
      fail('COMPOSE-TEMPLATE-007', `Template placeholder requires a string or number context value: ${key}`, {
        key,
        valueType: typeof value
      });
    }
    append(String(value));
    cursor = match.index + placeholder.length;
  }
  append(content.slice(cursor));
  return parts.join('');
}


/** Render bounded directives and literal substitutions without filesystem or runtime-layout effects. */
export function renderTemplateString(
  content: string,
  context: Readonly<Record<string, unknown>>
): string {
  assertInputBound(content);
  const normalizedContext = normalizeContext(context);
  return interpolate(renderConditionals(content, normalizedContext), normalizedContext);
}
