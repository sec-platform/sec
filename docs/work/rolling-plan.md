---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本计划依据 `main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2`、open PR 为零、陈旧导航 Issue #132、SM-4A candidate `bca9102` 的 exact local evidence、canonical affected 的缺 cache失败与受扫描污染timeout、以及 hosted Ubuntu workflow缺少canonical cache materialization 的新事实整体重算。TEST-H1 已由 `main` 证明完成；SM-4A ingress与本 prerequisite 均未进入 `main`，不能计为产品完成。实时PR、CI与Review事实只由 `docs/work/current-state.yaml` 拥有。

本窗口只保留一个 active package 与五个有界候选。它不取代路线图、Engineering IR或测试authority，也不把计划、branch或单次诊断当成完成证据。

```text
TEST-H2 runtime browser cache V10 bootstrap (active prerequisite)
└─→ SM-4A trusted authorization ingress replay
    └─→ SM-4A shared product adapter
        └─→ SM-4A CLI + Workbench transport vertical
            └─→ Blockless Semantic Source Ownership
Nexus Phase 0A exact-tree census (read-only candidate; no second active package)
```

## 当前唯一 Work Package

### test-runtime-browser-cache-v10-bootstrap-v1

- 工程结果：project-runtime实际执行并冻结同一个external Node 22+ path/version authority，再由该Node调用project-local Playwright registry选择canonical expected executable；registry/runtime failure fatal，只有成功选择但physical executable缺失才安装。Doctor、`ensureTestDependencies()`、direct preload与non-isolated runtime verification复用该owner。
- 根因：Bun安装不执行Playwright lifecycle，canonical runtime又拒绝global/default cache；Windows exact probe证明Bun 1.3.14网络兼容层不能执行Playwright下载，而同机Node可达。初版只扫描PATH文件且用`executablePathOrDie()`，会把不兼容/poisoned Node或registry failure误分类为cold miss；后续复审又证明缺失leaf会绕过既存`.shared-deps`/cache中间junction并把lock/download写出worktree。当前修正实际执行external Node、区分fatal registry与cold，并在lock前、lock内及真实spawn前逐段复核physical containment。
- Canonical seam：`project-runtime.ts`独占dependency path、external Node selection/validation、browser-specific lock、CLI/registry调用与失败语义；`dependency-environment.ts`只向下消费同一Node authority，不能反向成为resolver owner；test runner只消费组合入口并覆盖每个child的cache/preload环境，isolated capability probe继续只读fail closed。
- 风险：`project-runtime.ts`文件级HIGH（10 direct/118 upstream），runtime verification文件级HIGH（4 direct/109 upstream），`getDoctorReport`为LOW；`withTestDependencies`与`pathEnv`仍为HIGH，`isolatedPlaywrightBrowsersPath`为CRITICAL但只把无参分支委托现有authority。`ensureCompilerDepsReady`、HIGH `executableCheck()`与CRITICAL `withInstallLock`均禁止修改；任何selector/timeout/Gate order、Mutation或runtime proof变化立即停止。
- 信任：本包修改verifier trust root，V1 revision/artifact推进到v10，使用旧base本地exact evidence与双审查人工bootstrap；候选不dispatch hosted Scope/Quick/Full/release。
- 退出：真实external Node、PATH/same-node/missing/incompatible/Bun/non-Node/non-executable/fatal-registry、physical ancestor/cold path、cold/warm/concurrent/failure-retry、doctor消费、direct/pre-fanout与runtime delegation合同，以及v10 identity与canonical affected在单一exact head满足；tracked diff不包含cache或临时产物。当前direct/preload 34/34（137 assertions）、managed runner 21/21与v10 policy 69/69只绑定未提交树，仍须冻结单一candidate并运行exact-head Gate。

## 候选 Work Package

### 1. sm4a-trusted-authorization-ingress-v1

- 状态：`bca9102` / base `8aa2d2d` 已冻结并暂停；不是`main`事实。
- 下一步：TEST-H2合并后从新`main`重放十路径产品/测试/文档delta，重新冻结base、v10 manifest与全部失效evidence；旧失败aggregate、污染sentinel与v9证据不改名复用。
- 退出：trusted-local policy draft只经现有authorization revision与SM-2 registry authority生成canonical authorization；不接transport或修改Mutation合同。

### 2. sm4a-shared-product-adapter-v1

- 产品结果：一个platform-owned adapter统一raw DTO validation、trusted policy、plan/apply/query/recover调用与产品结果投影。
- 依赖：trusted authorization ingress先进入`main`；request/plan/result、source resolver、Verification、lease与journal保持既有owner。
- 退出：同一workspace/request/policy生成稳定binding；plan无写入，apply强制expected plan，四类terminal lifecycle可区分。

### 3. sm4a-cli-workbench-transport-vertical-v1

- 产品结果：CLI与Workbench State View/API作为薄transport shell消费同一个shared adapter，闭合真实`add-state-transition` vertical。
- 依赖：shared adapter contract已冻结；HTTP mutating boundary先冻结loopback + strict Origin或等价capability。
- 风险：禁止wildcard CORS、path/source/stack泄露、第二DTO/revision owner或提前实现SM-4B/SM-4C。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：对已绑定Nexus tree形成全量path/EPR/Skills与机制决策inventory。
- 执行：只读采集可辅助；ledger写入、owner裁决与路线重算仍由A0串行，不能成为第二active package。
- 退出：unclassified/undecided为零且manifest digest确定；仍不宣称Parity或Retirement完成。

### 5. blockless-semantic-source-ownership-v1

- 产品结果：App/source-module-owned Semantic Contract不依赖Block许可证进入Frontend → IR → Projection，并保持唯一writable owner。
- 依赖：SM-4A真实consumer进入`main`后冻结migration contract。
- 风险：禁止loader临时union、第二identity authority、破坏CAS/Registry provenance或让unlisted mirror获得authority。

## 单写者、证据与重算

- 正式active package始终只有一个；runtime dependency、CI revision、authorization、source owner、adapter与transport boundary按DAG串行冻结。
- 每个Gate只有一个`gate_owner`；相同`gate_key + tested head + profile`的有效结果必须复用，失败aggregate不由精确重跑改名。
- Merge/close、相关`main`变化、新CI/Review blocker、architecture反证、candidate被替代、Nexus新前置或Goal变化后整体重算，并删除失效候选而非增长永久Backlog。
