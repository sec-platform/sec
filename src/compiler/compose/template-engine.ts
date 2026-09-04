import path from 'node:path';

import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryFile
} from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compilerRuntimeResources } from '../../toolchain/runtime.ts';
import { resolvePathInside } from '../../workspace/runtime/paths.ts';
import { CompilerError } from '../errors.ts';

const TEMPLATES_DIR = compilerRuntimeResources.composeTemplates;
const TEMPLATE_CONTEXT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TEMPLATE_IF_PREFIX = '/*#IF ';
const TEMPLATE_ENDIF = '/*#ENDIF*/';
const TEMPLATE_MAX_INPUT_BYTES = 1024 * 1024;
const TEMPLATE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const TEMPLATE_MAX_DIRECTIVES = 4096;
const TEMPLATE_MAX_NESTING_DEPTH = 64;

export type TemplateContextValue = string | number | boolean | null | undefined;
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
  const normalized = Object.create(null) as Record<string, TemplateContextValue>;
  for (const [key, value] of Object.entries(context)) {
    if (!TEMPLATE_CONTEXT_KEY.test(key)) {
      fail('COMPOSE-TEMPLATE-007', `Template context key is not canonical: ${key}`, { key });
    }
    if (
      value !== null &&
      value !== undefined &&
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      fail('COMPOSE-TEMPLATE-007', `Template context value is unsupported: ${key}`, {
        key,
        valueType: typeof value
      });
    }
    normalized[key] = value as TemplateContextValue;
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
      valueType: value === null ? 'null' : typeof value
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
    parentActivity.push(active);
    if (parentActivity.length > TEMPLATE_MAX_NESTING_DEPTH) {
      fail('COMPOSE-TEMPLATE-008', 'Template conditional nesting exceeds the canonical limit', {
        maximumDepth: TEMPLATE_MAX_NESTING_DEPTH
      });
    }
    active = active && conditionValue(condition, context);
    cursor = conditionEnd + 2;
  }

  if (parentActivity.length > 0) {
    fail('COMPOSE-TEMPLATE-003', 'Malformed template: missing /*#ENDIF*/');
  }
  assertOutputBound(output);
  return output;
}

function interpolate(content: string, context: TemplateContext): string {
  let result = content;
  for (const [key, value] of Object.entries(context)) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const replacement = String(value);
    result = result.replaceAll(`__${key}__`, () => replacement);
    assertOutputBound(result);
  }
  return result;
}

export class TemplateEngine {
  /** Render one retained template file strictly inside the supplied root. */
  public static render(
    templateName: string,
    context: Readonly<Record<string, unknown>>,
    templatesDir: string = TEMPLATES_DIR
  ): string {
    const filePath = resolvePathInside(templatesDir, templateName);
    if (filePath === null) {
      fail('COMPOSE-TEMPLATE-005', `Scaffold template path escapes its allowed root: ${templateName}`, {
        templateName
      });
    }
    const bytes = readOptionalRetainedOrdinaryFile(filePath, `Scaffold template ${templateName}`);
    if (bytes === null) {
      fail('COMPOSE-TEMPLATE-001', `Scaffold template not found: ${filePath}`);
    }
    if (bytes.byteLength > TEMPLATE_MAX_INPUT_BYTES) {
      fail('COMPOSE-TEMPLATE-006', 'Template input exceeds the canonical byte limit', {
        inputBytes: bytes.byteLength,
        maximumBytes: TEMPLATE_MAX_INPUT_BYTES,
        templateName
      });
    }
    return this.renderString(
      decodeExactUtf8(bytes, `Scaffold template ${templateName}`),
      context
    );
  }

  /** Render bounded, exactly paired conditional directives and literal text substitutions. */
  public static renderString(
    content: string,
    context: Readonly<Record<string, unknown>>
  ): string {
    assertInputBound(content);
    const normalizedContext = normalizeContext(context);
    return interpolate(renderConditionals(content, normalizedContext), normalizedContext);
  }
}
