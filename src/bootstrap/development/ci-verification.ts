import {
  CodexDevelopmentCiVerificationHostedActionCli,
  CodexDevelopmentCiVerificationMain,
  HOSTED_ACTION_COMMANDS
} from '../../adapters/verification/platform/ci/verification-cli.ts';

export const ciVerificationCommands = Object.freeze({
  hostedActionCommands: HOSTED_ACTION_COMMANDS,
  executeHostedAction: CodexDevelopmentCiVerificationHostedActionCli,
  executeVerification: CodexDevelopmentCiVerificationMain
});
