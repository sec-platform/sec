import { buildErrorProtocolContract as buildApplicationErrorProtocolContract } from '../../application/error-protocol-contract.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';

export type { ErrorProtocolContract } from '../../application/error-protocol-contract.ts';

export function buildErrorProtocolContract() {
  return buildApplicationErrorProtocolContract(platformCommand('contract', 'errors', '--json'));
}
