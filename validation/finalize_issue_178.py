from pathlib import Path
import hashlib
import re

BASE_EXPR = '$' + '{{ steps.resolve.outputs.base }}'
MANIFEST_EXPR = '$' + '{{ steps.resolve.outputs.manifest }}'
WORKSPACE_EXPR = '$' + '{{ github.workspace }}'


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if source.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {source.count(old)}')
    return source.replace(old, new, 1)


bootstrap_path = Path('.github/workflows/sec-trusted-bootstrap.yml')
bootstrap = bootstrap_path.read_text()
anticipated = """      - name: Materialize immutable P0 anticipated-head objects\n        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5\n        with:\n          ref: ab5d3a839afc1d595ae5c43437eb862cde1500c1\n          path: .tmp/sec-trusted-bootstrap/p0-head\n          fetch-depth: 1\n          persist-credentials: false\n"""
base_step = """      - name: Materialize immutable P0 base object\n        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5\n        with:\n          ref: 01d5c45a573337bee484d6a9d2effb2a76787b86\n          path: .tmp/sec-trusted-bootstrap/p0-base\n          fetch-depth: 1\n          persist-credentials: false\n\n"""
bootstrap = replace_once(bootstrap, anticipated, base_step + anticipated, 'bootstrap p0 base')

snapshot = """        run: |\n          set -euo pipefail\n          mkdir -p .tmp/sec-trusted-bootstrap\n          bun -e \"import { generateTcbClosureLockForRevision } from './platform/shared/tcb-closure-lock.ts'; process.stdout.write(JSON.stringify(generateTcbClosureLockForRevision(process.env.SEC_BOOTSTRAP_BASE), null, 2) + '\\\\n');\" > .tmp/sec-trusted-bootstrap/generated-tcb-lock.json\n"""
snapshot_repaired = """        run: |\n          set -euo pipefail\n          unset GH_TOKEN GITHUB_TOKEN ACTIONS_RUNTIME_TOKEN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL\n          unset GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY\n          mkdir -p .tmp/sec-trusted-bootstrap\n          bun -e \"import { generateTcbClosureLockForRevision } from './platform/shared/tcb-closure-lock.ts'; process.stdout.write(JSON.stringify(generateTcbClosureLockForRevision(process.env.SEC_BOOTSTRAP_BASE), null, 2) + '\\\\n');\" > .tmp/sec-trusted-bootstrap/generated-tcb-lock.json\n"""
bootstrap = replace_once(bootstrap, snapshot, snapshot_repaired, 'bootstrap credential scrub')

old_alt = f'GIT_ALTERNATE_OBJECT_DIRECTORIES: {WORKSPACE_EXPR}/.tmp/sec-trusted-bootstrap/p0-head/.git/objects:{WORKSPACE_EXPR}/.tmp/sec-trusted-bootstrap/p0-tested/.git/objects'
new_alt = f'GIT_ALTERNATE_OBJECT_DIRECTORIES: {WORKSPACE_EXPR}/.tmp/sec-trusted-bootstrap/p0-base/.git/objects:{WORKSPACE_EXPR}/.tmp/sec-trusted-bootstrap/p0-head/.git/objects:{WORKSPACE_EXPR}/.tmp/sec-trusted-bootstrap/p0-tested/.git/objects'
bootstrap = replace_once(bootstrap, old_alt, new_alt, 'bootstrap alternate objects')

env_old = f"""          SEC_AFFECTED_TESTS_BASE: {BASE_EXPR}\n          SEC_WORK_PACKAGE_MANIFEST_PATH: {MANIFEST_EXPR}\n"""
env_new = f"""          SEC_AFFECTED_TESTS_BASE: {BASE_EXPR}\n          SEC_WORK_PACKAGE_MANIFEST_PATH: {MANIFEST_EXPR}\n          SEC_REPOSITORY_AUDIT_DEFAULT_REF: {BASE_EXPR}\n"""
bootstrap = replace_once(bootstrap, env_old, env_new, 'bootstrap audit default ref')

imports_old = """          out=.tmp/sec-trusted-bootstrap\n          mkdir -p \"$out\"\n\n          bun run imports:check 2>&1 | tee \"$out/imports.log\"\n"""
imports_new = f"""          out=.tmp/sec-trusted-bootstrap\n          mkdir -p \"$out\"\n          git update-ref refs/remotes/origin/main '{BASE_EXPR}'\n\n          bun run imports:check 2>&1 | tee \"$out/imports.log\"\n"""
bootstrap = replace_once(bootstrap, imports_old, imports_new, 'bootstrap exact import base')

focused_old = """            tests/unit/tcb-trust-root-contract.test.ts \\\n            tests/contract/sec-merge-gate.test.ts \\\n"""
focused_new = """            tests/unit/tcb-trust-root-contract.test.ts \\\n            tests/unit/test-runner.test.ts \\\n            tests/contract/ci-contract.test.ts \\\n            tests/contract/sec-merge-gate.test.ts \\\n"""
bootstrap = replace_once(bootstrap, focused_old, focused_new, 'bootstrap focused tests')
bootstrap_path.write_text(bootstrap)

manifest_path = Path('docs/work-packages/trusted-verifier-causal-closure-v1.md')
manifest = manifest_path.read_text()
manifest = replace_once(manifest, """      - tests/unit/tcb-trust-root-contract.test.ts\nforbiddenPaths:\n""", """      - tests/unit/tcb-trust-root-contract.test.ts\n  - id: test-runner-host-independence\n    owner: test-runtime-maintainer\n    ownedPaths:\n      - tests/unit/test-runner.test.ts\nforbiddenPaths:\n""", 'manifest second task')
manifest = replace_once(manifest, """  - 'Focused positive/negative contracts, repository audit, affected selection/tests and physical GitHub execution pass; independent Review and new-main readback are required before the new trust revision becomes authoritative.'\ntests:\n""", """  - 'Focused positive/negative contracts, repository audit, affected selection/tests and physical GitHub execution pass; independent Review and new-main readback are required before the new trust revision becomes authoritative.'\n  - 'The required fast-test runner regression is host-independent: one-CPU, two-CPU and wider hosts cannot deadlock by waiting for siblings outside the scheduler first batch; this fixes the exact current-main failure discovered during #178 physical verification rather than reclassifying it as non-blocking.'\ntests:\n""", 'manifest acceptance')
manifest = replace_once(manifest, """tests:\n  - tests/unit/tcb-trust-root-contract.test.ts\n""", """tests:\n  - tests/unit/tcb-trust-root-contract.test.ts\n  - tests/unit/test-runner.test.ts\n""", 'manifest tests')
manifest = replace_once(manifest, """- 本包自身改变 trust registry、classifier 与 workflows，因此必须由旧 trusted revision\n  识别为 trust transition，并在 new-main readback 后才建立新的 trusted epoch。\n""", """- 本包自身改变 trust registry、classifier 与 workflows，因此必须由旧 trusted revision\n  识别为 trust transition，并在 new-main readback 后才建立新的 trusted epoch。\n\n## 物理验证期间修复的独立 blocker\n\nexact `main@26dcb43c77c9bdfebee35efc217113c958ed017d` 在 GitHub 2-CPU runner 上已独立复现\n`tests/unit/test-runner.test.ts` 的 host-concurrency 死锁：旧测试等待 4 个 independent-process\nchild 全部启动，但 scheduler 的真实 first-batch limit 为 2。该 required failure 不得降级为\nnon-blocking；本包以独立 `test-runtime-maintainer` task 修复测试合同，不改变生产 scheduler。\n""", 'manifest blocker evidence')
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
ci = replace_once(ci, """  expect(bootstrapWorkflowSource).toContain('ref: ab5d3a839afc1d595ae5c43437eb862cde1500c1');\n  expect(bootstrapWorkflowSource).toContain('ref: 514e6e401659f18ecffca19856a11354d66d05df');\n""", """  expect(bootstrapWorkflowSource).toContain('ref: 01d5c45a573337bee484d6a9d2effb2a76787b86');\n  expect(bootstrapWorkflowSource).toContain('ref: ab5d3a839afc1d595ae5c43437eb862cde1500c1');\n  expect(bootstrapWorkflowSource).toContain('ref: 514e6e401659f18ecffca19856a11354d66d05df');\n""", 'ci contract p0 objects')
ci = replace_once(ci, """  expect(bootstrapWorkflowSource).toContain('generateTcbClosureLockForRevision');\n""", """  const bootstrapSnapshot = workflowStep(bootstrapWorkflow, 'trusted-bootstrap-regression', 'Generate candidate TCB closure snapshot');\n  expect(bootstrapSnapshot.run).toContain('ACTIONS_RUNTIME_TOKEN');\n  expect(bootstrapSnapshot.run).toContain('GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY');\n  const bootstrapRegression = workflowStep(bootstrapWorkflow, 'trusted-bootstrap-regression', 'Run candidate bootstrap regression suite');\n  expect(bootstrapRegression.env).toMatchObject({\n    SEC_REPOSITORY_AUDIT_DEFAULT_REF: '__BASE_EXPR__'\n  });\n  expect(bootstrapRegression.run).toContain(\"git update-ref refs/remotes/origin/main '__BASE_EXPR__'\");\n  expect(bootstrapWorkflowSource).toContain('generateTcbClosureLockForRevision');\n""".replace('__BASE_EXPR__', BASE_EXPR), 'ci contract bootstrap isolation')
ci_path.write_text(ci)

print(f'manifestDigest=sha256:{digest}')
