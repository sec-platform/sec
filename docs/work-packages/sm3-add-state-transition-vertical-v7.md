---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v7
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: run-real-typescript-entry-diagnostic-vertical
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v7.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v7-verification.json
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
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-resolution-fixture-repair.json
  - docs/work-packages/sm3-add-state-transition-vertical-v6.md
  - docs/work-packages/sm3-isolated-verification-typescript-resolution-fixture-repair-v1.md
acceptance:
  - "The composite focused authority remains exact and passed: docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-resolution-fixture-repair.json sha256:1302ce6f678acac3940f92e1dec95389c1211897c82555314910ebc278f0dba8, combining the still-valid 27-test baseline with one current-hash named delta PASS."
  - "The terminal vertical-v6 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json sha256:7630b3637cc0a4df3ab5ad683e573f5addc32e2887a8cf4d3890478199330ab7."
  - "The exact orchestrator, child progress, child outcome, runtime plan, isolated child host and heavyweight runner inputs are sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af, sha256:09c1414baa5ae4fd3a8a4840a110ee44b0d6d1a03a62e7f20786b75953328149, sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:2cd0347b372dcb0007d2bbaaa8a5c861264aff64310df7e399ca766c0a77d4c3, sha256:3e9f1911d65e0c01da54d05b9a163f8d76d78b26141c943a678988a31f684143 and sha256:9c00a0aaa25fae1b17fbb98cf3a7761e7785d50744e18c027631fdb1a5784fdb."
  - "The exact contract and integration tests are sha256:301cff1e5ce1d4282cf88d21190c290a6c360d735ef7370f35cfbff5a1ea31c3 and sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one real contract-plus-add-state-transition command runs with the unchanged 600000 command timeout and existing 300000 integration timeout."
  - "The run launches only the product-owned Windows AppContainer path. It adds no resolver/profile/registry probe, cleanup pass, retry, output persistence, dependency change or fallback execution."
  - "The real child may report only the existing finite boundary: 76 at loader-entered, 77 at typescript-specifier-resolved, 78 at typescript-entry-identity-verified, 79 at typescript-imported, later 75 after runtime verification, or an existing non-loader termination class."
  - "No resolved value, absolute path, file URL, caught Error, message, module export, stdout/stderr, raw exit value, profile state or unbounded payload is recorded."
  - "PASS still requires the real dry-run/apply/replay vertical, isolated Verification, atomic publish and live derivative rebuild before timeout."
  - "This package is terminal after its one command. No second attempt, timeout expansion, vertical-v6, old Gate, typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow matrix or Actions runs."
  - "Only a PASS may authorize integration closeout. A failure must freeze exact evidence and compute any successor from its finite class/checkpoint without broadening the pipeline or dependency closure."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v7.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v7-verification.json"
---

# SM3 Add State Transition Vertical V7

Vertical-v6 已把真实失败缩到 caught TypeScript import rejection，但当时无法区分 child-local resolution、manifest entry identity、exact-entry import/evaluation 与 post-import runtime contract。当前 focused 组合已把四段诊断、模块缓存同一性、host fail-closed 和 tamper proof 闭合。

V7 只运行同一个真实 add-state-transition 母例一次。它不修改产品或延长超时；唯一目的，是让真实 AppContainer child 进入 PASS，或给出 76/77/78/79 中唯一合法的下一边界。
