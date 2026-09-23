/** Canonical executable identity for the repository development runner. */
export const DEV_RUNNER_ENTRYPOINT_PATH = 'src/adapters/self-hosting/development/runner/cli.ts' as const;

// Canonical aggregate limits for one generic development command. Long-lived
// domain operations must present their own issued admission instead of
// changing or copying these values.
export const DEV_COMMAND_MAX_DURATION_MS = 5 * 60 * 1000;
export const DEV_COMMAND_MAX_STDIN_BYTES = 1024 * 1024;
