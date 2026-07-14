---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: prove-add-state-transition-apply
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v1.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-verification.json
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
  - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
  - docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json
  - docs/evidence/v0-4-semantic-mutation-owned-profile-authority-verification.json
acceptance:
  - "The narrow owned-profile successor remains exact: docs/evidence/v0-4-semantic-mutation-owned-profile-authority-verification.json sha256:dfbcc99018941c222652af91f5049b4640d49a9cdc4aa592ad36a084c5ab30dc."
  - "R2 and R3-v4 remain immutable stop authority: sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3 and sha256:a035318656987a61a8adcc703c40b53826c74c5c5512573359c7248067da6492."
  - "The exact unmodified product vertical inputs are tests/integration/semantic-mutation-apply.test.ts sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1 and tests/contract/semantic-mutation-apply-contract.test.ts sha256:331360c825c9f065342e864fa1d7dbe60a79bd99cf3730c4f86562507cfc744a."
  - "The working diff has no platform change and no change to either selected test file. This package observes the current candidate; it does not repair or reinterpret it."
  - "Exactly one combined Bun child runs the two frozen files. No selection from the old 39-file manifest, test-name filter, reporter retry, timeout increase, cleanup probe or second attempt is permitted."
  - "PASS requires every contract and integration test in both files to pass. Any failure, timeout, missing summary or unexpected residue terminates this package with exact available output; no repair or rerun occurs here."
  - "The run must not read, recover, rewrite or delete the retained R2/R3 namespaces, snapshots, owner sidecars or external recovery workspace."
  - "A PASS authorizes only a separately frozen next evidence package. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow, workspace/reference, GitHub Actions, commit, push or merge."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v1.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-verification.json"
---

# SM3 Add State Transition Vertical V1

R2 已证明旧 39-file batch 没有可晋升结果，R3/R4 也没有启动产品 child。当前 successor 已删除无权威的全局 profile census，但它只证明 Gate authority 边界，不证明 applySemanticMutation()。

本包回到唯一产品母例：用未修改的正式合同测试和真实 integration file，一次证明 add-state-transition 的 plan、isolated Verification、atomic publish、live rebuild、exact replay、collision rejection 与失败生命周期。它不是实现包；失败即记录并停止，禁止在同包内形成“改一点、重跑一次”的循环。
