import { platformCommand } from '../../adapters/verification/platform/command.ts';
import { buildErrorProtocolContract as buildApplicationErrorProtocolContract } from '../../application/error-protocol-contract.ts';

;

export function buildErrorProtocolContract() {
  return buildApplicationErrorProtocolContract(platformCommand('contract', 'errors', '--json'));
}
