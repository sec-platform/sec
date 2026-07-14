---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v4
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: verify-real-add-state-transition-after-termination-trace-repair
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v4.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json
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
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v3-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-bootstrap-tamper-fixture.json
  - docs/work-packages/sm3-add-state-transition-vertical-v3.md
  - docs/work-packages/sm3-isolated-verification-termination-trace-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-bootstrap-tamper-fixture-v1.md
acceptance:
  - "The consumed combined focused authority remains exact and passed: docs/evidence/v0-4-semantic-mutation-isolated-verification-bootstrap-tamper-fixture.json sha256:820ccbe637a4e2943346cf9b33d1fc60efdc9c665d6b62666a359f03fd7213f1 with combined 54/54 PASS."
  - "The terminal vertical-v3 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v3-verification.json sha256:8ef309b07e33272312edc40c61616f3887ce40453bf5816800d0006c3024d929."
  - "The exact orchestrator, child progress, child outcome, runtime plan, isolated child host and runner inputs are sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af, sha256:f16a2bd42030775a9879cfc0645f04f51eeddc66fb845de27c3bd01f8be7ba18, sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:ab6081c8db6c7919eef72952634298b1cfbb664946dd05c460d863b58ec67c91, sha256:8e0ea1e50799c038a8d3ab89060b92cbb9fe373721d8911c02933bc40209f969 and sha256:9c00a0aaa25fae1b17fbb98cf3a7761e7785d50744e18c027631fdb1a5784fdb."
  - "The exact contract and integration tests are sha256:aeb9623478acc4349c65897d2d62c90a957915fbbe826cecf26a50f89070be9d and sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one real contract-plus-add-state-transition command runs. The command timeout remains 600000 and the integration test's existing explicit 300000 timeout is not changed."
  - "The run may launch exactly the product-owned Windows AppContainer path already required by the test. It adds no profile/registry probe, cleanup pass, retry, stdout/stderr persistence or fallback execution."
  - "PASS requires the existing contract tests plus the real dry-run/apply/replay vertical. A late result after the test timeout cannot be promoted to PASS."
  - "If the vertical fails, evidence records the exact allowlisted stage, child stage, artifact, termination class, stable checkpoint and pending checkpoint exposed by the repaired protocol. It does not infer raw exit code, message, path, stdout/stderr, profile state or root cause beyond that typed interval."
  - "This package is terminal after its one command. No second attempt, timeout expansion, old Gate, typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow matrix or Actions runs."
  - "Only a PASS may authorize integration closeout. A failure must freeze evidence and recompute the next structural repair from the newly typed interval."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v4.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json"
---

# SM3 Add State Transition Vertical V4

本包只回答一个问题：在 exact 54/54 focused authority 下，真实 `add-state-transition` 是否完成 dry-run、apply、atomic publish、live derivative rebuild 与 replay；若 isolated child 仍失败，新 termination/checkpoint protocol 能否把失败收敛到确定的 source interval。

Vertical-v3 已 terminal，不重跑也不改 timeout。V4 只有一次真实命令；结果无论通过或失败都立即冻结为新工程事实。
