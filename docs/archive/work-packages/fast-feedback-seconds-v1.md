---
schema: codex-development-work-package-v1
id: fast-feedback-seconds-v1
tracking: issue-132
base: 3e476db3f73b012266925be3c6b27499ec3547f8
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v12
tasks:
  - id: freeze-development-speed-contract-and-correct-runtime-test-lane
    owner: a0
    ownedPaths:
      - AGENTS.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/fast-feedback-seconds-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - tests/contract/docs-doctor.test.ts
      - tests/contract/test-architecture.test.ts
      - tests/e2e/runtime-host.test.ts
      - tests/integration/project-runtime.test.ts
forbiddenPaths:
  - .codex/
  - .github/
  - .githooks/
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/archive/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - package.json
  - platform/
  - scripts/
  - tests/fixtures/
  - tests/unit/
acceptance:
  - "AGENTS、执行蓝图、测试反馈权威与测试架构共同固化开发环节取舍、十步最短完整流程、失败处理、按变化类型选择的最小验证矩阵、Agent/控制面/Gate/candidate/时间占比硬指标；聊天与历史审计不再是这些规则的唯一载体。"
  - "仓库短投影删除当前不可调用的 GitNexus detect_changes 必经步骤；GitNexus只在共享/public/authority或未知影响 seam前按条件运行，final exact diff是提交前的本地影响事实。"
  - "默认单一纵向切片使用零个子 Agent；只有至少两个依赖已满足、owned/forbidden paths完全不重叠且可独立提交的 write seam才允许并行，禁止主动 polling并以wait timeout为零。"
  - "正常 Work Package控制面只在开包和最终收口各更新一轮；同一 exact head/profile Gate最多一次、正式candidate同时最多一个、第二次candidate invalidation强制proof reset，长命令保持独立调用。"
  - "产品实现占主动工作时间目标至少70%，协调、叙述文档和控制面合计低于15%；指标用于暴露流程浪费，不得删测试或跳过必需证据来伪造达标。"
  - "真实 Next build、server lifecycle与Playwright acceptance从fast integration文件迁入已有e2e runtime-host slow suite；测试不删除、不降级，Contract Freeze继续覆盖快速repository runtime合同而不启动Next。"
  - "测试架构合同阻止生产Runtime/浏览器acceptance重新进入fast test inventory，并证明runtime-host仍由现有slow registry拥有。"
  - "warmed tests/integration/project-runtime.test.ts在当前开发机目标十秒内完成；真实runtime-host acceptance只运行一次并证明server cleanup。"
tests:
  - "workflow-and-layer-contract: bun test tests/contract/docs-doctor.test.ts tests/contract/test-architecture.test.ts --timeout 180000"
  - "fast-runtime-contract: bun test tests/integration/project-runtime.test.ts --timeout 180000"
  - "slow-runtime-acceptance: bun test tests/e2e/runtime-host.test.ts --timeout 180000 exactly once after the fast contract passes"
  - "typecheck: bun run typecheck once after TypeScript stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=3e476db3f73b012266925be3c6b27499ec3547f8 with bun run imports:check once on the frozen candidate"
  - "docs-doctor: bun run docs:doctor once because active authority changes"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check 3e476db3f73b012266925be3c6b27499ec3547f8 HEAD --"
---

# 秒级反馈与开发流程固化

## 唯一结果

把三天吞吐审计已经证明的流程取舍写入 canonical operating contract，并修正一个会让 fast/Contract Freeze无条件启动真实 Next与Playwright的测试分层错误。此次不新增 Gate、selector、suite registry、runner、第二文档 owner或产品语义。

```text
一次 live reload
→ owner + invariant + failing/slow reproduction
→ 一个纵向切片
→ focused fast sentinel
→ 条件化最终本地检查
→ 单一 frozen candidate
→ exact diff / ownership / architecture review
→ hosted Quick与其selected Risk各最多一次
→ merge readback
→ 一次 branch/worktree cleanup
```

## Context Capsule

- Branch：`codex/fast-feedback-seconds-v1`
- Base：`main@3e476db3f73b012266925be3c6b27499ec3547f8`
- Goal：`sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`
- Proof：`tests/integration/project-runtime.test.ts`中的真实 Next/Playwright acceptance约占31.7秒，整个文件约38.3秒，并经 Contract Freeze进入约48.5秒风险闭包；同一runtime-host风险已有e2e slow suite owner。
- Authority：流程完整语义由`docs/04-AI自主实现执行蓝图.md`拥有，测试/Gate选择由`docs/test-feedback-and-ci-lanes.md`拥有，test layer由`docs/test-architecture.md`拥有，`AGENTS.md`只投影高频硬约束。
- Gate owner：A0；本包默认零子 Agent，不运行local Risk或Full。
- Candidate epoch：1；只允许一次失败delta修复后的refreeze，第二次失效返回`STOP_PROOF_RESET`。
- Reconciliation point：文档合同、fast runtime与slow runtime acceptance均有精确证据后冻结一次候选。

## Reload if

- live `origin/main`不再是`3e476db3f73b012266925be3c6b27499ec3547f8`。
- Goal revision、CI V12 revision、test budget/impact owner或Contract Freeze owner变化。
- 需要修改任一forbidden path，或需要新增suite registry/runner/selector。
- PR head/base/state、CI、Review、unresolved thread或`REQUEST_CHANGES`变化。

## Stop

- e2e runtime-host不能承接原有Next/Playwright acceptance且保持cleanup不变量。
- fast文件仍启动Next、Playwright、production server或浏览器。
- 同一candidate epoch发生第二次失效。
- exact-head Review或required hosted verification拒绝候选。
