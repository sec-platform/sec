---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本计划依据外部长期 Goal authority `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`、`main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2`、open PR 为零、陈旧导航 Issue #132、最新 main Actions 仅有 lifecycle revalidation success，以及 `de5f84e693d2cae2ad502185dc86353813d62e4e` 的唯一 canonical affected FAIL 整体重算。实时 PR、Issue、CI、Review 与 exact evidence 事实只由 `docs/work/current-state.yaml` 拥有。

`de5f84e` 上 snapshot-cache batch 为 113 pass / 2 skip / 0 fail / 845 assertions，但 SM-3 dry-run/apply title 在 287236.36ms 返回 `SEMANTIC-MUTATION-010`，使目标文件成为 3 pass / 1 fail / 77 assertions，aggregate 以 exit code 1 终结。公开结果证明 isolated child 已形成完整、可解析且内部一致的 failed artifact set；它没有暴露具体 failed lane，且默认 cleanup 已删除原 workspace。该 Gate 身份永久为 FAIL，不得在同一 head 重跑、改名或与局部结果组合成 PASS，Risk 也不得在该 head 启动。

本窗口只保留一个 active package 与五个有界候选。候选顺序会在诊断取得真实 failed lane 后重新计算；若 repair 必须吸收 TEST-H2 delta，则合并候选而不是同时启动两个依赖未冻结的正式包。计划、branch、diagnostic 或候选证据都不证明能力进入 `main`。

```text
TEST-H3 isolated failed-lane attribution (active diagnostic)
└─→ proven failed-lane repair (conditional owner)
    └─→ TEST-H2 browser-cache closure replay or absorption
        └─→ SM-4A trusted authorization ingress replay
            └─→ SM-4A shared adapter + transport vertical
Nexus Phase 0A exact-tree census (read-only candidate; no second active package)
```

## 当前唯一 Work Package

### test-runtime-isolated-failure-attribution-v1

- 工程目标：仅在失败 title 的现有 `withTempWorkspace` 调用点，按 `SEC_RETAIN_SM3_FAILED_WORKSPACE=1` 选择既有 `retainOnCallbackFailure` 能力；共享 testkit helper 与 production runtime 保持 byte-identical。
- 影响边界：共享 `withTempWorkspace` helper 的 GitNexus 风险为 CRITICAL（69 direct / 74 upstream），明确禁止修改。允许变化只有单个 test call site、三控制面、canonical 路线/测试文档、manifest 与 path-free evidence。
- 唯一执行：冻结 diagnostic head 后运行一次 retained exact-title diagnostic。该结果无论 PASS、FAIL 或 UNKNOWN 都只是诊断证据，不补成 affected、Quick、Risk 或完成证明。
- 证据最小化：只读取已生成 artifact，不重新执行 child；记录 canonical status/failed lanes、runtime failed step、phase durations、child outcome/progress 分类、byte length 与 SHA-256。禁止写入绝对路径、raw logs、源字节、环境变量或 mutable workspace 内容。
- 清理与停止：必须证明 canonical temp root 下恰好一个 retained `sm3-*` workspace；证据独立校验后只删除该 literal path，并以 `Test-Path` 证明不存在。本包在首个真实 failed lane 分类并重算三控制面后停止，不修产品、不改 timeout、不跑 canonical affected/Risk、不 dispatch hosted CI、不开 PR。
- Stop condition：若 diagnostic 意外 PASS、未保留或保留多个 workspace、artifact 缺失/不可解析、与既有 failed envelope 矛盾，或只能靠泄露原始材料建立证据，则记录 UNKNOWN 并停止；同一 head 不运行第二次。

## 候选 Work Package

### 1. semantic-mutation-proven-failed-lane-repair-v1

- 状态：条件候选；具体 owner、owned paths、base 与 acceptance 必须由 TEST-H3 的真实 failed lane 决定，当前不得提前冻结或实现。
- 选择规则：fast lane 失败归 fast/selector owner；runtime step 失败归对应 runtime/verification owner；artifact/child-control 矛盾则回到 isolated process authority。禁止用 timeout 增大、重试、fixture 特判或弱化合同掩盖失败。
- 退出：最小 sentinel 证明根因修复；若修复必须与 TEST-H2 candidate 同树验证，则本候选吸收下一候选并形成一个 closure，不制造并行依赖包。

### 2. test-runtime-browser-cache-v10-closure-replay

- 状态：`de5f84e` 的 browser-cache/structural snapshot 实现与 focused evidence 可作 baseline，但其 canonical affected 身份为 FAIL，candidate 未进入 `main`。
- 下一步：只在 failed-lane repair 边界冻结后决定是独立 replay、被 repair 吸收，还是被新实现取代；从最终 base 重新生成 manifest、exact head 与 invalidation ledger。
- 退出：新冻结 head 上恰好一次 canonical affected PASS，之后才运行一次 canonical Risk 与被 diff 失效的静态/文档/ownership Gates；trust-root candidate 使用人工 bootstrap，不由 hosted candidate 自证。

### 3. sm4a-trusted-authorization-ingress-v1

- 状态：旧 candidate `bca9102` / base `8aa2d2d` 已暂停，不是 `main` 事实；其 focused baseline 只能按最终 diff impact 选择性复用。
- 依赖：TEST-H2 closure 进入新 `main` 后重放十路径产品/测试/文档 delta，重新冻结 base、v10 authority 与全部失效 evidence。
- 退出：trusted-local policy draft 只经现有 authorization revision 与 SM-2 registry authority 生成 canonical authorization；不接 transport、不修改 Mutation 合同。

### 4. sm4a-shared-adapter-and-transport-vertical-v1

- 产品结果：platform-owned adapter 统一 raw DTO validation、trusted policy、plan/apply/query/recover 与产品结果投影；CLI 与 Workbench 作为薄 transport shell 消费同一 contract。
- 依赖：trusted authorization ingress 已进入 `main`，shared adapter contract、loopback + strict Origin 或等价 capability boundary 均先冻结。
- 风险：禁止 wildcard CORS、第二 DTO/revision owner、path/source/stack 泄露，或提前展开 SM-4B/SM-4C。若 adapter 与 transport ownership 不能冻结为单一 closure，本候选在执行前拆分并只激活前半包。

### 5. nexus-phase-0a-exact-tree-census

- 产品结果：对绑定的 Nexus exact tree 形成全量 path/EPR/Skills 与机制决策 inventory，为后续吸收路线提供真实前置条件。
- 执行：只读采集可作为当前工程外的辅助；ledger 写入、owner 裁决与 SEC 路线重算仍由 A0 串行，不能成为第二 active package。
- 退出：unclassified/undecided 为零且 manifest digest 确定；这只证明 census 完成，不宣称 parity、absorption 或 retirement 完成。

## 单写者、证据与重算

- 正式 active package 始终只有一个；failed lane、runtime dependency、CI revision、authorization、adapter 与 transport boundary 按 DAG 串行冻结。
- 每个 Gate 只有一个 `gate_owner`；相同 `gate_key + tested head + profile` 的有效结果必须复用。失败 aggregate、污染 diagnostic 与成功 sub-batch 均不得改名为 closure PASS。
- Merge/close、相关 `main` 变化、新 CI/Review blocker、architecture 反证、candidate 被替代、Nexus 新前置或 Goal revision 变化后整体重算，并删除或合并失效候选，不维护无限增长 Backlog。
