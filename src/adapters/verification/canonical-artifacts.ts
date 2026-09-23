import { Buffer } from 'node:buffer';
import { assertCanonicalVerificationArtifactSet, type CanonicalVerificationArtifactSet } from '../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { resolveWorkspaceArtifactPath } from '../workspace-context.ts';
import { readOptionalAuthorityBytes } from '../workspace/sources/read-authority-source.ts';

export async function readCanonicalJsonArtifact<T>(
  filePath: string,
  label: string,
  validate: (value: unknown) => T = (value) => value as T
): Promise<T> {
  let rawBytes: Buffer;
  try {
    const observed = readOptionalAuthorityBytes(filePath, `Pipeline completion ${label}`);
    if (observed === null) throw new Error('not found');
    rawBytes = Buffer.from(observed);
  } catch (error) {
    throw new Error(`Pipeline completion ${label} is missing or unreadable: ${String(error)}`, { cause: error });
  }
  let value: unknown;
  try { value = JSON.parse(rawBytes.toString('utf8')); }
  catch (error) { throw new Error(`Pipeline completion ${label} is not valid JSON: ${String(error)}`); }
  const canonicalBytes = Buffer.from(formatJsonFile(value), 'utf8');
  if (!rawBytes.equals(canonicalBytes)) throw new Error(`Pipeline completion ${label} is not canonical JSON`);
  try { return validate(value); }
  catch (error) { throw new Error(`Pipeline completion ${label} does not match its contract: ${String(error)}`); }
}

export async function readCanonicalVerificationArtifactSet(
  workspaceRoot: string
): Promise<CanonicalVerificationArtifactSet> {
  const artifacts = {
    verificationReport: await readCanonicalJsonArtifact<unknown>(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport), 'Verification report'),
    runtimeReport: await readCanonicalJsonArtifact<unknown>(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport), 'runtime report'),
    policyReport: await readCanonicalJsonArtifact<unknown>(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport), 'policy report'),
    acceptanceCoverage: await readCanonicalJsonArtifact<unknown>(
      resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage), 'acceptance coverage')
  };
  assertCanonicalVerificationArtifactSet(artifacts);
  return artifacts;
}
