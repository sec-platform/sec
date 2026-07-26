# SEC Codex 工程治理

本文件是仓库级 Agent operating contract 的短投影。文档权威图见 `docs/00-文档索引与一致性规则.md`，稳定阶段 DAG 与完成定义见 `docs/03-MVP实施计划与路线图.md`，完整执行协议见 `docs/04-AI自主实现执行蓝图.md`，Engineering IR 见 `docs/14-Engineering IR与语义事实规范.md`，测试/CI/Gate 见 `docs/test-feedback-and-ci-lanes.md`。

## 启动与事实

- `main` 是唯一正式工程事实；branch、PR、Issue、报告、计划、聊天和代码图只提供线索。
- 新 Work Package 开始时执行一次 `bun scripts/codex/document-control-plane.ts status --json`。只有 live remote/default-ref、GitHub PR/Issue/CI/Review 与 active pointer 全部解析成功的输出才是 current-state；`unresolved` 或 `invalid` 必须 fail closed。有效 Capsule 内禁止用重复 status/list/read/wait 轮询不变事实。
- 仅在 base/authority/contract/ownership 变化、命中 `reload_if`、证据冲突或最终收口时完整重载；普通 Task Envelope 只读取标记失效项与 Reconciliation Delta。三个 `docs/work` 控制面也只在新 Work Package、真实 `reload_if` 与最终 reconciliation 更新。
- Squash merge 后按最终 tree、代码和 diff 判断能力是否进入 `main`，不得用原 commit ancestry 误判遗漏。

## A0、Worker 与单写者

- Root 是 A0 Integrator，独占 DAG、Task ownership、integration、Gate custody、merge、closeout 与 branch hygiene。
- 一个时刻只有一个 formal active Work Package和一个 candidate epoch；每个 owned seam/角色最多一个 live agent。并行前必须冻结 branch、owned/forbidden paths、prerequisite、acceptance、tests、`gate_owner`、reconciliation point、stop 与 `reload_if`；同一 canonical type、revision、builder、pipeline order 或 authority 章节保持单写者。本地 owned seam未耗尽前不得轮询 Agent。
- Delegation depth 保持 1；普通 worker 不再递归分派。角色按需从 `.codex/agents/` 选择。
- Worker 流程固定为：

```text
inspect → implement → focused validation → explicit-path stage
→ pre-commit imports:freeze → commit → Draft PR/update → Reconciliation Delta → stop
```

- Worker 默认 `DO NOT MERGE`，不得添加 `run-quick` / `run-full` label、越界修改、顺手全仓重构、删除测试或弱化合同。
- Reconciliation Delta 必须返回 tested head/base、changed files/symbols、authority/acceptance delta、focused results、reusable/invalidated evidence、blocker、next ready seam，以及时间、`context_reload_count`、`duplicate_gate_count`、`tool_call_count`、`agent_spawn_count`、`agent_wait_timeout_count`、`context_compaction_count` 与 `candidate_invalidation_count`；不得另建叙述性进度文档。

## 影响、写边界与验证

- 修改共享函数、公共类型、authority seam或未知影响实现前运行 GitNexus upstream impact；已证明为局部叶节点且 Capsule 内 impact未失效时复用结果。HIGH/CRITICAL 先向用户报告。索引刷新只能使用 `--index-only`，不得让外部工具改写 AGENTS、Skills 或 authority docs。
- Commit 前运行 GitNexus `detect_changes({scope:"compare", base_ref:"main"})`，再以 current source、exact diff、compiler 和适用测试裁决真实影响。
- `pre-commit imports:freeze` 与 pre-push 共用唯一 organizer；选择范围始终是完整 base→candidate index TypeScript diff。Hook 只原子更新 index，不改 working tree；hosted `imports:check` 仍只读 fail closed。
- 每个 Gate 只有一个 `gate_owner`；以 `gate_key + tested head + profile` 唯一标识并复用未失效证据。失败后读取具体 failure tail，修根因，只重跑被 delta 失效的最小 sentinel。同一 Work Package 第二次 candidate invalidation后必须回到 failing repro、owner与 invariant并返回 `STOP_PROOF_RESET`，不得继续昂贵 Gate。
- 长时命令或可能等待 approval的命令必须独立调用并由唯一 supervisor收口；不得放进 `Promise.all`、复合 shell或主动轮询循环。
- 按风险从下列入口选择最小集合，不机械全跑：

```text
bun run typecheck
bun run docs:doctor
SEC_IMPORTS_CHANGED_ONLY=1 + SEC_CHANGED_BASE=<base> + bun run imports:check
bun test <focused tests> --timeout 180000
bun run reference:check
```

## 文档、Merge 与清理

- 活跃工程文档使用中文；一个主题只有一个 canonical owner，其他文档只链接。动态事实只进入三个 `docs/work` 控制面，历史证据进入 `docs/evidence` 或 `docs/archive`。
- 只有能力仍有效、authority 一致、required evidence 满足、head/base 清楚、无 unresolved thread/`REQUEST_CHANGES`、无 probe 或 artifact drift 时才能 merge。
- Verifier trust-root 变化必须按当前 CI 合同人工 bootstrap，不能由 candidate 自证；门禁满足后及时合并。
- 合并后确认结果真实进入新 `main`，准确关闭 absorbed/superseded PR/Issue，删除完成使命且已证明无独有内容的远端/本地 branch 与 worktree，再从新事实整体重算。
