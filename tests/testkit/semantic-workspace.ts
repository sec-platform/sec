import { prepareResolvedWorkspace, prepareVerifiedWorkspace } from './workspace.ts';

let resolvedTicketWorkspace: Promise<string> | undefined;
let verifiedTicketWorkspace: Promise<string> | undefined;

export function sharedResolvedTicketWorkspace(): Promise<string> {
  resolvedTicketWorkspace ??= prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-shared-semantic-resolved-'
  });
  return resolvedTicketWorkspace;
}

export function sharedVerifiedTicketWorkspace(): Promise<string> {
  verifiedTicketWorkspace ??= prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-shared-semantic-verified-'
  });
  return verifiedTicketWorkspace;
}
