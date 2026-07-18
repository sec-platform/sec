---
schema: codex-development-work-package-v1
id: ci-sm3-p0-contract-transition-v1
tracking: issue-106
base: "db7649cf847f6ef52362fc45ae07ad96e341cf64"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: sm3-p0-contract-transition
    owner: a0
    ownedPaths:
      - docs/work-packages/ci-sm3-p0-contract-transition-v1.md
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - package.json
  - docs/03-MVP实施计划与路线图.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/evidence/
  - docs/test-feedback-and-ci-lanes.md
  - docs/work-packages/sm3-p0-local-isolated-runner-v1.md
  - platform/compiler/
  - platform/orchestrator/
  - scripts/
  - tests/contract/test-impact.test.ts
  - tests/e2e/
acceptance:
  - "base-owned V7 policy 将 tests/contract/test-impact.test.ts 的 P0 transition 精确绑定为 base blob 6e9d931a32f8e5e1e0247d1fc74a0bbda5d219fc 到 candidate blob 5d7da4f7df39bd18ba4acff5263c6166557f1459。"
  - "candidate blob 只把 runner-build tombstone 的 selection owners 从 auto-reference 加 semantic-mutation 收敛为 semantic-mutation，其他字节、fast/slow selection 与 AppContainer expectation 保持不变。"
  - "active base 下的旧 candidate blob c7fe5d1e90a9ca31884cb39b873c2f564b789ea6、任意其他 current blob、mode 或 type 全部 fail closed；不匹配的 base identity 不适用本 transition。"
  - "本包不修改 PR 113 的产品代码、测试合同、文档、manifest、runtime、production sentinel 或 AppContainer 能力边界。"
  - "PR 113 仍须在本 transition 进入 main 后 rebase、重冻 V2 manifest 并取得 exact-head V7 evidence；本包本身不宣告 P0、AppContainer 或 SM-3 完成。"
tests:
  - "bun test tests/unit/ci-evidence-composition-policy-registry.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=db7649cf847f6ef52362fc45ae07ad96e341cf64 bun run imports:check"
  - "git diff --check"
---

# CI SM3 P0 Contract Transition V1

PR 113 删除三个 runner-build tombstone 后，`tests/contract/test-impact.test.ts` 仍把这些不存在的测试源当成可由 import graph 自动发现，错误期待 `auto-reference` owner。合同的真实稳定语义只剩 registry 声明的 `semantic-mutation` owner；fast/slow selection 本身没有变化，Windows AppContainer 的独立 expectation 也不在本次修正范围。

本包只提前更新 base-owned V7 transition registry：从当前候选 blob 以内存方式替换唯一 owner assertion，并把所得 ordinary Git blob `5d7da4f7df39bd18ba4acff5263c6166557f1459` 固定为唯一允许的 P0 candidate identity。#118 合入后的 `main` 仍保留精确 base blob `6e9d931a32f8e5e1e0247d1fc74a0bbda5d219fc`；旧候选和任何额外字节漂移继续被拒绝。产品测试文件由 PR 113 在 transition 合入 `main` 后自行修正、rebase 与重冻；本包不触碰该候选文件。
