export type CompilerErrorDetails = Record<string, unknown> | unknown;

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
