import { parseGeneratedStateOperation } from '../../application/generated-state/operation.ts';
import type { GeneratedStateDomainOwnerOperation } from '../../execution/generated-state/operation-port.ts';
import { createDependencyOperation } from '../toolchain/dependency-operation.ts';
import { createGeneratedStateRegistrationBootstrap } from './generated-state.ts';

export function runGeneratedStateOperation(args: readonly string[], repositoryRoot = process.cwd(),
  owners?: readonly GeneratedStateDomainOwnerOperation[]) {
  const parsed = parseGeneratedStateOperation(args);
  const selected = owners ?? [createDependencyOperation({ workspaceRoot: parsed.workspaceRoot }).generatedStateOwner];
  return createGeneratedStateRegistrationBootstrap({ workspaceRoot: parsed.workspaceRoot }).runOperation(parsed, repositoryRoot, selected);
}
