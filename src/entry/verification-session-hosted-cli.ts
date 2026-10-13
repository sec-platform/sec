import {
  HOSTED_VERIFICATION_COMMANDS, type HostedVerificationCommand
} from '../application/verification-session-hosted.ts';

function isHostedVerificationCommand(value: string | undefined): value is HostedVerificationCommand {
  return HOSTED_VERIFICATION_COMMANDS.some(candidate => candidate === value);
}

/** Command-line spelling selects a workflow; it never authenticates a job. */
export function parseHostedVerificationCommand(argv: readonly string[]): Readonly<{
  command: HostedVerificationCommand; repository: string; outputPath: string;
}> {
  const command = argv[0];
  if (!isHostedVerificationCommand(command)) throw new Error(`Unknown hosted verification command: ${command ?? '<missing>'}`);
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--json') continue;
    if (flag !== '--output' && flag !== '--repository') throw new Error(`Unknown argument for ${command}: ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    args.set(flag, value);
    index += 1;
  }
  const outputPath = args.get('--output');
  if (outputPath === undefined) throw new Error('Missing required argument --output.');
  return Object.freeze({ command,
    repository: args.get('--repository') ?? 'sec-platform/sec', outputPath });
}