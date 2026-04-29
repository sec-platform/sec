import type { LockFile, PassState } from '../shared/lock-types.ts';
import type { Logger } from '../shared/logger.ts';
import { defaultLogger } from '../shared/logger.ts';
import { PASS_DEPENDENCIES } from '../shared/constants.ts';

export interface PassContext {
  workspaceRoot: string;
  lock: LockFile;
  logger: Logger;
}

export interface CompilerPass<TInput, TOutput> {
  readonly name: string;
  readonly dependencies: readonly string[];
  execute(input: TInput, context: PassContext): Promise<TOutput>;
}

export class PassPipeline {
  private passes: Map<string, CompilerPass<unknown, unknown>> = new Map();
  private logger: Logger;

  constructor(logger: Logger = defaultLogger) {
    this.logger = logger;
  }

  register<TInput, TOutput>(pass: CompilerPass<TInput, TOutput>): this {
    this.passes.set(pass.name, pass as CompilerPass<unknown, unknown>);
    return this;
  }

  get<TInput, TOutput>(name: string): CompilerPass<TInput, TOutput> | undefined {
    return this.passes.get(name) as CompilerPass<TInput, TOutput> | undefined;
  }

  has(name: string): boolean {
    return this.passes.has(name);
  }

  async executeSequential<TInput>(
    names: readonly string[],
    input: TInput,
    context: PassContext
  ): Promise<{ lock: LockFile; results: Map<string, unknown> }> {
    const results = new Map<string, unknown>();
    let currentInput: unknown = input;

    for (const name of names) {
      const pass = this.passes.get(name);
      if (!pass) {
        throw new Error(`Unknown pass: "${name}"`);
      }

      const deps = PASS_DEPENDENCIES[name] ?? [];
      for (const dep of deps) {
        if (!results.has(dep)) {
          throw new Error(`Pass "${name}" dependency "${dep}" has not been executed`);
        }
      }

      this.logger.info(`[PASS] ${name} starting...`);
      const output = await pass.execute(currentInput, context);
      results.set(name, output);
      currentInput = output;
      this.logger.info(`[PASS] ${name} completed`);
    }

    return { lock: context.lock, results };
  }

  getStatus(name: string, lock: LockFile): PassState {
    const passStatus = (lock.passStatus as unknown as Record<string, PassState>)[name];
    return passStatus ?? 'pending';
  }
}

export function createPassContext(workspaceRoot: string, lock: LockFile, logger?: Logger): PassContext {
  return {
    workspaceRoot,
    lock,
    logger: logger ?? defaultLogger
  };
}
