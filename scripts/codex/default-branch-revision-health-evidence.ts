#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import ts from 'typescript';

import {
  CodexDevelopmentAssertVerificationEvidenceV2,
  type CodexDevelopmentVerificationEvidenceV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CodexDevelopmentProjectDefaultBranchRevisionHealthV2,
  DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA,
  type DefaultBranchRevisionHealthCommandEvidenceV2,
  type DefaultBranchRevisionHealthPhysicalEvidenceV2,
  type DefaultBranchRevisionHealthProducerV2
} from '../../platform/shared/default-branch-revision-health.ts';

interface ExecutorArguments {
  artifactRef: string;
  expectedSubject: string;
  input: string;
  physicalOutput: string;
  receiptOutput: string;
}

function parseArguments(argv: readonly string[]): ExecutorArguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      !key
      || !value
      || ![
        '--artifact-ref',
        '--expected-subject',
        '--input',
        '--physical-output',
        '--receipt-output'
      ].includes(key)
      || values.has(key)
    ) {
      throw new Error(
        'Usage: default-branch-revision-health-evidence.ts '
        + '--input <ci-evidence.json> --physical-output <physical.json> '
        + '--receipt-output <receipt.json> --artifact-ref <ref> '
        + '--expected-subject <40-char-sha>'
      );
    }
    values.set(key, value);
  }
  if (values.size !== 5) throw new Error('Revision-health executor arguments are incomplete.');
  return {
    artifactRef: values.get('--artifact-ref')!,
    expectedSubject: values.get('--expected-subject')!,
    input: values.get('--input')!,
    physicalOutput: values.get('--physical-output')!,
    receiptOutput: values.get('--receipt-output')!
  };
}

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function trackedTreeIsClean(repositoryRoot: string): boolean {
  return git(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']) === '';
}

function producerIdentity(): string {
  const workflow = process.env.GITHUB_WORKFLOW ?? 'local';
  const run = process.env.GITHUB_RUN_ID ?? 'no-run';
  const job = process.env.GITHUB_JOB ?? 'no-job';
  return `sec-revision-health:${workflow}:${run}:${job}`
    .replaceAll(/[^A-Za-z0-9._:/@+-]/gu, '-')
    .slice(0, 256);
}

function captureProducer(): DefaultBranchRevisionHealthProducerV2 {
  return {
    identity: producerIdentity(),
    revision: 'sec-default-branch-revision-health-executor-v1',
    runtime: `bun@${Bun.version}`,
    os: process.platform,
    arch: process.arch,
    toolchain: `typescript@${ts.version}`
  };
}

function commandEvidence(
  gate: CodexDevelopmentVerificationEvidenceV2['gates'][number]
): DefaultBranchRevisionHealthCommandEvidenceV2 {
  if (gate.status === 'not-run') {
    return {
      checkId: gate.id,
      argv: [...gate.argv],
      outcome: 'not-run',
      failureClass: null,
      exitCode: null,
      startedAt: null,
      finishedAt: null,
      outputDigest: null
    };
  }
  return {
    checkId: gate.id,
    argv: [...gate.argv],
    outcome: gate.status,
    failureClass: gate.status === 'failed' ? 'unresolved' : null,
    exitCode: gate.exitCode,
    startedAt: gate.startedAt,
    finishedAt: gate.finishedAt,
    outputDigest: gate.rawOutputDigest
  };
}

function buildPhysicalEvidence(
  evidence: CodexDevelopmentVerificationEvidenceV2,
  producer: DefaultBranchRevisionHealthProducerV2,
  revision: string,
  tree: string,
  cleanAfterProjection: boolean
): DefaultBranchRevisionHealthPhysicalEvidenceV2 {
  if (
    evidence.headSha !== revision
    || evidence.treeSha !== tree
    || evidence.cleanState.before === null
    || evidence.cleanState.after === null
  ) {
    throw new Error('Canonical CI Evidence does not bind the current exact subject workspace.');
  }
  return {
    schema: DEFAULT_BRANCH_REVISION_HEALTH_PHYSICAL_EVIDENCE_SCHEMA,
    subject: {
      repository: process.env.GITHUB_REPOSITORY ?? 'sec-platform/sec',
      defaultBranch: process.env.GITHUB_BASE_REF || 'main',
      revision,
      tree
    },
    policy: {
      profile: evidence.profile,
      revision: evidence.contractRevision,
      digest: evidence.inputDigest,
      checks: evidence.gates.map(({ id }) => ({
        id,
        applicability: 'required' as const
      }))
    },
    producer,
    workspace: {
      before: {
        revision,
        tree,
        clean: evidence.cleanState.before
      },
      after: {
        revision,
        tree,
        clean: evidence.cleanState.after && cleanAfterProjection
      }
    },
    commands: evidence.gates.map(commandEvidence)
  };
}

async function writeJson(target: string, value: unknown): Promise<void> {
  const absolute = path.resolve(target);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function CodexDevelopmentDefaultBranchRevisionHealthEvidenceMain(
  argv: readonly string[] = process.argv.slice(2),
  repositoryRoot: string = process.cwd()
): Promise<number> {
  const options = parseArguments(argv);
  if (!/^[0-9a-f]{40}$/u.test(options.expectedSubject)) {
    throw new Error('--expected-subject must be one lowercase 40-character Git SHA.');
  }
  const inputBytes = await readFile(path.resolve(options.input));
  const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes));
  CodexDevelopmentAssertVerificationEvidenceV2(parsed, {
    kind: 'verification',
    headSha: options.expectedSubject
  });
  const evidence = parsed as CodexDevelopmentVerificationEvidenceV2;

  const revision = git(repositoryRoot, ['rev-parse', 'HEAD']);
  const tree = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
  if (revision !== options.expectedSubject) {
    throw new Error('Revision-health executor current HEAD does not match --expected-subject.');
  }
  const cleanBeforeProjection = trackedTreeIsClean(repositoryRoot);
  if (!cleanBeforeProjection) {
    throw new Error('Revision-health executor requires a clean workspace before projection.');
  }

  const producer = captureProducer();
  const physical = buildPhysicalEvidence(
    evidence,
    producer,
    revision,
    tree,
    trackedTreeIsClean(repositoryRoot)
  );
  const physicalBytes = new TextEncoder().encode(`${JSON.stringify(physical, null, 2)}\n`);
  const receipt = CodexDevelopmentProjectDefaultBranchRevisionHealthV2(
    physicalBytes,
    {
      artifactRef: options.artifactRef,
      expectedSubjectRevision: options.expectedSubject,
      recorder: producer
    }
  );

  await writeJson(options.physicalOutput, physical);
  await writeJson(options.receiptOutput, receipt);
  return receipt.verificationHealth === 'verification-passed' ? 0 : 1;
}

if (import.meta.main) {
  CodexDevelopmentDefaultBranchRevisionHealthEvidenceMain()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
