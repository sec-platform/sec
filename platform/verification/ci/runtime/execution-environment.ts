import { rawSha256 } from '../../../foundation/canonical.ts';

export const CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1 =
  'ci-execution-env-allowlist-v3' as const;

export type CodexDevelopmentCiExecutionEnvironmentBindingV1 = {
  allowlistRevision: typeof CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1;
  digest: string;
};

const AMBIENT_KEYS = [
  'PATH', 'SYSTEMROOT', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'CI',
  'SEC_CHANGED_BASE'
] as const;
const FIXED_ENVIRONMENT = Object.freeze({
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  NO_COLOR: '1',
  TZ: 'UTC'
});

function ambientValue(environment: NodeJS.ProcessEnv, key: typeof AMBIENT_KEYS[number]): string | undefined {
  if (key === 'PATH') return environment.PATH ?? environment.Path;
  if (key === 'SYSTEMROOT') return environment.SYSTEMROOT ?? environment.SystemRoot;
  return environment[key];
}

function assertEnvironmentValue(value: string, label: string): void {
  if (value.length === 0 || value.length > 32_768 || value.includes('\0')) {
    throw new Error(`${label} must be bounded non-empty text without NUL characters.`);
  }
}

function canonicalEnvironmentDigest(environment: Readonly<Record<string, string>>): string {
  const entries = Object.entries(environment)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return rawSha256(JSON.stringify(entries));
}

export function CodexDevelopmentBuildSanitizedChildEnvironmentV1(
  ambientEnvironment: NodeJS.ProcessEnv,
  policyEnvironment: Readonly<Record<string, string>>,
  gateId: string
): { environment: NodeJS.ProcessEnv; binding: CodexDevelopmentCiExecutionEnvironmentBindingV1 } {
  const environment: Record<string, string> = {};
  for (const key of AMBIENT_KEYS) {
    const value = ambientValue(ambientEnvironment, key);
    if (value === undefined || value.length === 0) continue;
    assertEnvironmentValue(value, `CI execution ambient ${key}`);
    if (key === 'SEC_CHANGED_BASE' && !/^[0-9a-f]{40}$/u.test(value)) {
      throw new Error('CI execution ambient SEC_CHANGED_BASE must be an exact lowercase commit SHA.');
    }
    environment[key] = value;
  }
  Object.assign(environment, FIXED_ENVIRONMENT);
  for (const [key, value] of Object.entries(policyEnvironment)) {
    if (!/^SEC_RUN_[A-Z0-9_]+$/u.test(key) || value !== '1') {
      throw new Error(`CI execution policy environment may only opt into SEC_RUN_* sentinels with value 1.`);
    }
    if (key in environment || AMBIENT_KEYS.includes(key as typeof AMBIENT_KEYS[number]) || key in FIXED_ENVIRONMENT) {
      throw new Error(`CI execution policy environment cannot replace reserved key ${key}.`);
    }
    assertEnvironmentValue(value, `CI execution policy ${key}`);
    environment[key] = value;
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(gateId)) throw new Error('CI execution gate ID is invalid.');
  environment.SEC_TEST_WORKSPACE_NAMESPACE =
    `verification-${gateId.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`;
  const canonical = Object.fromEntries(Object.entries(environment)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return {
    environment: canonical,
    binding: {
      allowlistRevision: CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1,
      digest: canonicalEnvironmentDigest(canonical)
    }
  };
}

export function CodexDevelopmentAssertCiExecutionEnvironmentBindingV1(
  value: CodexDevelopmentCiExecutionEnvironmentBindingV1
): void {
  if (value.allowlistRevision !== CodexDevelopmentCiExecutionEnvironmentAllowlistRevisionV1) {
    throw new Error('CI execution environment allowlist revision mismatch.');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(value.digest)) {
    throw new Error('CI execution environment digest is invalid.');
  }
}
