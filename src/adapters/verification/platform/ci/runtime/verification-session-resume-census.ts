import { canonicalEquals } from '../../../../../contracts/canonical.ts';
import type { HostedResumeSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { parseCiVerificationActionProviderEnvelope } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import { ciVerificationSessionWakeKey } from './verification-session-resume-contract.ts';

type RunStatus = 'queued' | 'in_progress' | 'completed' | 'requested' | 'waiting' | 'pending';
type Actor = Readonly<{ id: number; login: string; nodeId: string; type: string }>;
export type CiVerificationSessionResumeCensusRun = Readonly<{
  runId: string; runNumber: number; runAttempt: number; workflowId: string;
  repositoryId: string; repository: string; workflowPath: string; eventName: string;
  displayTitle: string; headSha: string; status: RunStatus; createdAt: string;
  actor: Actor; triggeringActor: Actor;
}>;
type PageFields = Readonly<{ page: number; perPage: 100; totalCount: number; hasNextPage: boolean }>;
export type CiVerificationSessionResumeCensusRunPage = PageFields & Readonly<{
  runs: readonly CiVerificationSessionResumeCensusRun[];
}>;
export type CiVerificationSessionResumeCensusJob = Readonly<{
  id: string; name: string; runId: string; runAttempt: number; headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  steps: readonly Readonly<{ name: string; number: number; status: 'queued' | 'in_progress' | 'completed';
    conclusion: string | null; startedAt: string | null }>[];
}>;
export type CiVerificationSessionResumeCensusJobPage = PageFields & Readonly<{
  jobs: readonly CiVerificationSessionResumeCensusJob[];
}>;
export type CiVerificationSessionResumeCensusInput = Readonly<{
  completedAction: HostedResumeSignal['completedAction'];
  completedActionCompletedAt: string;
  currentReceiver: CiVerificationSessionResumeCensusRun;
  /** Unfiltered actual workflow_id history, beginning at page 1. Every supplied
   * page is complete; the prefix may stop after the strict pre-completion anchor. */
  receiverHistoryPages: readonly CiVerificationSessionResumeCensusRunPage[];
  /** All original records from the existing REPOSITORY runs query filtered only
   * by this exact source SHA. workflowId is the expected compiler identity, not
   * a query filter. No caller workflow/title/event/actor filtering is permitted. */
  compilerHistory: Readonly<{ workflowId: string; headSha: string; paginationComplete: boolean;
    pages: readonly CiVerificationSessionResumeCensusRunPage[] }>;
  /** Includes every OTHER same-cause receiver in the observed prefix, including
   * higher run_numbers: native concurrency does not guarantee creation order. */
  priorReceiverJobs: readonly Readonly<{ runId: string; runAttempt: 1; paginationComplete: boolean;
    pages: readonly CiVerificationSessionResumeCensusJobPage[] }>[];
}>;
export type CiVerificationSessionResumeCensus = Readonly<{
  disposition: 'unseen' | 'existing' | 'unknown';
  existingRun: CiVerificationSessionResumeCensusRun | null;
  reason: string | null;
}>;

const RECEIVER_PATH = '.github/workflows/merge-gate.yml';
const COMPILER_PATH = '.github/workflows/compiler-pr-validation.yml';
const RESUME_STEP = 'Resume canonical verification Session';
const RUN_STATUSES = ['queued', 'in_progress', 'completed', 'requested', 'waiting', 'pending'];
const JOB_STATUSES = ['queued', 'in_progress', 'completed'];

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Invalid census fields.');
  return value as Record<string, unknown>;
}
function id(value: unknown): boolean { return typeof value === 'string' && /^[1-9][0-9]{0,19}$/u.test(value); }
function positive(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) > 0; }
function text(value: unknown): boolean { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(value); }
function sha(value: unknown): boolean { return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value); }
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) throw new Error('Invalid census time.');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) {
    throw new Error('Invalid census time.');
  }
  return parsed;
}
function actor(value: unknown): Actor {
  const entry = exact(value, ['id', 'login', 'nodeId', 'type']);
  if (!positive(entry.id) || !text(entry.login) || !text(entry.nodeId) || !text(entry.type)) throw new Error('Invalid census actor.');
  return Object.freeze(entry) as Actor;
}
function run(value: unknown): CiVerificationSessionResumeCensusRun {
  const entry = exact(value, ['runId', 'runNumber', 'runAttempt', 'workflowId', 'repositoryId', 'repository',
    'workflowPath', 'eventName', 'displayTitle', 'headSha', 'status', 'createdAt', 'actor', 'triggeringActor']);
  if (!id(entry.runId) || !positive(entry.runNumber) || !positive(entry.runAttempt) || Number(entry.runAttempt) > 1000
      || !id(entry.workflowId) || !id(entry.repositoryId) || typeof entry.repository !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(entry.repository)
      || !text(entry.workflowPath) || !text(entry.eventName) || !text(entry.displayTitle)
      || !sha(entry.headSha) || !RUN_STATUSES.includes(String(entry.status))) throw new Error('Invalid census run.');
  timestamp(entry.createdAt);
  return Object.freeze({ ...entry, actor: actor(entry.actor), triggeringActor: actor(entry.triggeringActor) }) as CiVerificationSessionResumeCensusRun;
}
function job(value: unknown): CiVerificationSessionResumeCensusJob {
  const entry = exact(value, ['id', 'name', 'runId', 'runAttempt', 'headSha', 'status', 'steps']);
  if (!id(entry.id) || !text(entry.name) || !id(entry.runId) || !positive(entry.runAttempt)
      || !sha(entry.headSha) || !JOB_STATUSES.includes(String(entry.status))
      || !Array.isArray(entry.steps) || entry.steps.length > 100) throw new Error('Invalid census job.');
  const numbers = new Set<number>();
  const steps = entry.steps.map(value => {
    const step = exact(value, ['name', 'number', 'status', 'conclusion', 'startedAt']);
    if (!text(step.name) || !positive(step.number) || Number(step.number) > 100 || numbers.has(Number(step.number))
        || !JOB_STATUSES.includes(String(step.status)) || (step.conclusion !== null && !text(step.conclusion))) {
      throw new Error('Invalid census step.');
    }
    numbers.add(Number(step.number));
    if (step.startedAt !== null) timestamp(step.startedAt);
    return Object.freeze(step);
  });
  return Object.freeze({ ...entry, steps: Object.freeze(steps) }) as CiVerificationSessionResumeCensusJob;
}

/** Complete individual pages, coherent total_count, and a contiguous page-1
 * prefix. A complete census must also reach the actual last page. */
function pages<T>(value: unknown, field: 'runs' | 'jobs', parse: (value: unknown) => T, complete: boolean): readonly T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new Error('Invalid census pages.');
  const rows: T[] = [];
  let total: number | null = null;
  let hasNext = true;
  for (const [index, valuePage] of value.entries()) {
    const page = exact(valuePage, ['page', 'perPage', 'totalCount', 'hasNextPage', field]);
    if (!hasNext || page.page !== index + 1 || page.perPage !== 100
        || !Number.isSafeInteger(page.totalCount) || Number(page.totalCount) < 0
        || (total !== null && total !== page.totalCount) || !Array.isArray(page[field])) throw new Error('Incoherent census page.');
    total = Number(page.totalCount);
    const remaining = total - index * 100;
    if (remaining < 0 || page[field].length !== Math.min(100, remaining)) throw new Error('Incomplete census page.');
    hasNext = (index + 1) * 100 < total;
    if (page.hasNextPage !== hasNext) throw new Error('Incoherent census pagination.');
    rows.push(...page[field].map(parse));
  }
  if (complete && (hasNext || rows.length !== total)) throw new Error('Incomplete full census.');
  return rows;
}
function uniqueRuns(runs: readonly CiVerificationSessionResumeCensusRun[]): boolean {
  return new Set(runs.map(run => run.runId)).size === runs.length
    && new Set(runs.map(run => `${run.workflowId}:${run.runNumber}`)).size === runs.length;
}
function sameRepository(run: CiVerificationSessionResumeCensusRun, current: CiVerificationSessionResumeCensusRun): boolean {
  return run.repository === current.repository && run.repositoryId === current.repositoryId;
}
function unknown(reason: string): CiVerificationSessionResumeCensus {
  return Object.freeze({ disposition: 'unknown', existingRun: null, reason });
}

/** A finite DATA decision only. The real reader separately authenticates API
 * responses, original human permission, source closure and possession of the
 * fixed global receiver concurrency lane, and repeats the leading-page read.
 * The source-owned lane must actually use queue:max/cancel:false. Its provider
 * upper bound is 100 pending runs, not lossless queuing: capacity exhaustion or
 * cancellation requires typed unavailability or recovery within the SAME cause
 * deadline, never a fresh budget or inference that a missing run never acted.
 * The original parent-plan/job absolute deadline is independently read back;
 * expiry means unknown/no POST in the real reader, not a renewed local timer.
 * It must independently establish the bounded no-deletion/retention premise
 * throughout the original live-cause deadline: an observed prefix cannot reveal
 * a deleted former highest run. The accepted public-repository profile uses the
 * provider's documented minimum one-day retention. The reader verifies public
 * repository visibility and the original parent job.startedAt + 205 minutes
 * absolute cause deadline, plus the accepted premise that trusted administrators
 * do not delete live history within that cause. A larger observed retention
 * setting is not a future guarantee or a reason to grant the job Admin APIs. No input
 * boolean can supply the independently authenticated source/deadline premise.
 * This reducer cannot authenticate those facts or authorize a POST. */
export function reduceCiVerificationSessionResumeCensus(input: CiVerificationSessionResumeCensusInput): CiVerificationSessionResumeCensus {
  try {
    const data = exact(JSON.parse(encodeVerificationActionData(input)) as unknown, ['completedAction',
      'completedActionCompletedAt', 'currentReceiver', 'receiverHistoryPages', 'compilerHistory', 'priorReceiverJobs']);
    const completed = data.completedAction as HostedResumeSignal['completedAction'];
    const wakeKey = ciVerificationSessionWakeKey(completed);
    const envelope = parseCiVerificationActionProviderEnvelope(completed.providerEnvelope);
    const completedAt = timestamp(data.completedActionCompletedAt);
    const current = run(data.currentReceiver);
    const causeTitle = `integrate compiler session run ${completed.runId} attempt ${completed.runAttempt}`;
    if (current.workflowPath !== RECEIVER_PATH || current.eventName !== 'workflow_run'
        || current.displayTitle !== causeTitle || current.headSha !== envelope.parentWorkflowSha
        || envelope.parentWorkflowRef !== `${current.repository}/${COMPILER_PATH}@refs/heads/main`
        || timestamp(current.createdAt) < completedAt || current.status !== 'in_progress') return unknown('current-receiver-mismatch');

    const compiler = exact(data.compilerHistory, ['workflowId', 'headSha', 'paginationComplete', 'pages']);
    if (!id(compiler.workflowId) || compiler.workflowId === current.workflowId
        || compiler.headSha !== current.headSha || compiler.paginationComplete !== true) return unknown('compiler-census-incomplete');
    const compilerRuns = pages(compiler.pages, 'runs', run, true);
    // GitHub caps the repository head_sha search at 1000 records. A full-looking
    // last page at that ceiling cannot prove an unseen or unique successor.
    if (compilerRuns.length >= 1000) return unknown('compiler-filtered-query-ceiling');
    if (!uniqueRuns(compilerRuns) || compilerRuns.some(candidate => !sameRepository(candidate, current)
        || candidate.headSha !== current.headSha)) return unknown('compiler-query-identity-mismatch');
    const matches = compilerRuns.filter(candidate => candidate.displayTitle === `resume Session ${wakeKey}`);
    if (matches.length > 1) return unknown('multiple-compiler-successors');
    if (matches.length === 1) {
      const existing = matches[0]!;
      if (existing.workflowId !== compiler.workflowId || existing.workflowPath !== COMPILER_PATH
          || existing.eventName !== 'repository_dispatch' || timestamp(existing.createdAt) < completedAt
          || !canonicalEquals(existing.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot)
          || !canonicalEquals(existing.triggeringActor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot)) return unknown('compiler-successor-origin-mismatch');
      return Object.freeze({ disposition: 'existing', existingRun: existing, reason: null });
    }
    // A repeated native attempt can only recover an independently found run.
    if (current.runAttempt !== 1) return unknown('receiver-rerun-recovery-only');

    const receivers = pages(data.receiverHistoryPages, 'runs', run, false);
    if (!uniqueRuns(receivers) || receivers.some(candidate => !sameRepository(candidate, current)
        || candidate.workflowId !== current.workflowId || candidate.workflowPath !== RECEIVER_PATH
        || candidate.eventName !== 'workflow_run')) return unknown('receiver-history-identity-mismatch');
    const currentMatches = receivers.filter(candidate => candidate.runId === current.runId);
    if (currentMatches.length !== 1 || !canonicalEquals(currentMatches[0], current)) return unknown('current-receiver-not-in-history');
    const anchor = receivers.findIndex(candidate => timestamp(candidate.createdAt) < completedAt);
    if (anchor < 0 || receivers.indexOf(currentMatches[0]!) > anchor) return unknown('receiver-history-has-no-anchor');
    const prefix = receivers.slice(0, anchor + 1);
    for (let index = 1; index < prefix.length; index += 1) {
      if (prefix[index - 1]!.runNumber !== prefix[index]!.runNumber + 1
          || timestamp(prefix[index - 1]!.createdAt) < timestamp(prefix[index]!.createdAt)) return unknown('receiver-history-gap-or-order');
    }
    const otherCauses = prefix.filter(candidate => candidate.runId !== current.runId && candidate.displayTitle === causeTitle);
    if (otherCauses.some(candidate => candidate.headSha !== current.headSha || timestamp(candidate.createdAt) < completedAt)) {
      return unknown('other-receiver-source-or-cause-mismatch');
    }
    if (!Array.isArray(data.priorReceiverJobs) || data.priorReceiverJobs.length !== otherCauses.length) return unknown('other-receiver-jobs-incomplete');
    const seenReceivers = new Set<string>();
    for (const value of data.priorReceiverJobs) {
      const observation = exact(value, ['runId', 'runAttempt', 'paginationComplete', 'pages']);
      const receiver = otherCauses.find(candidate => candidate.runId === observation.runId);
      if (!receiver || seenReceivers.has(receiver.runId) || observation.runAttempt !== 1 || observation.paginationComplete !== true) {
        return unknown('other-receiver-jobs-incomplete');
      }
      seenReceivers.add(receiver.runId);
      const jobs = pages(observation.pages, 'jobs', job, true);
      if (new Set(jobs.map(job => job.id)).size !== jobs.length || jobs.some(job => job.runId !== receiver.runId
          || job.runAttempt !== 1 || job.headSha !== current.headSha)) return unknown('other-receiver-job-origin-mismatch');
      const resumeSteps = jobs.flatMap(job => job.steps.filter(step => step.name === RESUME_STEP).map(step => ({ job, step })));
      if (resumeSteps.some(({ step }) => step.startedAt !== null || step.status === 'in_progress')) {
        return unknown('resume-step-started-tombstone');
      }
      // A genuinely queued receiver cannot execute while this source-checked
      // invocation holds the same global native concurrency lane.
      if (receiver.status === 'queued' && receiver.runAttempt === 1 && jobs.every(job => job.status === 'queued'
          && job.steps.every(step => step.status === 'queued' && step.startedAt === null))) continue;
      const integrationJobs = jobs.filter(job => job.name === 'integrate');
      if (receiver.status !== 'completed' || integrationJobs.length !== 1 || integrationJobs[0]!.status !== 'completed'
          || resumeSteps.length !== 1 || resumeSteps[0]!.job.id !== integrationJobs[0]!.id) return unknown('resume-step-observation-incomplete');
      const step = resumeSteps[0]!.step;
      if (step.status !== 'completed' || step.conclusion !== 'skipped') return unknown('resume-step-observation-incomplete');
    }
    return Object.freeze({ disposition: 'unseen', existingRun: null, reason: null });
  } catch {
    return unknown('invalid-or-incomplete-census-data');
  }
}
