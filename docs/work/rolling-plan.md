---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本窗口依据已全文读取的长期 Goal revision `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`、`main@8aa2d2d`、Draft PR #137、陈旧导航 Issue #132、candidate Draft lifecycle revalidation，以及 TEST-H3 的 path-free runtime-acceptance failure attribution重算。实时 SHA、CI、Review 和 evidence 事实只由 `docs/work/current-state.yaml` 拥有；本文件只规划一个 active package 与四个候选。

```text
TEST-H2 V3 browser-cache + acceptance shell closure (active)
└─→ SM-4A trusted authorization ingress replay
    └─→ SM-4A shared adapter + CLI/Workbench transport vertical
        └─→ Blockless Semantic Source Ownership

Nexus Phase 0A exact-tree census (read-only auxiliary candidate)
```

## 当前唯一 Work Package

### test-runtime-browser-cache-v10-bootstrap-v3

- 产品结果：保留 V2 的 canonical Playwright cache 与 structural snapshot 优化，同时让 isolated runtime acceptance 在不恢复 ambient PATH 的前提下完成 Playwright shell → Bun → project-local Next → URL → teardown。
- 根因：generic isolated direct-module 环境正确使用空 PATH；Playwright webServer 固定 `shell:true`，Windows cleanup 又解析裸 `taskkill`。TEST-H3 已证明 build/unit PASS、acceptance 因 `ENOENT / uv_spawn / cmd.exe` 失败。原拟命令还遗漏 nested Bun 的 fixed config，会重新读取可被 override 的项目 bunfig。
- Owner：通用 empty-PATH owner `buildIsolatedProcessEnvironment()` 保持不变；`run-runtime-verification.ts` 新窄 helper只拥有 acceptance shell launch；`ensureProjectBase()` 只拥有一个 generated webServer command；Next module identity仍归现有 invocation contract。
- 风险：generic environment 是 CRITICAL forbidden owner；`ensureProjectBase` production graph 为 HIGH，含测试消费者时 40 impacted / 4 direct / 4 processes。禁止修改 process/Observed Process/AppContainer/override/invocation-contract owners，禁止 shared → compiler 反向依赖。
- 退出：POSIX PATH 仅含 Bun 物理目录；Windows PATH 固定 System32→Bun、ComSpec/cmd、PATHEXT `.EXE`、taskkill与 Bun identity均先验证。isolated webServer 从 generated project cwd 解析 fixed config，项目 bunfig poison不能接管。新 focused sentinel证明真实 Next/Playwright/URL/teardown；诊断 retention selector撤销；新 frozen head恰好一次 affected PASS后才允许一次 Risk。
- 验证：Draft PR #137只产生预期的plan revalidation与Draft merge-status failure，不是candidate Gate证据。继续按manifest完成 shell owner、真实sentinel、browser-cache delta、v10 policy、affected、Risk、typecheck、changed-only imports、depcruise、docs、scope、diff和GitNexus Gate；candidate trust-root不 dispatch hosted verification，自主证明后走manual bootstrap。
- 重算：任何 shell authority泄漏、fixed config/cwd containment失效、需要扩大 competing owner、真实 teardown失败、affected失败、新 CI/Review blocker或 `main` 变化都会停止当前包并整体重算。

## 候选 Work Package

### 1. sm4a-trusted-authorization-ingress-v1

- 产品结果：把 suspended candidate 的十路径 delta 重放到 V3 合并后的新 `main`，只建立 trusted local policy → 现有 canonical authorization builder 的 ingress。
- 依赖：V3 进入 `main`；旧 `bca9102` 仅是 branch evidence，不是完成事实。
- Owner/风险：现有 authorization revision、SM-1 request/plan/result 与 SM-2 source resolver保持单写者；不得接 transport、Task Envelope v2 或 AI Operator。
- 退出：新 base/head、v10 manifest和失效 Gate全部重冻；focused、affected、必要 Risk、Review与 merge closure完成。

### 2. sm4a-shared-adapter-and-transport-vertical-v1

- 产品结果：一个 platform-owned adapter统一 raw DTO validation、trusted policy、plan/apply/query/recover和产品结果投影；CLI与Workbench只是薄 transport shell。
- 依赖：trusted authorization ingress进入 `main`；loopback/strict Origin或等价 capability boundary先冻结。
- 风险：wildcard CORS、第二 DTO/revision owner、path/source/stack泄漏、第二 Mutation/Pipeline authority。
- 退出：CLI与Workbench对同一输入得到相同 canonical binding；真实 `add-state-transition` vertical可见且 legacy mutation入口有明确退役路径。若 adapter与transport无法形成一个有限闭包，执行前只激活adapter半包并重算。

### 3. blockless-semantic-source-ownership-v1

- 产品结果：application/source-module/import-session owned semantics不再把 Block当存在许可证，同时保持 stable Entity/Fact identity与唯一 writable owner。
- 依赖：SM-4A产品闭环进入 `main`，提供真实 consumer和迁移证据。
- 风险：旧 `blockId` 与新 owner双写 identity/revision，Registry mirror越权，CAS/provenance漂移。
- 退出：Block兼容保持；非 Block owner可进入 Frontend→IR→Projection→Mutation；旧 Block前置被迁移而非并存。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：对绑定的 Nexus exact tree完成 tracked path、entrypoint、authority/public surface、EPR 29/29、Skills与mechanism decision inventory。
- 执行：只读采集可作为辅助；ledger写入、机制裁决与SEC owner映射仍由A0串行，不能成为第二 active package。
- 退出：unclassified/undecided为零且digest确定；只证明Census，不宣称parity、absorption或retirement。

## 单写者、证据与重算

- 正式 active package 始终只有一个；候选不能提前修改 canonical surface。
- 每个 Gate只有一个 `gate_owner`。`de5f84e + quick + affected` 永久为 FAIL，Risk未运行；成功 sub-batches不能组合成PASS。
- focused真实sentinel与affected对同一changed test的再次选择是不同 Gate责任的明确 overlap；不得再运行旧 TEST-H3 exact title或重复相同 Gate identity。
- merge/close、相关 main变化、新CI/Review blocker、架构反证、candidate被替代、Nexus新前置或Goal revision变化后整体重算，删除或合并失效候选。
