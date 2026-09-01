import { testsRelativePath } from '../../workspace/runtime/paths.ts';

export type RuntimeVerificationStep = 'unit';

export interface RuntimeVerificationInvocationDescriptor {
  readonly argvTail: readonly string[];
  readonly logicalCommandLabel: string;
  readonly packageScript: string;
}

/** Exact generated runtime unit-verification invocation. */
export const RUNTIME_VERIFICATION_INVOCATION_CONTRACT = Object.freeze({
  unit: Object.freeze({
    argvTail: Object.freeze(['test', `${testsRelativePath}/runtime/unit`]),
    logicalCommandLabel: 'bun run test:unit',
    packageScript: 'test:unit'
  })
} satisfies Record<RuntimeVerificationStep, RuntimeVerificationInvocationDescriptor>);
