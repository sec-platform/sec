import type { Logger } from '../shared/logger.ts';
import { defaultLogger } from '../shared/logger.ts';

export interface CommandContext {
  cwd: string;
  logger: Logger;
}

export interface CommandHandler {
  readonly name: string;
  readonly usage: string;
  execute(args: string[], ctx: CommandContext): Promise<void>;
}

export class CommandRegistry {
  private commands = new Map<string, CommandHandler>();
  readonly logger: Logger;

  constructor(logger: Logger = defaultLogger) {
    this.logger = logger;
  }

  register(handler: CommandHandler): this {
    if (this.commands.has(handler.name)) {
      this.logger.warn(`Command "${handler.name}" is being overridden`);
    }
    this.commands.set(handler.name, handler);
    return this;
  }

  registerAll(handlers: CommandHandler[]): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  get(name: string): CommandHandler | undefined {
    return this.commands.get(name);
  }

  getNames(): string[] {
    return [...this.commands.keys()].sort((left, right) => left.localeCompare(right));
  }

  buildUsage(): string {
    const names = this.getNames();
    const commandList = names.map((name) => `  ${name}`).join('\n');
    return `Usage: platform <command> [args...]\n\nCommands:\n${commandList}`;
  }

  async dispatch(rawArgs: string[], ctx: CommandContext): Promise<void> {
    const [command, ...rest] = rawArgs;
    if (!command) {
      console.log(this.buildUsage());
      return;
    }

    const handler = this.commands.get(command);
    if (!handler) {
      console.log(this.buildUsage());
      return;
    }

    await handler.execute(rest, ctx);
  }
}

export const defaultRegistry = new CommandRegistry();
