import { createHash } from 'node:crypto';

import { CodexDevelopmentWorkPackageManifestDigest } from './work-package-contract.ts';

export type PrInfo = {
  number: number;
  headSha: string;
  baseSha: string;
  headBranch: string;
  title: string;
  state: string;
  body: string;
  manifestPath: string;
};

export type ManifestDigest = {
  digest: string;
  blobSha: string;
  byteLength: number;
};

export type WorkflowRunSummary = {
  databaseId: number;
  status: string;
  conclusion: string | null;
  displayTitle: string;
  headSha: string;
};

export function computeManifestDigestFromBytes(bytes: Uint8Array): ManifestDigest {
  const digest = CodexDevelopmentWorkPackageManifestDigest(bytes);
  const blobSha = createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
  return { digest, blobSha, byteLength: bytes.byteLength };
}

export function buildScopeAttestPayload(
  pr: PrInfo,
  manifest: ManifestDigest
): Record<string, string | number> {
  return {
    pull_request: pr.number,
    expected_head: pr.headSha,
    expected_base: pr.baseSha,
    manifest_digest: manifest.digest
  };
}

export function buildVerificationPayload(
  pr: PrInfo,
  manifest: ManifestDigest,
  profile: 'quick' | 'full'
): Record<string, string | number> {
  return {
    schema: 'codex-development-frozen-verification-request-v1',
    pull_request: pr.number,
    expected_head: pr.headSha,
    expected_base: pr.baseSha,
    manifest_path: pr.manifestPath,
    manifest_digest: manifest.digest,
    profile
  };
}

export function shouldSquashToSingleParent(parents: readonly string[], baseSha: string): boolean {
  return parents.length !== 1 || parents[0] !== baseSha;
}

export function parsePrInfo(json: string, parseLocator: (body: string) => string): PrInfo {
  const data = JSON.parse(json) as {
    number?: number;
    headRefOid?: string;
    baseRefOid?: string;
    headRefName?: string;
    title?: string;
    state?: string;
    body?: string;
  };
  if (!data || typeof data !== 'object') throw new Error('PR JSON is not an object.');
  if (
    typeof data.number !== 'number'
    || !Number.isSafeInteger(data.number)
    || data.number <= 0
  ) {
    throw new Error('PR number is invalid.');
  }
  if (typeof data.headRefOid !== 'string' || !/^[0-9a-f]{40}$/u.test(data.headRefOid)) {
    throw new Error('PR headRefOid is invalid.');
  }
  if (typeof data.baseRefOid !== 'string' || !/^[0-9a-f]{40}$/u.test(data.baseRefOid)) {
    throw new Error('PR baseRefOid is invalid.');
  }
  if (typeof data.headRefName !== 'string' || data.headRefName.length === 0) {
    throw new Error('PR headRefName is invalid.');
  }
  if (typeof data.title !== 'string' || data.title.length === 0) {
    throw new Error('PR title is invalid.');
  }
  if (typeof data.state !== 'string') throw new Error('PR state is invalid.');
  const body = data.body ?? '';
  return {
    number: data.number,
    headSha: data.headRefOid,
    baseSha: data.baseRefOid,
    headBranch: data.headRefName,
    title: data.title,
    state: data.state,
    body,
    manifestPath: parseLocator(body)
  };
}

export function parseWorkflowRuns(json: string): WorkflowRunSummary[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('Workflow runs JSON is not an array.');
  return data.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Workflow run is not an object.');
    }
    const run = value as Record<string, unknown>;
    if (
      typeof run.databaseId !== 'number'
      || !Number.isSafeInteger(run.databaseId)
      || run.databaseId <= 0
    ) {
      throw new Error('Workflow run databaseId is invalid.');
    }
    if (typeof run.status !== 'string') throw new Error('Workflow run status is invalid.');
    if (typeof run.displayTitle !== 'string') {
      throw new Error('Workflow run displayTitle is invalid.');
    }
    if (typeof run.headSha !== 'string') throw new Error('Workflow run headSha is invalid.');
    if (run.conclusion !== null && run.conclusion !== undefined && typeof run.conclusion !== 'string') {
      throw new Error('Workflow run conclusion is invalid.');
    }
    return {
      databaseId: run.databaseId,
      status: run.status,
      conclusion: (run.conclusion as string | null | undefined) ?? null,
      displayTitle: run.displayTitle,
      headSha: run.headSha
    };
  });
}

export function selectSuccessfulRun(
  runs: readonly WorkflowRunSummary[],
  expectedTitle: string,
  expectedHeadSha: string
): WorkflowRunSummary {
  const matching = runs
    .filter((run) => run.displayTitle === expectedTitle && run.headSha === expectedHeadSha)
    .sort((left, right) => right.databaseId - left.databaseId);
  if (matching.length === 0) {
    throw new Error(`No workflow run found with title "${expectedTitle}" and head ${expectedHeadSha}.`);
  }
  const latest = matching[0]!;
  if (latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      `Latest workflow run ${latest.databaseId} is not successful: status=${latest.status} conclusion=${latest.conclusion ?? 'null'}.`
    );
  }
  return latest;
}
