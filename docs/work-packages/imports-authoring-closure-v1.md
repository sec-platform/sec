---
schema: codex-development-work-package-v1
id: imports-authoring-closure-v1
tracking: none
base: "0c4f438f19bc0a0f3c785ae533a41568a0feb3b7"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: imports-authoring-closure
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/imports-authoring-closure-v1.md
      - package.json
      - platform/dev-runner.ts
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/import-organizer.ts
      - platform/shared/contract-freeze-contract.ts
      - tests/contract/contract-freeze.test.ts
      - tests/contract/semantic-mutation-contract.test.ts
      - tests/integration/project-runtime.test.ts
      - tests/testkit/contracts.ts
      - tests/unit/import-organizer-staged.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .github/workflows/
  - AGENTS.md
  - bun.lock
  - platform/compiler/
  - tests/e2e/
acceptance:
  - "Candidate import normalization remains one canonical index transaction and hosted imports:check remains read-only."
  - "One authoring preparation pass selects the union of committed candidate, staged, unstaged, and untracked TypeScript paths and normalizes their working bytes before validation."
  - "Canonical local check wrappers invoke authoring preparation first, while candidate freeze continues to preserve partial-stage bytes, concurrent edits, non-ordinary working paths, and external aliases."
  - "Git/TypeScript import fixtures are isolated from concurrent fast shards, Contract Freeze has one explicit bounded timeout, and source-text contracts are EOL-neutral."
  - "The implementation adds no dependency, Playwright execution, browser automation, C, Rust, FFI, Full, slow, or production sentinel run."
tests:
  - "bun test tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts tests/unit/install-git-hooks.test.ts tests/integration/project-runtime.test.ts --timeout 180000"
  - "bun test tests/unit/test-runner.test.ts tests/contract/contract-freeze.test.ts tests/contract/semantic-mutation-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=0c4f438f19bc0a0f3c785ae533a41568a0feb3b7 bun run imports:check"
  - "bun run docs:doctor"
  - "git diff --check"
---

# Imports Authoring Closure V1

现有 candidate freeze 已经正确地把完整 base→index TypeScript diff 规范化并原子发布，但 authoring 与 verification 之间仍缺一个明确的写入边界。开发中直接运行只读 `imports:check` 时，未规范化 import 会先被报告成 Gate 失败；而普通 changed-only selector 只读取 base→HEAD，又看不到尚未提交的 staged、unstaged 与 untracked TypeScript。结果是同一个机械问题反复在开发末尾暴露并打断验证。

本包不改变 import 排序规则、candidate selector、base identity、dependency generation 或 hosted Gate。新增 `imports:prepare` authoring 入口，使用同一个 TypeScript organizer，对 candidate base→HEAD、HEAD→index、index→working tree 与未跟踪 TypeScript 的稳定去重并集执行一次写入归一化。`check:affected`、`check:fast` 与 `check:full` 在类型和测试前调用该入口；CI 仍直接运行只读 `imports:check`，不会把 formatter 带入 hosted evidence。

由此正常路径固定为 `authoring delta → imports:prepare → type/test feedback → explicit stage → candidate index freeze → commit → read-only exact-head check`。Git hook 仍只改 index、从不改 working tree，partial-stage、并发修改和外部 alias 合同不变；开发命令也不再把可自动闭合的 import 排序当成第一次失败反馈。
