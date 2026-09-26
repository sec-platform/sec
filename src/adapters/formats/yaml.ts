import { parseDocument as parseExternalYamlDocument, type Document } from 'yaml';

import { FailureError } from '../../contracts/failure.ts';

export interface YamlInputAdmission {
  readonly label: string;
  readonly maximumInputBytes: number;
  /** Object-valued DTO domains may require scalar string keys. The default
   * stays with the library for AST consumers that own non-string YAML keys. */
  readonly stringKeys?: boolean;
}

export interface YamlValueAdmission extends YamlInputAdmission {
  readonly maximumAliasCount: number;
}

export type StrictYamlDocument = Document.Parsed;
export type YamlSyntaxFailureKind = 'duplicate-key' | 'invalid-yaml' | 'resource-exhaustion';

export class YamlInputLimitError extends FailureError {
  readonly kind = 'input-too-large' as const;
  readonly actualInputBytes: number;
  readonly maximumInputBytes: number;

  constructor(label: string, actualInputBytes: number, maximumInputBytes: number) {
    super(
      'YAML-INPUT-001',
      `${label} exceeds its UTF-8 input byte limit`,
      { kind: 'input-too-large', actualInputBytes, maximumInputBytes }
    );
    this.name = 'YamlInputLimitError';
    this.actualInputBytes = actualInputBytes;
    this.maximumInputBytes = maximumInputBytes;
  }
}

export class YamlSyntaxError extends FailureError {
  readonly kind: YamlSyntaxFailureKind;
  readonly yamlErrorCode: string | null;

  constructor(
    label: string,
    kind: YamlSyntaxFailureKind,
    yamlErrorCode: string | null,
    options?: ErrorOptions
  ) {
    super(
      'YAML-SYNTAX-001',
      `${label} is not one valid strict YAML document`,
      { kind, yamlErrorCode },
      options
    );
    this.name = 'YamlSyntaxError';
    this.kind = kind;
    this.yamlErrorCode = yamlErrorCode;
  }
}

export type YamlParseFailure = YamlInputLimitError | YamlSyntaxError;

export function isYamlParseFailure(error: unknown): error is YamlParseFailure {
  return error instanceof YamlInputLimitError || error instanceof YamlSyntaxError;
}

function validateInputAdmission(admission: YamlInputAdmission): void {
  if (admission.stringKeys !== undefined && typeof admission.stringKeys !== 'boolean') {
    throw new TypeError('YAML stringKeys admission must be boolean');
  }
  if (typeof admission.label !== 'string' || admission.label.trim().length === 0) {
    throw new TypeError('YAML input admission requires one non-empty label');
  }
  if (!Number.isSafeInteger(admission.maximumInputBytes) || admission.maximumInputBytes <= 0) {
    throw new TypeError('YAML input admission maximumInputBytes must be one positive safe integer');
  }
}

function yamlErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

function yamlSyntaxFailureKind(error: unknown): YamlSyntaxFailureKind {
  const code = yamlErrorCode(error);
  if (code === 'DUPLICATE_KEY') return 'duplicate-key';
  if (code === 'RESOURCE_EXHAUSTION') return 'resource-exhaustion';
  return 'invalid-yaml';
}

function syntaxFailure(label: string, error: unknown): YamlSyntaxError {
  return new YamlSyntaxError(
    label,
    yamlSyntaxFailureKind(error),
    yamlErrorCode(error),
    error instanceof Error ? { cause: error } : undefined
  );
}

function parseAdmittedYamlDocument(
  source: string,
  admission: YamlInputAdmission,
  keepSourceTokens: boolean
): StrictYamlDocument {
  validateInputAdmission(admission);
  const actualInputBytes = Buffer.byteLength(source, 'utf8');
  if (actualInputBytes > admission.maximumInputBytes) {
    throw new YamlInputLimitError(admission.label, actualInputBytes, admission.maximumInputBytes);
  }

  let document: StrictYamlDocument;
  try {
    document = parseExternalYamlDocument(source, {
      keepSourceTokens,
      // yaml's silent mode also suppresses MULTIPLE_DOCS diagnostics in
      // parseDocument. Keep errors while the wrapper owns their presentation.
      logLevel: 'error',
      strict: true,
      uniqueKeys: true,
      ...(admission.stringKeys === undefined ? {} : { stringKeys: admission.stringKeys })
    });
  } catch (error) {
    throw syntaxFailure(admission.label, error);
  }
  const failure = document.errors[0] ?? document.warnings[0];
  if (failure !== undefined) throw syntaxFailure(admission.label, failure);
  return document;
}

/** Parse one strict YAML document for a domain that intentionally owns its AST. */
export function parseYamlDocument(
  source: string,
  admission: YamlInputAdmission
): StrictYamlDocument {
  return parseAdmittedYamlDocument(source, admission, true);
}

/** Parse one strict YAML document into a value; domain schema validation remains separate. */
export function parseYamlValue(
  source: string,
  admission: YamlValueAdmission
): unknown {
  if (!Number.isSafeInteger(admission.maximumAliasCount) || admission.maximumAliasCount < 0) {
    throw new TypeError('YAML value admission maximumAliasCount must be one non-negative safe integer');
  }
  // Value consumers do not receive the AST. Do not retain extra concrete
  // syntax tokens that only AST-editing consumers can use.
  const document = parseAdmittedYamlDocument(source, admission, false);
  try {
    return document.toJS({ maxAliasCount: admission.maximumAliasCount }) as unknown;
  } catch (error) {
    throw syntaxFailure(admission.label, error);
  }
}
