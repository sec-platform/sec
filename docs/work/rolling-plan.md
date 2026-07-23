---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本窗口依据已全文读取的两份 `docs/goals/*.md` 长期 Goal revision `sha256:fbe08bd8dd24224b873619fa48746778eeb4357ddb5cd917d6ee45e45134f86d`、`main@8aa2d2d`、Draft PR #137、陈旧导航 Issue #132、无 Review/REQUEST_CHANGES，以及 `ec97412 + quick + affected-tests` 新失败整体重算。实时 SHA、CI、Review和Evidence事实只由 `docs/work/current-state.yaml` 拥有；本文件只规划一个 active package与四个候选。

```text
TEST-H4 retained artifact-read attribution (active)
└─→ TEST-H5 proven-owner repair + V10 landing closure
    └─→ SM-4A trusted authorization ingress replay
        └─→ SM-4A shared adapter + CLI/Workbench transport vertical

Nexus Phase 0A exact-tree census (read-only auxiliary candidate)
```

## 当前唯一 Work Package

### test-runtime-artifact-read-attribution-v1

- 产品结果：不猜测、不重跑aggregate，只保留一次当前 exact title 的失败现场，识别 `artifact-read` 前的实际 child outcome、progress、termination和artifact存在性，让下一包只修改真实owner。
- 触发根因：V3 已修复并focused证明旧 `cmd.exe` acceptance缺口，但新 canonical affected仍在 `ec97412` 以3 pass / 1 fail结束；失败title于254788.32ms返回blocked `SEMANTIC-MUTATION-010`，公开面只剩`artifact-read` stage，默认cleanup已删除根因证据。
- Owner：仅失败title调用点按显式环境变量选择现有retention；共享testkit、production child/orchestrator/runtime-plan/process、fixture、timeout和artifact schema全部冻结。GitNexus对测试文件为LOW，shared helper保持CRITICAL forbidden。
- 风险：诊断本身约占现有300秒budget；可能意外PASS、再次timeout或仍缺少足够artifact。任何一种结果都消费这唯一diagnostic identity并停止，不做第二次。
- 退出：新diagnostic head恰好运行一次exact title；只保存revision-bound、path-free最小证据；独立校验后只删除唯一literal retained workspace并证明零残留；随后按实际失败owner重算TEST-H5。
- 禁止：本包不实现repair、不运行affected/Risk/hosted verification、不把diagnostic与`ec97412`成功sub-batches拼成PASS、不把PR #137转Ready或合并。

## 候选 Work Package

### 1. test-runtime-artifact-read-root-cause-fix-v1

- 产品结果：吸收PR #137完整V3 delta，只修复TEST-H4证明的唯一artifact/child生命周期owner，并在新exact head闭合V10 runtime prerequisite。
- 依赖：TEST-H4 evidence和retained workspace cleanup均完成；未得到唯一owner时不得激活。
- Owner/风险：owner在诊断前保持UNKNOWN。修复包必须重新运行GitNexus impact；若根因跨child、supervisor、filesystem或runtime authority，只选一个canonical writer，禁止并行修改竞争定义。
- 退出：focused fault/negative fixture证明同一artifact predicate；新head恰好一次canonical affected PASS后才允许一次Risk；静态Gate、独立Review和manual trust-root bootstrap满足后及时merge。
- 重算：诊断意外PASS、timeout、evidence矛盾、需要扩大公共schema或 weakening artifact binding时整体重算，不把“多跑一次”当repair。

### 2. sm4a-trusted-authorization-ingress-v1

- 产品结果：从TEST-H5合并后的新`main`重放suspended十路径delta，只建立trusted local policy到现有canonical authorization builder的ingress。
- 依赖：V10 runtime prerequisite真实进入`main`；旧`bca9102`只是branch baseline，不是完成事实。
- Owner/风险：authorization revision、SM-1 request/plan/result与SM-2 source resolver保持单写者；不得接transport、Task Envelope v2或AI Operator。
- 退出：新base/head和失效Gate全部重冻；focused、affected、必要Risk、Review与merge closure完成。

### 3. sm4a-shared-adapter-and-transport-vertical-v1

- 产品结果：一个platform-owned adapter统一raw DTO validation、trusted policy、plan/apply/query/recover和产品结果投影；CLI与Workbench保持薄transport shell。
- 依赖：trusted authorization ingress进入`main`；loopback/strict Origin或等价capability boundary先冻结。
- 风险：wildcard CORS、第二DTO/revision owner、path/source/stack泄漏、第二Mutation/Pipeline authority。
- 退出：CLI与Workbench对同一输入得到相同canonical binding；真实`add-state-transition` vertical可见且legacy mutation入口有明确退役路径。若无法形成有限闭包，激活前拆成单一adapter包并重算。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：对绑定Nexus exact tree完成tracked path、entrypoint、authority/public surface、EPR 29/29、Skills与mechanism decision inventory。
- 执行：只读采集可作为辅助；ledger写入、机制裁决与SEC owner映射仍由A0串行，不能成为第二active package。
- 退出：unclassified/undecided为零且digest确定；只证明Census，不宣称parity、absorption或retirement。

## 单写者、证据与重算

- 正式active package始终只有一个；候选不能提前修改canonical surface。
- `de5f84e + quick + affected`与`ec97412 + quick + affected`分别永久为FAIL；两者Risk均未运行。任何成功sub-batch和TEST-H4 diagnostic都不能组合成aggregate PASS。
- 每个Gate只有一个`gate_owner`。TEST-H4只授权一次diagnostic，不是Gate补跑；TEST-H5必须在新冻结head重新执行一次完整affected。
- merge/close、相关main变化、新CI/Review blocker、架构反证、candidate被替代、Nexus新前置或Goal revision变化后整体重算，删除或归档失效计划。
