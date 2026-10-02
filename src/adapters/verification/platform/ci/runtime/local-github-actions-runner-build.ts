import path from 'node:path';

import { sha256 } from '../../../../../contracts/canonical.ts';
import {
  SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST
} from '../../../../providers/linux-verification/contract.ts';
import {
  createEnvironmentMaterializationSpec
} from '../../../../providers/linux-verification/materialization.ts';

// Build inputs and progress are values only. Provider capability, execution,
// credentials, cache mutation and settlement remain with their existing owners.
const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA = ENVIRONMENT.image.lineageSchema;
export const LOCAL_GITHUB_ACTIONS_RUNNER_VERSION = ENVIRONMENT.archives.runner.version;
export const LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE =
  ENVIRONMENT.ubuntu.baseReference;
export const LOCAL_GITHUB_ACTIONS_NODE_VERSION = ENVIRONMENT.archives.node.version;
export const LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256 =
  ENVIRONMENT.archives.node.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_PYTHON_VERSION = ENVIRONMENT.runtime.pythonVersion;
export const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION = ENVIRONMENT.archives.githubCli.version;
export const LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256 =
  ENVIRONMENT.archives.githubCli.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT = ENVIRONMENT.ubuntu.snapshot;
const LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH = String(ENVIRONMENT.provider.sourceDateEpoch);
export const LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND =
  ENVIRONMENT.provider.dockerfileFrontend.reference;
const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE = ENVIRONMENT.archives.bootstrapCa.version;
export const LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256 =
  ENVIRONMENT.archives.bootstrapCa.digest.slice(7);
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION =
  ENVIRONMENT.image.buildRevision;
export const LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE =
  `${ENVIRONMENT.image.name}:${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION}-${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION}`;
// Frozen after the canonical Dockerfile is built once. Rebuilding mutable apt
// inputs under the same semantic provider revision must fail this identity.
export const LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID =
  ENVIRONMENT.image.dockerProjectionDigest;
export const LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST =
  ENVIRONMENT.image.runtimeContentDigest;

export interface BuildxRawJsonProgressAdmission {
  readonly push: (chunk: Buffer) => boolean;
  readonly finish: () => boolean;
}

export function createBuildxRawJsonProgressAdmission(): BuildxRawJsonProgressAdmission {
  let pending = '';
  const vertexPhases = new Set<string>();
  const statusCurrentByVertex = new Map<string, number>();
  const statusCompleted = new Set<string>();

  const admitLine = (line: string): boolean => {
    if (line.length === 0 || line.length > 1024 * 1024) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const event = parsed as Record<string, unknown>;
    let admitted = false;
    if (Array.isArray(event.vertexes)) {
      for (const candidate of event.vertexes) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const vertex = candidate as Record<string, unknown>;
        if (typeof vertex.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(vertex.digest)) continue;
        for (const phase of ['observed', 'started', 'completed', 'cached', 'error'] as const) {
          const present = phase === 'observed'
            || (phase === 'cached' ? vertex.cached === true : typeof vertex[phase] === 'string');
          if (present && !vertexPhases.has(`${vertex.digest}:${phase}`)) {
            vertexPhases.add(`${vertex.digest}:${phase}`);
            admitted = true;
          }
        }
      }
    }
    if (Array.isArray(event.statuses)) {
      for (const candidate of event.statuses) {
        if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
        const status = candidate as Record<string, unknown>;
        if (typeof status.vertex !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(status.vertex)
            || typeof status.id !== 'string' || status.id.length === 0 || status.id.length > 4096
            || !Number.isSafeInteger(status.current) || (status.current as number) < 0
            || !vertexPhases.has(`${status.vertex}:observed`)) continue;
        // `status.id` is provider presentation state and is not a semantic
        // frontier. A provider may mint an unbounded series of IDs for the
        // same vertex; only monotonic aggregate work for that vertex may keep
        // the stall deadline alive.
        const previous = statusCurrentByVertex.get(status.vertex);
        if (previous === undefined || (status.current as number) > previous) {
          statusCurrentByVertex.set(status.vertex, status.current as number);
          admitted = true;
        }
        if (typeof status.completed === 'string' && !statusCompleted.has(status.vertex)) {
          statusCompleted.add(status.vertex);
          admitted = true;
        }
      }
    }
    // BuildKit logs are presentation evidence. They never prove monotonic work
    // and therefore cannot refresh the semantic stall deadline.
    return admitted;
  };

  const consume = (final: boolean): boolean => {
    const lines = pending.split(/\r?\n/u);
    if (final) {
      pending = '';
      return lines.reduce((admitted, line) => admitLine(line) || admitted, false);
    }
    pending = lines.pop() ?? '';
    return lines.reduce((admitted, line) => admitLine(line) || admitted, false);
  };

  return Object.freeze({
    push: (chunk: Buffer): boolean => {
      pending += chunk.toString('utf8');
      if (pending.length > 2 * 1024 * 1024 && !/[\r\n]/u.test(pending)) {
        pending = '';
        return false;
      }
      return consume(false);
    },
    finish: (): boolean => consume(true)
  });
}


function fail(message: string): never {
  throw new Error(`Local GitHub Actions runner: ${message}`);
}

function boundedText(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded non-control text`);
  }
  return value;
}

export function createLocalGitHubActionsRunnerDockerfile(): string {
  return `# syntax=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND}\n`
    + `ARG SOURCE_DATE_EPOCH=${LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH}\n`
    + 'FROM scratch AS ca-bootstrap\n'
    + `ADD --chmod=${ENVIRONMENT.archives.bootstrapCa.mountMode} `
    + `--checksum=${ENVIRONMENT.archives.bootstrapCa.digest} `
    + `${ENVIRONMENT.archives.bootstrapCa.url} `
    + '/ca/\n'
    + `FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE} AS runtime\n`
    + 'ARG DEBIAN_FRONTEND=noninteractive\n'
    + `ARG UBUNTU_SNAPSHOT=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT}\n`
    + `RUN --mount=from=ca-bootstrap,source=/ca/cacert-${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE}.pem,`
    + 'target=/tmp/bootstrap-cacert.pem,ro '
    + `--mount=type=cache,id=${ENVIRONMENT.ubuntu.aptCacheId},target=/var/cache/apt,sharing=locked `
    + 'test -s /tmp/bootstrap-cacert.pem && test "$(stat -c %a /tmp/bootstrap-cacert.pem)" = 444 '
    + '&& rm -f /etc/apt/apt.conf.d/docker-clean /etc/apt/sources.list '
    + `&& printf '%s\\n' 'Types: deb' `
    + `"URIs: ${ENVIRONMENT.ubuntu.snapshotUrl}\${UBUNTU_SNAPSHOT}" `
    + `'Suites: ${ENVIRONMENT.ubuntu.suites.join(' ')}' `
    + `'Components: ${ENVIRONMENT.ubuntu.components.join(' ')}' `
    + `'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' `
    + '> /etc/apt/sources.list.d/ubuntu.sources '
    + `&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem -o Acquire::Retries=${ENVIRONMENT.ubuntu.aptRetries} update `
    + `&& apt-get -o Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem -o Acquire::Retries=${ENVIRONMENT.ubuntu.aptRetries} install `
    + '-y --no-install-recommends '
    + `${ENVIRONMENT.ubuntu.packages.join(' ')} `
    + `&& test "$(python3 --version)" = "Python ${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION}" `
    + '&& command -v unzip >/dev/null '
    + '&& python3 -c "import hashlib,json,tarfile" '
    + '&& dpkg-query -W -f="${Package}=${Version}\\n" | LC_ALL=C sort '
    + '> /usr/local/share/sec-environment-packages.txt '
    + '&& rm -rf /var/lib/apt/lists/*\n'
    + 'FROM scratch AS node-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.node.digest} `
    + `${ENVIRONMENT.archives.node.url} /node.tar.xz\n`
    + 'FROM runtime AS node-runtime\n'
    + 'RUN --mount=from=node-archive,source=/node.tar.xz,target=/tmp/node.tar.xz,ro '
    + 'tar --no-same-owner -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 '
    + `&& test "$(node --version)" = "v${LOCAL_GITHUB_ACTIONS_NODE_VERSION}"\n`
    + 'FROM scratch AS runner-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.runner.digest} `
    + `${ENVIRONMENT.archives.runner.url} /runner.tar.gz\n`
    + 'FROM node-runtime AS runner-runtime\n'
    + 'WORKDIR /actions-runner\n'
    // GitHub publishes the archive with uid/gid 1001. The runtime deliberately drops
    // CAP_DAC_OVERRIDE, so normalize archive ownership to the fixed container root owner.
    + 'RUN --mount=from=runner-archive,source=/runner.tar.gz,target=/tmp/runner.tar.gz,ro '
    + 'tar --no-same-owner -xzf /tmp/runner.tar.gz\n'
    + 'FROM scratch AS github-cli-archive\n'
    + `ADD --checksum=${ENVIRONMENT.archives.githubCli.digest} `
    + `${ENVIRONMENT.archives.githubCli.url} /gh.tar.gz\n`
    + 'FROM runner-runtime\n'
    + 'RUN --mount=from=github-cli-archive,source=/gh.tar.gz,target=/tmp/gh.tar.gz,ro '
    + 'tar --no-same-owner -xzf /tmp/gh.tar.gz -C /tmp '
    + `&& install -m 0755 /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION}_linux_amd64/bin/gh `
    + '/usr/local/bin/gh '
    + `&& gh --version | head -n 1 | grep -E '^gh version ${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION.replaceAll('.', '\\.')}`
    + " ' "
    + `&& rm -rf /tmp/gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION}_linux_amd64\n`
    + `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA} `
    + `sec.local-runner.image-revision=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION} `
    + `sec.local-runner.runner-version=${LOCAL_GITHUB_ACTIONS_RUNNER_VERSION} `
    + `sec.local-runner.node-version=${LOCAL_GITHUB_ACTIONS_NODE_VERSION} `
    + `sec.local-runner.node-archive-sha256=${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256} `
    + `sec.local-runner.github-cli-version=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION} `
    + `sec.local-runner.github-cli-archive-sha256=${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256} `
    + `sec.local-runner.python-version=${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION} `
    + `sec.local-runner.ubuntu-snapshot=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT} `
    + `sec.local-runner.bootstrap-ca-bundle-sha256=${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256} `
    + `sec.local-runner.dockerfile-frontend=${LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND}\n`
    + 'ENV RUNNER_ALLOW_RUNASROOT=1\n'
    + 'ENTRYPOINT ["/bin/bash","-lc"]\n';
}

export function createLocalGitHubActionsRunnerEnvironmentSpec() {
  const buildInputClosureDigest = sha256(
    createLocalGitHubActionsRunnerBuildInputProjection()
  ) as `sha256:${string}`;
  return createEnvironmentMaterializationSpec({
    imageName: LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE,
    acceptedImageDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID,
    sourcePolicyRevision: ENVIRONMENT.provider.sourcePolicyRevision,
    providerRequirement: ENVIRONMENT.provider.requirement,
    components: [
      {
        id: 'authority-input-closure',
        version: ENVIRONMENT.environmentId,
        sourceDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST
      },
      {
        id: 'base-image',
        version: `ubuntu-${ENVIRONMENT.ubuntu.version}`,
        sourceDigest: ENVIRONMENT.ubuntu.baseDigest
      },
      {
        id: 'bootstrap-ca-bundle',
        version: LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_DATE,
        sourceDigest: ENVIRONMENT.archives.bootstrapCa.digest
      },
      {
        id: 'dockerfile-frontend',
        version: ENVIRONMENT.provider.dockerfileFrontend.version,
        sourceDigest: ENVIRONMENT.provider.dockerfileFrontend.digest
      },
      {
        id: 'github-cli',
        version: LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION,
        sourceDigest: ENVIRONMENT.archives.githubCli.digest
      },
      {
        id: 'node',
        version: LOCAL_GITHUB_ACTIONS_NODE_VERSION,
        sourceDigest: ENVIRONMENT.archives.node.digest
      },
      {
        id: 'runner',
        version: LOCAL_GITHUB_ACTIONS_RUNNER_VERSION,
        sourceDigest: ENVIRONMENT.archives.runner.digest
      },
      {
        id: 'runner-build-input-closure',
        version: ENVIRONMENT.image.buildRevision,
        sourceDigest: buildInputClosureDigest
      }
    ]
  });
}

function createLocalGitHubActionsRunnerOciBakeRequest(candidatePath: string): Readonly<Record<string, unknown>> {
  // Bake interpolates `${...}` in string values before forwarding the inline Dockerfile.
  // Escape only that grammar. Shell command substitutions such as `$(stat ...)` must
  // retain one dollar sign or the resulting Dockerfile changes execution semantics.
  const dockerfileInline = createLocalGitHubActionsRunnerDockerfile().replaceAll('${', () => '$${');
  return Object.freeze({
    group: { default: { targets: ['runner-oci'] } },
    target: {
      'runner-oci': {
        context: '.',
        'dockerfile-inline': dockerfileInline,
        args: { SOURCE_DATE_EPOCH: LOCAL_GITHUB_ACTIONS_SOURCE_DATE_EPOCH },
        platforms: [ENVIRONMENT.platform],
        output: [
          `type=oci,dest=${candidatePath},tar=false,rewrite-timestamp=true,name=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE}`
        ],
        attest: [`type=provenance,mode=${ENVIRONMENT.provenance.materializationMode}`]
      }
    }
  });
}

function createLocalGitHubActionsRunnerProjectionBuildxArgsForUri(
  retainedLayoutUriPath: string
): readonly string[] {
  return Object.freeze([
    'buildx', 'build',
    '--build-context',
    `runtime=oci-layout://${retainedLayoutUriPath}@${LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST}`,
    '--file', '-',
    '--platform', ENVIRONMENT.platform,
    '--tag', LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE,
    '--output', 'type=docker',
    '--provenance=false',
    `--progress=${ENVIRONMENT.provider.progressMode}`,
    '.'
  ]);
}

/**
 * Exact provider-owned artifact input closure. Runtime paths are replaced by
 * fixed semantic placeholders; every byte sent to Buildx that can change the
 * OCI artifact or its Docker projection is otherwise represented verbatim.
 */
export function createLocalGitHubActionsRunnerBuildInputProjection() {
  return Object.freeze({
    schema: 'sec-local-runner-build-input-projection-v1' as const,
    authorityInputDigest: SEC_LINUX_VERIFICATION_RUNNER_INPUT_DIGEST,
    dockerfileSource: createLocalGitHubActionsRunnerDockerfile(),
    bakeRequest: createLocalGitHubActionsRunnerOciBakeRequest('<candidate-layout>'),
    projectionArgs: createLocalGitHubActionsRunnerProjectionBuildxArgsForUri('<layout>'),
    projectionStdin: 'FROM runtime\n',
    runtimeManifestDigest: LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST,
    dockerProjectionDigest: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID
  });
}

export function createLocalGitHubActionsRunnerOciBakeDefinition(candidatePath: string): string {
  const retainedCandidatePath = path.resolve(boundedText(candidatePath, 'OCI candidate path', 32_768));
  return `${JSON.stringify(createLocalGitHubActionsRunnerOciBakeRequest(retainedCandidatePath))}\n`;
}

export function createLocalGitHubActionsRunnerProjectionBuildxArgs(
  layoutPath: string
): readonly string[] {
  const retainedLayoutPath = path.resolve(boundedText(layoutPath, 'OCI layout path', 32_768));
  const retainedLayoutUriPath = retainedLayoutPath.split(path.sep).join('/');
  return createLocalGitHubActionsRunnerProjectionBuildxArgsForUri(retainedLayoutUriPath);
}
