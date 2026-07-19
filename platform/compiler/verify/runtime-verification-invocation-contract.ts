export type RuntimeVerificationStep = 'build' | 'unit' | 'acceptance';

export interface RuntimeVerificationInvocationDescriptorV1 {
  readonly argvTail: readonly string[];
  readonly logicalCommandLabel: string;
  readonly moduleRelativePath: string | null;
  readonly packageManifest: Readonly<{
    readonly name: string;
    readonly relativePath: string;
  }> | null;
  readonly packageScript: string;
}

/**
 * Canonical runtime-verification invocation contract.
 *
 * logicalCommandLabel is the stable path-free report label. moduleRelativePath,
 * packageManifest, and argvTail own the exact isolated invocation without
 * binding host paths.
 */
export const RUNTIME_VERIFICATION_INVOCATION_CONTRACT = Object.freeze({
  build: Object.freeze({
    argvTail: Object.freeze(['build', '--webpack']),
    logicalCommandLabel: 'bun run build',
    moduleRelativePath: 'next/dist/bin/next',
    packageManifest: Object.freeze({ name: 'next', relativePath: 'next/package.json' }),
    packageScript: 'build'
  }),
  unit: Object.freeze({
    argvTail: Object.freeze(['test', 'tests/runtime/unit']),
    logicalCommandLabel: 'bun run test:unit',
    moduleRelativePath: null,
    packageManifest: null,
    packageScript: 'test:unit'
  }),
  acceptance: Object.freeze({
    argvTail: Object.freeze(['test', '--config', 'playwright.config.ts']),
    logicalCommandLabel: 'bun run test:acceptance',
    moduleRelativePath: '@playwright/test/cli.js',
    packageManifest: Object.freeze({
      name: '@playwright/test',
      relativePath: '@playwright/test/package.json'
    }),
    packageScript: 'test:acceptance'
  })
} satisfies Record<RuntimeVerificationStep, RuntimeVerificationInvocationDescriptorV1>);
