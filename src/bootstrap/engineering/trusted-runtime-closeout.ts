#!/usr/bin/env bun
import { withGitHubCredentialBootstrap } from '../../adapters/providers/github-api/credential-bootstrap.ts';
import { runTrustedRuntimeOperatorCli } from '../../adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { createTrustedSourceProgramTransitionUseCase } from './source-program-transition-runtime.ts';

if (import.meta.main) {
  const useCase = createTrustedSourceProgramTransitionUseCase();
  await withGitHubCredentialBootstrap(process.argv.slice(2),
    (argv) => runTrustedRuntimeOperatorCli(argv, useCase));
}
