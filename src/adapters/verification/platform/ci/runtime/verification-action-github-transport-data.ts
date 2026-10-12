import { createHash } from 'node:crypto';
import type { HostedSourceArtifactProjection } from '../../../../providers/github-api/contract/hosted-artifact-projections.ts';
import {
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE, VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX
} from '../../action/contract/provider.ts';

export type GitHubExactCommitStatusState = 'error' | 'failure' | 'pending' | 'success';

export type GitHubExactCommitStatusObservation = Readonly<{
  id: number;
  nodeId: string;
  state: GitHubExactCommitStatusState;
  context: string;
  /** GitHub permits these optional fields to be null on statuses outside this provider's context. */
  description: string | null;
  targetUrl: string | null;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  creator: Readonly<{
    login: string;
    id: number;
    nodeId: string;
    type: string;
  }>;
}>;

export type GitHubExactCommitStatusProviderObservation =
  GitHubExactCommitStatusObservation & Readonly<{
    description: string;
    targetUrl: string;
  }>;

export function fail(message: string): never {
  throw new Error(`VerificationAction GitHub provider ${message}`);
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

export function sourceArtifactProjectionForFile(fileName: string): HostedSourceArtifactProjection {
  switch (fileName) {
    case VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE: return 'action-start';
    case VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE: return 'action-terminal';
    case VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE: return 'action-terminal-anchor';
    default: return fail('Action source archive does not have one closed canonical file group.');
  }
}

export function canonicalHostedWorkflowSource(raw: unknown): string {
  const workflowPath = '.github/workflows/compiler-pr-validation.yml';
  const entry = record(raw, 'historical canonical workflow source');
  if (entry.type !== 'file' || entry.path !== workflowPath || entry.encoding !== 'base64' ||
      typeof entry.content !== 'string' || typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/u.test(entry.sha) ||
      !Number.isSafeInteger(entry.size) || Number(entry.size) < 1 || Number(entry.size) > 1_048_576) {
    fail('historical canonical workflow source is not one bounded exact Git blob.');
  }
  const encoded = entry.content.replaceAll('\n', '');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || bytes.byteLength !== entry.size ||
      createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex') !== entry.sha ||
      !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) {
    fail('historical canonical workflow source bytes differ from their Git blob identity.');
  }
  return bytes.toString('utf8');
}

const VERIFICATION_ACTION_ARTIFACT_FAMILIES = Object.freeze([
  VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX,
  VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX
]);

export function artifactInventoryName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 1024 ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} is not bounded opaque provider data.`);
  }
  const family = VERIFICATION_ACTION_ARTIFACT_FAMILIES.find((prefix) =>
    value.startsWith(prefix));
  if (family !== undefined) {
    const suffix = value.startsWith(`${family}-`) ? value.slice(family.length + 1) : '';
    if (!/^[0-9a-f]{64}$/u.test(suffix)) fail(`${label} provider-family name is malformed.`);
    return value;
  }
  return value;
}

function iso(value: unknown, label: string): string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
      Number.isNaN(Date.parse(value))) fail(`${label} is invalid.`);
  return value;
}

export function normalizeStatus(
  value: unknown,
  expectedSha: string,
  label: string,
  providerContext: string
): GitHubExactCommitStatusObservation {
  const status = record(value, label);
  const creator = record(status.creator, `${label}.creator`);
  const ownsContext = typeof status.context === 'string' &&
    status.context.toLowerCase() === providerContext;
  if (!Number.isSafeInteger(status.id) || Number(status.id) < 1 ||
      typeof status.node_id !== 'string' || status.node_id.length < 1 ||
      !['error', 'failure', 'pending', 'success'].includes(String(status.state)) ||
      typeof status.context !== 'string' || status.context.length < 1 || status.context.length > 100 ||
      (status.description !== null &&
        (typeof status.description !== 'string' || status.description.length > 140)) ||
      (status.target_url !== null &&
        (typeof status.target_url !== 'string' || status.target_url.length < 1)) ||
      (ownsContext && (typeof status.description !== 'string' ||
        typeof status.target_url !== 'string' || status.target_url.length < 1)) ||
      status.sha !== expectedSha || typeof creator.login !== 'string' ||
      !Number.isSafeInteger(creator.id) || Number(creator.id) < 1 ||
      typeof creator.node_id !== 'string' || creator.node_id.length < 1 ||
      typeof creator.type !== 'string' || creator.type.length < 1) {
    fail(`${label} fields are invalid.`);
  }
  const createdAt = iso(status.created_at, `${label}.created_at`);
  const updatedAt = iso(status.updated_at, `${label}.updated_at`);
  if (updatedAt !== createdAt) fail(`${label} was mutated after append.`);
  return Object.freeze({
    id: Number(status.id),
    nodeId: status.node_id,
    state: status.state as GitHubExactCommitStatusState,
    context: status.context,
    description: status.description as string | null,
    targetUrl: status.target_url as string | null,
    commitSha: expectedSha,
    createdAt,
    updatedAt,
    creator: Object.freeze({
      login: creator.login,
      id: Number(creator.id),
      nodeId: creator.node_id,
      type: creator.type
    })
  });
}
