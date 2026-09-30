import {
  currentGitHubCredentialStoreIdentity,
  withGitHubCredentialStore
} from './credential-store.ts';

const STORE_OPTION = '--github-credential-store';
const IDENTITY_OPTION = '--github-credential-store-identity';

export function parseGitHubCredentialBootstrapArguments(argv: readonly string[]): Readonly<{
  args: string[];
  directoryPath?: string;
  expectedIdentityDigest?: string;
}> {
  const args: string[] = [];
  const selected = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== STORE_OPTION && argument !== IDENTITY_OPTION) {
      args.push(argument);
      continue;
    }
    const value = argv[++index];
    if (selected.has(argument) || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid or duplicate ${argument}`);
    }
    selected.set(argument, value);
  }
  const directoryPath = selected.get(STORE_OPTION);
  const expectedIdentityDigest = selected.get(IDENTITY_OPTION);
  if (expectedIdentityDigest !== undefined && (directoryPath === undefined ||
      !/^sha256:[0-9a-f]{64}$/u.test(expectedIdentityDigest))) {
    throw new Error('Credential store identity requires an explicit store and a SHA-256 digest');
  }
  return { args, ...(directoryPath === undefined ? {} : { directoryPath }),
    ...(expectedIdentityDigest === undefined ? {} : { expectedIdentityDigest }) };
}

/** A CLI argument is an explicit resource selection, never an ambient grant. */
export async function withGitHubCredentialBootstrap<T>(
  argv: readonly string[], operation: (args: string[]) => Promise<T>
): Promise<T> {
  const selection = parseGitHubCredentialBootstrapArguments(argv);
  if (selection.directoryPath === undefined) return operation(selection.args);
  return withGitHubCredentialStore({
    directoryPath: selection.directoryPath,
    repositoryRoot: process.cwd(),
    ...(selection.expectedIdentityDigest === undefined ? {} : {
      expectedIdentityDigest: selection.expectedIdentityDigest
    })
  }, () => operation(selection.args));
}

/** Fresh processes re-admit the same physical store, not just the same name. */
export function githubCredentialBootstrapHandoffArguments(argv: readonly string[]): string[] {
  const selection = parseGitHubCredentialBootstrapArguments(argv);
  const identity = currentGitHubCredentialStoreIdentity();
  if (identity === undefined) {
    if (selection.directoryPath !== undefined) throw new Error('Credential store handoff has no live binding');
    return [...argv];
  }
  if (selection.directoryPath === undefined) throw new Error('Credential store handoff lost explicit selection');
  return [...selection.args, STORE_OPTION, selection.directoryPath, IDENTITY_OPTION, identity];
}
