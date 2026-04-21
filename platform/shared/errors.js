export class CompilerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CompilerError';
    this.code = code;
    this.details = details;
  }
}
