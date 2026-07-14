---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v6
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: distinguish-real-typescript-import-rejection-from-abnormal-termination
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v6.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - tests/
  - scripts/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-loader-import-exit-repair.json
  - docs/work-packages/sm3-add-state-transition-vertical-v5.md
  - docs/work-packages/sm3-isolated-verification-loader-import-exit-repair-v1.md
acceptance:
  - "The loader-import exit focused authority remains exact and passed: docs/evidence/v0-4-semantic-mutation-isolated-verification-loader-import-exit-repair.json sha256:65e5d210d8e4cc8e766b20169032c96caac7d8a3020183f4fabf81d7a575dcdc with 27/27 PASS."
  - "The terminal vertical-v5 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json sha256:2b87b4423dc2380fa3a860d6caaab40272f82bc00d05dd3b988553a9d6456ab2."
  - "The exact orchestrator, child progress, child outcome, runtime plan, isolated child host and heavyweight runner inputs are sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af, sha256:69c34cdfac78e3cf9f34235f83ad6c826546bf09c990f7a6ea39d33a2fb00475, sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:5111020c3b65ef5fa404d7e4cc8da01e017b9667cd12e0a0c6be3de64910ee09, sha256:18fd9bbee705df461802025516e411437e3b57ae701a29bde91bc7a2ac8d7641 and sha256:9c00a0aaa25fae1b17fbb98cf3a7761e7785d50744e18c027631fdb1a5784fdb."
  - "The exact contract and integration tests are sha256:f4895476099816438bf3401f1ad28f7510a304f1fd00a2a01004d8de10be812b and sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one real contract-plus-add-state-transition command runs with the unchanged 600000 command timeout and existing 300000 integration timeout."
  - "The run launches only the product-owned Windows AppContainer path. It adds no profile/registry probe, cleanup pass, retry, output persistence or fallback execution."
  - "If the child again stops at loader-entered, loader-import-failure proves the caught await import('typescript') rejected; unclassified-nonzero proves abnormal termination before the catch could classify it."
  - "No raw exit value, caught Error, message, path, stdout/stderr, profile state or unbounded payload is recorded."
  - "PASS still requires the real dry-run/apply/replay vertical, isolated Verification, atomic publish and live derivative rebuild before timeout."
  - "This package is terminal after its one command. No second attempt, timeout expansion, old Gate, typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow matrix or Actions runs."
  - "Only a PASS may authorize integration closeout. A failure must freeze evidence and compute the next structural package from its fixed class/checkpoint."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v6.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json"
---

# SM3 Add State Transition Vertical V6

Vertical-v5 已证明真实 child 在 `loader-entered → typescript-imported` 区间终止，但旧 exit class 无法区分 caught import rejection 与 abnormal termination。Exit-repair 已用 27/27 focused evidence 将两者分开。

V6 只运行同一个真实母例一次。它不寻求靠重试通过；唯一目的，是把 TypeScript import 区间变成可执行的二值工程事实，同时保留完整产品 PASS 路径。
