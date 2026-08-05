export type CompilerErrorDetails =
  | Record<string, unknown>
  | string
  | number
  | boolean
  | null
  | unknown[];

export class CompilerError extends Error {
  public readonly code: string;
  public readonly details: CompilerErrorDetails;

  constructor(code: string, message: string, details: CompilerErrorDetails = {}) {
    super(message);
    this.name = 'CompilerError';
    this.code = code;
    this.details = details;
  }
}

export function formatCompilerFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (error instanceof CompilerError && error.details) {
    return `${error.stack ?? error.message}\n${JSON.stringify(error.details, null, 2)}`;
  }

  return error.stack ?? error.message;
}
