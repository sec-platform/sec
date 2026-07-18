export type RuntimeVerificationStep = 'build' | 'unit' | 'acceptance';

export interface RuntimeVerificationInvocationDescriptorV1 {
  readonly argvTail: readonly string[];
  readonly logicalCommandLabel: string;
  readonly moduleRelativePath: string | null;
  readonly packageScript: string;
}

/**
 * Canonical runtime-verification invocation contract.
 *
 * logicalCommandLabel is the stable path-free report label. moduleRelativePath
 * and argvTail own the exact isolated invocation without binding host paths.
 */
export const RUNTIME_VERIFICATION_INVOCATION_CONTRACT = Object.freeze({
  build: Object.freeze({
    argvTail: Object.freeze(['build', '--webpack']),
    logicalCommandLabel: 'bun run build',
    moduleRelativePath: 'next/dist/bin/next',
    packageScript: 'build'
  }),
  unit: Object.freeze({
    argvTail: Object.freeze(['test', 'tests/runtime/unit']),
    logicalCommandLabel: 'bun run test:unit',
    moduleRelativePath: null,
    packageScript: 'test:unit'
  }),
  acceptance: Object.freeze({
    argvTail: Object.freeze(['test', '--config', 'playwright.config.ts']),
    logicalCommandLabel: 'bun run test:acceptance',
    moduleRelativePath: '@playwright/test/cli.js',
    packageScript: 'test:acceptance'
  })
} satisfies Record<RuntimeVerificationStep, RuntimeVerificationInvocationDescriptorV1>);
