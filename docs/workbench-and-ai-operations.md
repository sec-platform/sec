---
title: Workbench 与 AI 操作边界
status: stable
domain: workbench-ai
last-reviewed: 2026-07-29
---

# Workbench 与 AI 操作边界

本文拥有 Workbench、Semantic View、Context Packet、Task Envelope、产品 transport 和 AI bounded operator 的稳定职责。Canonical IR、Mutation transaction、Impact 和 Verification result 仍由各自领域唯一拥有。

## 权力关系

```text
Platform owns canonical state and policy
→ selects a task or accepts a user intent
→ projects bounded context
→ grants operation and physical limits
→ human/AI submits a proposal
→ platform plans without live writes
→ compiler rebuilds canonical state
→ verification accepts or rejects
→ product renders the result
```

AI、用户界面和外部 Provider 都不是 authority。AI confidence、模型能力、Provider related files、Context Packet 内容和用户在画布上的拖拽都不能扩大 operation、path、Effect、owner 或 Verification 权限。

## Workbench 产品职责

Workbench 是本地理解、Review、影响预览、决策和受控操作面。它不是普通 IDE、低代码私有运行时、第二个编译器或可任意写文件的本地 Web 服务。

用户面对同一个工程语义空间。Architecture、Scenario、Data、State、Contract、Effect/Permission/Trust、Impact 与 Evidence 只是不同 projection：

- **Architecture**：Responsibility、Boundary、Contract、Port 和关键 Effect；
- **Scenario**：围绕 Entry/Operation/Event/Acceptance 的局部因果链；
- **Data**：值从来源、验证、转换、序列化到 sink 的路径；
- **State**：Owner、Reader、Writer、Mutation、Lifetime、Transition、Concurrency 与 Escape；
- **Contract**：input、pre/postcondition、output、error、Effect、idempotency 与 lifecycle；
- **Effect / Permission / Trust**：Filesystem、DB、Network、Process、Secret、Clock、Random 和外部边界；
- **Impact**：canonical Delta、direct/transitive impact、unknown frontier 和 Verification recommendation；
- **Evidence**：authority、provenance、coverage、freshness、competing explanation 与适用范围。

UI 可以过滤、聚合、布局、标注和折叠，但每个可审查判断必须保留 Entity/Fact/Assertion/Evidence/Artifact reference。布局、颜色、badge 和临时选择不能反向进入 canonical IR。

## 统一 Inspector

不同 View 应共享稳定的信息分组，而不是为每种节点发明不兼容详情页：identity、role、contract、owned state、data、effects、errors、lifecycle、concurrency、permissions、relations、provenance、evidence 和 source/artifact binding。

Inspector 必须区分：

- authoritative / derived / observed / inferred；
- implemented / planned / unsupported；
- current / stale / invalidated Evidence；
- generated / governed / opaque / unknown source；
- proposal / planned / applied / verified / rolled-back / recovery-required。

空字段不能被 UI 默认值伪装为已知。

## 操作生命周期

所有写操作固定经过同一生命周期：

```text
intent / UI action / AI proposal
→ raw DTO validation and local trust checks
→ canonical authorization ingress
→ plan or dry-run without live writes
→ render owner, expected change, risk, Impact and Verification
→ apply with expected plan revision
→ accepted | rejected | rolled-back | recovery-required
→ reload projections from accepted canonical revision
```

Workbench 不直接写 `project/**`、`control/**`、IR JSON、journal 或 runtime Evidence。它也不能在 blocked plan 上隐藏诊断后重新标记为 ready。

CLI、Workbench 和未来 AI caller 必须消费同一个 platform-owned product adapter 和 Semantic Mutation public facade：

```text
transport DTO → trusted product policy draft
→ canonical authorization / plan / apply / query / recover
→ stable product result projection
```

Transport 可以拥有协议解码、local trust boundary、输入格式、错误脱敏和响应 shape；它不拥有 source owner、allowed canonical path、risk、actual Delta、Impact、minimum Verification、rollback 或 terminal state。

## Semantic View 与兼容投影

Semantic View 是从 validated state 构建的只读产品合同。现有 ExplainGraph、ReviewSummary、Source View 或 legacy governance tabs 可以作为兼容投影保留，但必须明确：

- 它们不等于 canonical semantic graph；
- 旧 View Mutation 不能因名称相近获得 Semantic Mutation 权限；
- consumer 完成迁移后，旧旁路必须退役；
- 同一事实在多个视图中只能保留 reference，不复制 authority 字段和裁决算法。

## Context Packet

Context Packet 是某个任务的最小充分、只读、revision-bound 投影，不是缓存整个仓库。它至少应能引用：

- task、target 和 authorization；
- relevant Entity/Fact/Scenario/Contract；
- writable 与 readonly anchors；
- must-preserve、forbidden Effects 和 unresolved frontier；
- Impact、Verification、Provenance 与 runtime Evidence；
- 必要类型签名、tests 和源码骨架。

装载顺序从结构化语义到必要源码逐层下钻。只有当前结构化信息无法回答任务，并且新的读取仍在 scope 和隐私边界内时，才扩大 source context。Source range 必须从 target、owner、required symbols、Verification 和 Impact 推导；不能默认整仓扫描或把搜索结果加入 writable set。

Context Packet 绑定 canonical revisions、source revisions、Provider freshness 和 policy revision。任一关键输入变化时必须 invalidated 或重新投影，不能在新 workspace 状态上复用旧上下文。

## Task Envelope 与 AI

Task Envelope 描述平台授予的一次 bounded operation，至少约束：task kind、phase、semantic target、allowed operations、physical path上限、forbidden Effects、required/must-preserve Facts、Verification minimum、budget 和 expected output。

当前实现若只支持 Slot synthesis，就只能声明 bounded code filler；完整 Task Envelope / AI Semantic Operator 在类型、builder、validator、revision、contract tests 和 product ingress 落地前只是目标架构。

AI 输出默认是 source-patch、semantic-mutation、repair-proposal 或 review-decision proposal。AI 不能提交或伪造：

- canonical Fact Delta、Impact 或 Verification result；
- source owner、实际 path resolution 或 authorization revision；
- risk、required passes、rollback hint 或 terminal status；
- control artifacts、IR、Evidence ledger 或 release receipt；
- 更宽的 path、Effect、budget 或更低的 must-preserve/Verification。

需要扩权时生成新的 Task/Decision，由平台或人显式批准；失败不能自动从局部任务升级为整仓重写。

## Budget 与停止

Task budget 至少限制 attempts、wall time、token、tool/IO 和输出。预算耗尽、Provider stale、source drift、plan revision mismatch、permission conflict 或 repeated failure 都必须停止当前 proposal；不能通过增加重试、删除断言或放宽路径继续。

AI 自然语言推理不是 SEC 必需的审计记录。平台需要的是 task/model identity、context digest、authorization、proposal digest、plan/result revisions、actual source/Fact delta、Verification Evidence、terminal state 与拒绝原因。

## Local HTTP 与进程边界

“本地产品”不等于任意网页、局域网主机或 DNS rebinding 可以调用。所有 mutating routes 必须：

- 只绑定 loopback，并严格验证 Host/Origin；或使用进程生命周期内不可预测 capability，同时仍限制 bind/Host；
- 在读取 workspace 内容、构造 plan 或返回路径前拒绝跨站、错误 capability 和非本地请求；
- 禁止 wildcard CORS；
- 不在日志、URL、持久 artifact 或错误中泄露 capability、secret、source bytes、绝对路径、journal payload 或 stack；
- 区分 plan、apply、query 和 recover，apply 必须绑定 expected plan revision；
- accepted 后只重新读取 canonical projection，不调用第二条 compile/write 路径。

普通 loopback、临时目录和输入 validation 不构成执行不受信代码的安全 sandbox。

## 多用户、并发与 freshness

Workbench 可以有多个只读消费者，但一个 workspace write transition 仍由唯一 lease/transaction owner 串行。多个窗口或 Agent 基于同一旧 revision 计划时，只有首个满足 CAS 的 transition 可以发布；其他 proposal 必须重新 plan，不自动 merge canonical operations。

长查询、Provider analysis 和 runtime Evidence 可以异步产生，但不得在 source/canonical revision 改变后静默附加为当前结果。UI 必须显示 freshness、coverage、pending/failed 状态和 last valid revision。

## 产品验收

Workbench/AI 操作面达到真实闭环至少需要：

1. 同一 canonical state 的主要 View 可相互下钻并保留 references；
2. unknown/opaque/stale/conflict 在所有相关 View 中可见；
3. CLI 与 Workbench 对同一 proposal 得到 byte-equivalent canonical plan binding；
4. plan 不写 live workspace；apply 使用 revision/CAS；
5. accepted/rejected/rolled-back/recovery-required 都有稳定 product result；
6. 跨站、错误 Host/capability、越权路径/operation/Effect 在读取或写入前拒绝；
7. AI 不能构造更宽 authorization 或更低 Verification；
8. accepted 后所有 View 来自新 canonical revision，而不是 UI 本地补丁。
