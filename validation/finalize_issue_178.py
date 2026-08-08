from pathlib import Path
import hashlib
import re
import shutil
import subprocess

BASE_EXPR = '$' + '{{ steps.resolve.outputs.base }}'
MANIFEST_EXPR = '$' + '{{ steps.resolve.outputs.manifest }}'

LEGACY_P0_REVISIONS = (
    ('base', '01d5c45a573337bee484d6a9d2effb2a76787b86'),
    ('head', 'ab5d3a839afc1d595ae5c43437eb862cde1500c1'),
    ('tested', '514e6e401659f18ecffca19856a11354d66d05df'),
)
LEGACY_P0_REQUIRED_BLOB = '334dd8dbe7162cd35f832257b735e79dd39e5650'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {source.count(old)}')
    return source.replace(old, new, 1)


def run_git(args: list[str], *, secret: str | None = None) -> bytes:
    completed = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if completed.returncode == 0:
        return completed.stdout
    stderr = completed.stderr.decode('utf-8', errors='replace')[-4000:]
    if secret:
        stderr = stderr.replace(secret, '<redacted-remote>')
        stderr = re.sub(r'x-access-token:[^@\s]+@', 'x-access-token:<redacted>@', stderr)
    raise SystemExit(f"validation Git command failed ({args[0]} {args[1] if len(args) > 1 else ''}): {stderr}")


def neutralize_frozen_validation_alternates() -> None:
    legacy_repositories = [Path(f'.tmp/legacy-p0-{name}') for name, _ in LEGACY_P0_REVISIONS]
    present = [repository.is_dir() for repository in legacy_repositories]
    if not any(present):
        return
    if not all(present):
        raise SystemExit('validation legacy P0 repositories are only partially materialized')

    remote_url = run_git(['git', '-C', str(legacy_repositories[0]), 'remote', 'get-url', 'origin']).decode().strip()
    if not remote_url:
        raise SystemExit('validation legacy P0 repository has no origin URL')

    # One authenticated fetch imports the exact immutable P0 closure into the candidate repository.
    # The frozen validation attempt can then keep its immutable step-level environment while the
    # three alternate directories are deliberately emptied so they carry no Git-object semantics.
    run_git(
        [
            'git',
            '-c',
            'protocol.version=2',
            'fetch',
            '--no-tags',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            remote_url,
            *(revision for _, revision in LEGACY_P0_REVISIONS),
        ],
        secret=remote_url,
    )
    for _, revision in LEGACY_P0_REVISIONS:
        run_git(['git', 'cat-file', '-e', f'{revision}^{{commit}}'])
    run_git(['git', 'cat-file', '-e', LEGACY_P0_REQUIRED_BLOB])

    for repository in legacy_repositories:
        object_directory = repository / '.git' / 'objects'
        if not object_directory.is_dir():
            raise SystemExit(f'validation legacy P0 object directory is missing: {object_directory}')
        shutil.rmtree(object_directory)
        (object_directory / 'info').mkdir(parents=True)
        (object_directory / 'pack').mkdir(parents=True)


neutralize_frozen_validation_alternates()

bootstrap_path = Path('.github/workflows/sec-trusted-bootstrap.yml')
bootstrap = bootstrap_path.read_text()
old_p0_steps = """      - name: Materialize immutable P0 anticipated-head objects
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
        with:
          ref: ab5d3a839afc1d595ae5c43437eb862cde1500c1
          path: .tmp/sec-trusted-bootstrap/p0-head
          fetch-depth: 1
          persist-credentials: false

      - name: Materialize immutable P0 tested-head objects
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5
        with:
          ref: 514e6e401659f18ecffca19856a11354d66d05df
          path: .tmp/sec-trusted-bootstrap/p0-tested
          fetch-depth: 1
          persist-credentials: false
"""
new_p0_step = """      - name: Materialize immutable P0 fixture objects
        shell: bash
        env:
          GITHUB_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          url="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
          git -c protocol.version=2 fetch --no-tags --no-recurse-submodules --no-write-fetch-head "$url" \
            01d5c45a573337bee484d6a9d2effb2a76787b86 \
            ab5d3a839afc1d595ae5c43437eb862cde1500c1 \
            514e6e401659f18ecffca19856a11354d66d05df
          for sha in \
            01d5c45a573337bee484d6a9d2effb2a76787b86 \
            ab5d3a839afc1d595ae5c43437eb862cde1500c1 \
            514e6e401659f18ecffca19856a11354d66d05df; do
            git cat-file -e "${sha}^{commit}"
          done
          git cat-file -e 334dd8dbe7162cd35f832257b735e79dd39e5650
"""
bootstrap = replace_once(bootstrap, old_p0_steps, new_p0_step, 'bootstrap P0 object materialization')

snapshot = """        run: |
          set -euo pipefail
          mkdir -p .tmp/sec-trusted-bootstrap
          bun -e \"import { generateTcbClosureLockForRevision } from './platform/shared/tcb-closure-lock.ts'; process.stdout.write(JSON.stringify(generateTcbClosureLockForRevision(process.env.SEC_BOOTSTRAP_BASE), null, 2) + '\\\\n');\" > .tmp/sec-trusted-bootstrap/generated-tcb-lock.json
"""
snapshot_repaired = """        run: |
          set -euo pipefail
          unset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
          unset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY
          mkdir -p .tmp/sec-trusted-bootstrap
          bun -e \"import { generateTcbClosureLockForRevision } from './platform/shared/tcb-closure-lock.ts'; process.stdout.write(JSON.stringify(generateTcbClosureLockForRevision(process.env.SEC_BOOTSTRAP_BASE), null, 2) + '\\\\n');\" > .tmp/sec-trusted-bootstrap/generated-tcb-lock.json
"""
bootstrap = replace_once(bootstrap, snapshot, snapshot_repaired, 'bootstrap credential scrub')

old_alt = "          GIT_ALTERNATE_OBJECT_DIRECTORIES: ${{ github.workspace }}/.tmp/sec-trusted-bootstrap/p0-head/.git/objects:${{ github.workspace }}/.tmp/sec-trusted-bootstrap/p0-tested/.git/objects\n"
bootstrap = replace_once(bootstrap, old_alt, '', 'bootstrap removes P0 alternates')

env_old = f"""          SEC_AFFECTED_TESTS_BASE: {BASE_EXPR}
          SEC_WORK_PACKAGE_MANIFEST_PATH: {MANIFEST_EXPR}
"""
env_new = f"""          SEC_AFFECTED_TESTS_BASE: {BASE_EXPR}
          SEC_WORK_PACKAGE_MANIFEST_PATH: {MANIFEST_EXPR}
          SEC_REPOSITORY_AUDIT_DEFAULT_REF: {BASE_EXPR}
"""
bootstrap = replace_once(bootstrap, env_old, env_new, 'bootstrap audit default ref')

imports_old = """          out=.tmp/sec-trusted-bootstrap
          mkdir -p "$out"

          bun run imports:check 2>&1 | tee "$out/imports.log"
"""
imports_new = f"""          out=.tmp/sec-trusted-bootstrap
          mkdir -p "$out"
          git update-ref refs/remotes/origin/main '{BASE_EXPR}'

          bun run imports:check 2>&1 | tee "$out/imports.log"
"""
bootstrap = replace_once(bootstrap, imports_old, imports_new, 'bootstrap exact import base')

focused_old = """            tests/unit/tcb-trust-root-contract.test.ts \\
            tests/contract/sec-merge-gate.test.ts \\
"""
focused_new = """            tests/unit/tcb-trust-root-contract.test.ts \\
            tests/unit/test-runner.test.ts \\
            tests/contract/ci-contract.test.ts \\
            tests/contract/sec-merge-gate.test.ts \\
"""
bootstrap = replace_once(bootstrap, focused_old, focused_new, 'bootstrap focused tests')
bootstrap_path.write_text(bootstrap)

manifest_path = Path('docs/work-packages/trusted-verifier-causal-closure-v1.md')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, """      - tests/unit/tcb-trust-root-contract.test.ts
forbiddenPaths:
""", """      - tests/unit/tcb-trust-root-contract.test.ts
  - id: test-runner-host-independence
    owner: test-runtime-maintainer
    ownedPaths:
      - tests/unit/test-runner.test.ts
forbiddenPaths:
""", 'manifest second task')
manifest = replace_once(manifest, """  - 'Focused positive/negative contracts, repository audit, affected selection/tests and physical GitHub execution pass; independent Review and new-main readback are required before the new trust revision becomes authoritative.'
tests:
""", """  - 'Focused positive/negative contracts, repository audit, affected selection/tests and physical GitHub execution pass; independent Review and new-main readback are required before the new trust revision becomes authoritative.'
  - 'The required fast-test runner regression is host-independent: one-CPU, two-CPU and wider hosts cannot deadlock by waiting for siblings outside the scheduler first batch; this fixes the exact current-main failure discovered during #178 physical verification rather than reclassifying it as non-blocking.'
tests:
""", 'manifest acceptance')
manifest = replace_once(manifest, """tests:
  - tests/unit/tcb-trust-root-contract.test.ts
""", """tests:
  - tests/unit/tcb-trust-root-contract.test.ts
  - tests/unit/test-runner.test.ts
""", 'manifest tests')
manifest = replace_once(manifest, """- 本包自身改变 trust registry、classifier 与 workflows，因此必须由旧 trusted revision
  识别为 trust transition，并在 new-main readback 后才建立新的 trusted epoch。
""", """- 本包自身改变 trust registry、classifier 与 workflows，因此必须由旧 trusted revision
  识别为 trust transition，并在 new-main readback 后才建立新的 trusted epoch。

## 物理验证期间修复的独立 blocker

exact `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 在 GitHub 2-CPU runner 上已独立复现
`tests/unit/test-runner.test.ts` 的 host-concurrency 死锁：旧测试等待 4 个 independent-process
child 全部启动，但 scheduler 的真实 first-batch limit 为 2。该 required failure 不得降级为
non-blocking；本包以独立 `test-runtime-maintainer` task 修复测试合同，不改变生产 scheduler。
""", 'manifest blocker evidence')
manifest_path.write_text(manifest)

pointer_path = Path('docs/work/active-work-package.md')
pointer = pointer_path.read_text()
digest = hashlib.sha256(manifest.encode()).hexdigest()
pointer, count = re.subn(r'manifestDigest: sha256:[0-9a-f]{64}', f'manifestDigest: sha256:{digest}', pointer, count=1)
if count != 1:
    raise SystemExit('active pointer digest anchor not found')
pointer_path.write_text(pointer)

ci_path = Path('tests/contract/ci-contract.test.ts')
ci = ci_path.read_text()
old_ci_p0 = """  expect(bootstrapWorkflowSource).toContain('ref: ab5d3a839afc1d595ae5c43437eb862cde1500c1');
  expect(bootstrapWorkflowSource).toContain('ref: 514e6e401659f18ecffca19856a11354d66d05df');
  expect(bootstrapWorkflowSource).toContain('GIT_ALTERNATE_OBJECT_DIRECTORIES');
"""
new_ci_p0 = """  const bootstrapP0 = workflowStep(bootstrapWorkflow, 'trusted-bootstrap-regression', 'Materialize immutable P0 fixture objects');
  expect(bootstrapP0.env?.GITHUB_TOKEN).toBe('${{ github.token }}');
  expect(bootstrapP0.run).toContain('01d5c45a573337bee484d6a9d2effb2a76787b86');
  expect(bootstrapP0.run).toContain('ab5d3a839afc1d595ae5c43437eb862cde1500c1');
  expect(bootstrapP0.run).toContain('514e6e401659f18ecffca19856a11354d66d05df');
  expect(bootstrapP0.run).toContain('334dd8dbe7162cd35f832257b735e79dd39e5650');
  expect(bootstrapP0.run).toContain('git -c protocol.version=2 fetch --no-tags --no-recurse-submodules --no-write-fetch-head "$url"');
  expect(bootstrapWorkflowSource).not.toContain('GIT_ALTERNATE_OBJECT_DIRECTORIES');
"""
ci = replace_once(ci, old_ci_p0, new_ci_p0, 'ci contract P0 object store')
ci = replace_once(ci, """  expect(bootstrapWorkflowSource).toContain('generateTcbClosureLockForRevision');
""", """  const bootstrapSnapshot = workflowStep(bootstrapWorkflow, 'trusted-bootstrap-regression', 'Generate candidate TCB closure snapshot');
  expect(bootstrapSnapshot.run).toContain('ACTIONS_RUNTIME_TOKEN');
  expect(bootstrapSnapshot.run).toContain('GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY');
  const bootstrapRegression = workflowStep(bootstrapWorkflow, 'trusted-bootstrap-regression', 'Run candidate bootstrap regression suite');
  expect(bootstrapRegression.env).toMatchObject({
    SEC_REPOSITORY_AUDIT_DEFAULT_REF: '__BASE_EXPR__'
  });
  expect(bootstrapRegression.run).toContain(\"git update-ref refs/remotes/origin/main '__BASE_EXPR__'\");
  expect(bootstrapWorkflowSource).toContain('generateTcbClosureLockForRevision');
""".replace('__BASE_EXPR__', BASE_EXPR), 'ci contract bootstrap isolation')
ci_path.write_text(ci)

print(f'manifestDigest=sha256:{digest}')
