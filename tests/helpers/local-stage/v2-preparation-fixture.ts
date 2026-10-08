/** Read-only orchestration fixture. Providers supply fixed source facts; no
 * physical qualification, accepted native content, Session or PASS is mocked. */
import { mock } from 'bun:test';
import { existsSync } from 'node:fs';
import * as gitAuthority from '../../../src/adapters/providers/git-read/authority.ts';
import * as mainHealth from '../../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts';
import * as workPackage from '../../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import * as gitRead from '../../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../../src/adapters/verification/platform/action/contract/environment.ts';
import { createVerificationSessionLocalPreparationRequestV2 } from '../../../src/adapters/verification/platform/ci/contract/session-request.ts';
import * as github from '../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import * as session from '../../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import * as runtime from '../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
const scenario = process.argv[2];
const root = process.argv[3]!;
const D = `sha256:${'a'.repeat(64)}` as const;
const base = '1'.repeat(40), head = '3'.repeat(40);
const candidate = { repository: 'sec-platform/sec', number: 123, state: 'OPEN', isDraft: false,
  isCrossRepository: false, baseBranch: 'main', baseSha: base, baseTreeSha: '2'.repeat(40),
  headSha: head, headTreeSha: '4'.repeat(40), authorNodeId: 'AUTHOR', body: '' };
const counters = { source: 0, native: 0, healthObservation: 0, candidate: 0, review: 0 };
let actor = 'MAINTAINER', cancel = false, changedLocator = false;
const moduleMock = (url: string, factory: () => object) => mock.module(new URL(url, import.meta.url).pathname, factory);
moduleMock('../../../src/adapters/providers/git-read/authority.ts', () => ({ ...gitAuthority,
  withAuthorityGitReadSession: async (_input: unknown, callback: (value: unknown) => unknown) => callback({}) }));
moduleMock('../../../src/adapters/self-hosting/development/tooling/git/git-read.ts', () => ({ ...gitRead,
  gitReadText: async (_session: unknown, args: readonly string[]) => {
    if (args.join(' ') === 'branch --show-current') return 'main';
    if (args.join(' ') === 'rev-parse HEAD') return base;
    if (args.join(' ') === 'rev-parse HEAD^{tree}') return candidate.baseTreeSha;
    if (args[0] === 'status') return '';
    if (args[0] === 'remote') return 'https://github.com/sec-platform/sec.git';
    throw new Error('unexpected Git fixture read');
  } }));
moduleMock('../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts', () => ({ ...github,
  createVerificationSessionGitHubClient: () => ({
    observeCandidate: async () => { counters.candidate++; if (cancel) throw new Error('CANCELLED_PROVIDER_READ');
      return { ...candidate, body: changedLocator || (scenario === 'metadata-read-window' && counters.candidate >= 2)
        ? 'second-work-package' : '' }; },
    observeComparison: async () => ({ status: 'ahead', behindBy: 0 }),
    observeOpenPullRequestCountForHead: async () => 1, readBlobText: async () => '{}',
    observeViewerPrincipal: async () => ({ login: 'maintainer', nodeId: actor, permission: 'maintain' }),
    observeReviewBarrier: async () => { counters.review++; return { status: 'clear' }; }
  }) }));
moduleMock('../../../src/adapters/self-hosting/control/task/contract/work-package.ts', () => ({ ...workPackage,
  CodexDevelopmentParseWorkPackageLocator: (body: string) => body === 'second-work-package'
    ? 'config/repository/work-packages/other.md' : 'config/repository/work-packages/local.md',
  CodexDevelopmentWorkPackageManifestDigest: () => D,
  CodexDevelopmentParseCurrentWorkPackageManifest: () => ({ requiredProfile: 'full' }),
  CodexDevelopmentAssertWorkPackageOwnership: () => {}
}));
moduleMock('../../../src/adapters/verification/platform/ci/runtime/verification-session.ts', () => ({ ...session,
  observeVerificationSessionChangedSelection: async () => ({ changedPaths: ['src/example.ts'],
    testImpactTransition: CodexDevelopmentCreateTestImpactTransitionObservation({ baseSha: base, headSha: head,
      records: [{ status: 'changed', path: 'src/example.ts' }], readPathBlob: () => null }), testImpactSourceProvider: null }),
  observeVerificationSessionActionDependencyBlobs: async () => CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map(p => ({
    path: p, baseSource: 'fixed dependency fixture', candidateSource: 'fixed dependency fixture' }))
}));
moduleMock('../../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts', () => ({ ...mainHealth,
  observeCanonicalMainHealthForPublication: async () => { counters.healthObservation++; throw new Error('MAIN_HEALTH_READ_FORBIDDEN'); }
}));
moduleMock('../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts', () => ({ ...runtime,
  withTrustedRuntimeMainHealthQualification: async () => { counters.native++; throw new Error('PHYSICAL_QUALIFICATION_FORBIDDEN'); }
}));
const { prepareWithTrustedRuntime, verifyWithTrustedRuntime } = await import('../../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts');
let result: unknown = null, failure: string | null = null, prepared: Awaited<ReturnType<typeof prepareWithTrustedRuntime>> | null = null;
try {
  prepared = await prepareWithTrustedRuntime({ repositoryRoot: root, repository: candidate.repository, prNumber: 123 });
  if (scenario === 'prepare' || scenario === 'metadata-read-window') result = prepared;
  else {
    let request = prepared.request;
    if (scenario === 'actor-drift') actor = 'OTHER';
    if (scenario === 'metadata-drift') changedLocator = true;
    if (scenario === 'cancelled') cancel = true;
    if (scenario === 'forged-content') {
      const { requestDigest: _digest, requestOperationId: _operation, ...body } = request.request;
      request = createVerificationSessionLocalPreparationRequestV2({ ...body,
        qualificationRequirements: { ...body.qualificationRequirements, nativeContentManifestDigest: D } });
    }
    result = await verifyWithTrustedRuntime({ repositoryRoot: root, repository: candidate.repository, request },
      async () => { counters.source++; throw new Error('SOURCE_EXECUTION_FORBIDDEN'); });
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
process.stdout.write(JSON.stringify({ result, failure, prepared, counters,
  stateCreated: existsSync(process.env.SEC_STATE_HOME!), cacheCreated: existsSync(process.env.SEC_CACHE_HOME!) }));
