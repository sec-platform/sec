# Canonical Architecture Convergence 裁决证据

> 状态：non-authoritative decision evidence  
> 决策基线：`main@a91ac03085f03b4405b8420d336a4fc5d9705dc4`（Verification 1B-1/1B-2/1B-3/1B-4 已进入主干，PR #268 已合并）  
> 跟踪：Issue #265  
> 权威落点：`docs/product.md`、`docs/system-architecture.md`、`docs/roadmap.md` 与各领域 canonical 文档

本文只记录为什么作出本次架构融合、哪些旧设计被吸收或拒绝、哪些事实仍未知，以及什么证据可以推翻当前裁决。本文不拥有产品、架构、路线、当前状态或执行授权。

## 零、重建裁决（2026-08-04，PR #268 后）

阶段 1（Verification 1B 序列）在 `main@a91ac030` 真实闭合后，旧 PR #266 分支基于 `335ffdbe` 且含 17 个过程提交，落后新主干两个正式结果，不能直接 rebase 后机械合并。裁决如下：

1. 保留 PR #266 与讨论历史，但从 `main@a91ac030` 重建 head 分支为单一父、单一意图明确的 squash commit：`docs: converge canonical architecture and root roadmap`；旧 17 个过程提交不进入新主干。
2. 下一正式 Work Package 冻结为 `canonical-architecture-convergence-v1`（Issue #265 / PR #266），在同一候选内原子完成：
   - 新建并冻结 `docs/work-packages/canonical-architecture-convergence-v1.md`；
   - pointer 原子切换到新 manifest，并同步 `docs/work/active-work-package.md` 与 `docs/work/rolling-plan.md`；
   - 1B-4 manifest `semantic-mutation-classification-v1.md` 在 pointer 接管后移入 `docs/archive/work-packages/`；
   - 删除 `docs/work/**` 中失效的 #232/#233 与旧 Verification 队列引用；
   - `docs/work/current-state.yaml` 保持只保存 resolver 配置与 authority 入口，不写入当前 SHA/PR/进度。
3. 顶层权威融合正式更新 `docs/product.md`、`docs/system-architecture.md`、`docs/roadmap.md`，冻结 Brownfield 治理链、确定性生成链、共享 Engineering Semantic Model、`Observation → Responsibility → Impact → Operation → Mutation`、`Authority / Canonical / Evidence / Projection` 与当前能力/目标能力的成熟度区分。
4. 根路线补齐三条受约束轨道：Workspace Domain（W0–W7）、Nexus Conformance（N0–N8）、Specialized Target / Provider（S0–S7），并加入基础设施饥饿保护规则。
5. #243 中仍有效的 owner 裁决直接吸收进本包：Compiler Target vs Runtime Host、Mutation rollback vs Migration recovery、Responsibility owner、Verification vs Compatibility vs Support、Role / Operation / Skill / Workbench；不再拆成两个前置 docs-only WP。
6. `docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md` 保留为 historical execution decision；本文件与 `2026-08-04-full-architecture-asset-audit.md` 保留并更新为解释裁决的历史 Evidence，不拥有当前状态或长期路线。

本裁决不证明任何门禁已通过；parser/registry/ownership/docs-doctor/audit/typecheck/affected/Review/hosted Quick/merge/readback 的通过状态只由对应运行与 exact-head Evidence 决定。

## 一、输入证据

### Canonical documents

- `docs/product.md`
- `docs/system-architecture.md`
- `docs/roadmap.md`
- `docs/semantic-model.md`
- `docs/delta-and-impact.md`
- `docs/semantic-mutation.md`
- `docs/compiler-target-ir.md`
- `docs/capability-and-block-model.md`
- `docs/brownfield-import.md`
- `docs/workbench-and-ai-operations.md`
- `docs/runtime-and-distribution.md`
- `docs/change-management.md`
- `docs/verification-governance.md`
- `docs/development-governance.md`
- `docs/authority.json`

### Program / proposal / execution evidence

- Issue #235：active documentation corpus、duplicate owner 和 proposal lifecycle迁移总账；
- Issue #228 / closed non-merged PR #229：Agent Skill System V2 Spike；
- `docs/proposals/engineering-workspace-domains.md`；
- `docs/proposals/development-run-kernel.md`；
- `docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md`；
- `docs/work/**` 当前控制面；
- 当前 open Draft PRs 的真实 base/head、scope 和未验证声明；
- 当前 `main` 的 Engineering IR、Verification、Semantic Mutation、TaskEnvelope、Impact 和 publishing code。

### 代码反例

- `buildTaskEnvelope()` 仍硬编码 Customer/Ticket测试路径，证明当前产品闭包仍是 reference-specific；
- Source Program Model / Brownfield Attach→Adopt 尚无完整当前产品 producer；
- Impact有保守外壳，但state/effect/permission/scenario等关键关系覆盖不足；
- Verification writer/aggregate/readback正在1B序列中收口，证明后续所有成功必须依赖统一真值；
- public publisher使用live workspace复制和force-push历史，不能代表R15完成；
-当前17-Skill系统有inventory和coverage价值，但Role、Operation、Policy、State、Evidence语义重复分布。

## 二、根问题

核心领域理论并非缺失。问题是这些理论没有被顶层系统统一编译：

1. `roadmap`把Semantic Mutation排在完整Physical/Source observation与Impact之前；
2. Brownfield被放得过晚，无法尽早证明Core通用性；
3. Verification后继平台、Workspace Domains、Skill/Run Kernel等横切设施容易形成独立治理主线；
4. product、architecture、roadmap、Evidence、proposal和rolling plan之间的authority边界没有始终落实；
5. Target/Host、transaction rollback/migration recovery、Responsibility、Verification/Compatibility/Support和Task/Operation存在重复或缺失owner；
6. Skill被同时当作Role、workflow、permission、state machine和Evidence解释器，造成上下文累积和维护重复；
7. “完整设计”与“巨型一次提交”被混淆，导致一边担心空架构，一边又通过局部迭代临时发明概念。

## 三、采用的裁决

### 1. 一次冻结完整终态，分阶段证明实现

一次性到位的是：

- 对象和identity；
- authority和single writer；
- 两条产品主链；
- 跨域接口；
- 依赖DAG；
- failure/recovery；
-成熟度和完成Evidence；
-反转条件和退役条件。

实现按可独立验证、迁移和回滚的纵向Work Package进入`main`。分包不得降低终态或把临时兼容面变成永久架构。

### 2. 两条产品主链，共享一个Engineering Semantic Model

```text
Existing Workspace
→ Physical Observation
→ Source Program Model
→ Engineering Semantics
→ Responsibility / Impact
→ Operation / Mutation
→ Verification / Readback
```

```text
Intent / Contract / Block
→ Engineering Semantics
→ Application / Behavior / Target Program IR
→ Backend
→ Artifacts
```

拒绝Brownfield代码图和Generator模板形成两套semantic identity、Responsibility、Effect、Permission或Verification。

### 3. Observation → Responsibility → Impact → Operation → Mutation不可颠倒

现有Mutation基础设施保留，但“通用Semantic Mutation完成”必须等待：

- 可靠Physical/Source observation；
- source owner和Responsibility；
- predicted/actual Impact；
-版本化Operation/authorization；
-真实canonical与Brownfield operation physical proof。

### 4. Verification Truth先闭合，但后继平台不得无限阻塞产品

R2必须消灭wrong environment、order dependence、not-applicable混淆、zero-test pseudo-pass、artifact drift和self-proof。

Execution Ledger、Evidence DAG、Run Journal、CI Evidence新版本和完整Hermetic Runtime按真实R3–R9 consumer激活，不形成无终点的元治理序列。

### 5. Responsibility由Semantic Model拥有

Responsibility不是Block、file、module、function、UI节点或team。Source analysis只生成candidate；Adopt/Contract/canonical rule决定authority。

### 6. Target与Host永久正交

Compiler唯一拥有Target Profile、Type Algebra和Target lowering。Runtime只拥有Host Profile、Toolchain、Runtime Environment、Distribution和Support maturity。

### 7. Transaction rollback与Migration recovery分离

Semantic Mutation拥有单次transaction journal/publish/rollback/recovery terminal。Change Management拥有Compatibility、Migration、Compensation、Forward Recovery、Deployment ordering和irreversible boundary。

### 8. Workbench只投影，AI只提案

Workbench不拥有Operation、Permission、Impact、Verification、Run State或terminal。AI不能提交derived owner/path/Delta/Impact/risk/Verification或扩大Envelope。

### 9. Agent Operation System替代对等Skill堆叠

```text
Universal Policy
→ Role
→ typed Operation Envelope
→ exactly one Primary Skill
→ deterministic services
→ typed transition
→ external Run State / Evidence
```

Skill保留启发式workflow，不拥有Role、permission、Work Package、Candidate、Failure、Verification、Evidence或merge truth。

## 四、旧材料 disposition

### 保留并升级为canonical

- 现有Product、Semantic IR、Delta/Impact、Mutation、Brownfield、Target IR、Block、Verification等领域核心不变量；
- Issue #235关于owner边界的已证明裁决；
- Skill V2关于Role/Operation/Primary Skill/typed transition的核心分层；
-阶段计划中“先Verification truth、后产品纵切片、IR由consumer驱动”的有效部分。

### 吸收后退役

- Engineering Workspace Domains proposal：Domain成熟度和consumer-driven activation进入system/roadmap后退役；
- Development Run Kernel proposal：Role/Operation/Run State边界进入development/roadmap后，具体实现留给R14；
-旧17-Skill的重复state/permission/verification prose：迁移到deterministic service后删除；
-旧stacked Drafts：只提炼仍有效内容，从then-latest main重建，原栈关闭。

### 拒绝

- 所有分支自动合并；
-以治理fixture证明完整Run Kernel；
-在没有Source Model/Impact的情况下宣布通用Mutation完成；
-预先构建无真实consumer的完整IR宇宙；
-把完整阶段计划塞进`docs/work/**`；
-所有Work Package固定运行同一重门禁；
-把浏览器缓存、ambient工具或live workspace复制进fixture/release；
-用Customer/Ticket字面量通过Core反特化；
-用AI confidence、Provider多数票或路径相似度建立authority/identity。

### 延后但保留目标

- Evidence DAG、Run Journal、Integration Queue、Review Finding平台；
-完整Workspace Domain mutation/recovery；
-Registry生态和更多语言；
-完整Release/Deployment/Operations。

这些能力按R0–R16进入条件激活，不构成当前自动后继。

### 重建后新增的吸收裁决

- Workspace Domain 轨道正式进入 roadmap，成熟度阶梯为 `W0 inventory → W1 validated identity/revision → W2 query/projection → W3 Delta/Impact → W4 governed mutation → W5 migration/compatibility → W6 fault/recovery → W7 product-supported`，覆盖 Repository、Documentation、Workflow/Gate、Agent Operations、Evidence、Release 与 Product Decision/Portfolio。
- Nexus Conformance 轨道正式进入 roadmap，`N0 exact census → N1 100% path classification → N2 100% mechanism decisions → N3 EPR 29/29 + Skills/entrypoints/public surfaces → N4 domain bindings → N5 semantic/effect/failure parity → N6 consumer migration → N7 retirement → N8 unexplained delta = 0`，完成门为 unclassified/undecided/missing-parity/unexplained-delta/unauthorized-retirement 全零。
- Specialized Target / Provider 轨道正式进入 roadmap，`S0 corpus/architecture → S1 provider contract → S2 Source Program support → S3 cross-artifact Impact → S4 governed mutation → S5 lowering/round-trip → S6 physical acceptance → S7 supported target`，覆盖 Web、Node/Bun/Edge、Persistence、Mobile、Native、Systems、Hardware、High Assurance、ML/Data；不得在 TypeScript 主脊闭合前建立第二 compiler core。
- 旧的 `1B-4 → #216 → #207` 自动队列不再有效；#216/#207 与 #248/#260/#240/#242 作为条件候选，由新 rolling plan 按真实 consumer 与 P0/P1 blocker 重算。

## 五、最强反对意见

### “先把治理基础全部做完，未来会更快”

部分成立：正确的identity、Verification、transaction和permission会复利。

但如果没有真实Observation、Impact、Operation和Brownfield consumer，治理系统只能管理自身fixture，无法证明抽象正确，且容易持续增加candidate栈和上下文负担。因此基础设施必须绑定真实产品出口。

### “完整设计会被现实实现推翻，所以应该边做边设计”

实现会发现未知，但不应以此放弃终态设计。正确做法是预先冻结对象、owner、依赖、Evidence和反转条件；新Evidence触发上游重算，而不是在下游追加例外。

### “Application/Behavior/Target IR既然最终需要，就应立即全部实现”

完整层次现在可以冻结，但物理类型和builder只有在真实artifact migration暴露现有层无法表达的gap时落地。否则没有consumer的IR无法校准identity、legality、failure或migration。

### “Agent系统应尽早自举，能立刻提升开发速度”

薄路由、Work Package和Skill可继续使用；完整Run Kernel必须消费真实R3–R8产物。否则它只能自举治理流程，无法验证是否降低真实产品开发成本。

## 六、反转条件

只有以下Evidence才允许推翻根架构，而不是一般实现困难：

1. 两条产品主链无法共享Engineering Semantic Model，并能证明不是adapter/identity/coverage缺口；
2. Responsibility无法作为稳定语义对象表达真实state/effect/permission/source ownership；
3. Source Program Model无法在不成为authority的情况下支持Brownfield governance；
4. Operation/authorization无法同时覆盖canonical和Brownfield source；
5. Application/Behavior/Target Program分层在真实backend migration中产生不可消除的循环或第二semantic owner；
6. exactly-one Primary Skill无法表达真实operation而必须同时由多个workflow共同拥有一个transition；
7. R0–R16依赖造成可证明的产品死锁，且不存在缩小阶段出口的方案。

触发时必须回到相应canonical owner和roadmap阶段重算，并同步修正所有受影响文档、代码和测试。

## 七、尚未证明的部分

- 本裁决只记录决策；parser、docs doctor、authority/ownership census、repository audit、typecheck、affected 与独立 Review 的通过状态必须由 exact-head 运行证明；
- R3–R16大部分仍是target architecture，不是当前产品能力；
- Skill V2尚无生产parser、permission evaluator、transition validator或正式迁移；
- Source Program Model和Responsibility reconstruction尚未形成完整当前producer；
-外部Brownfield、clean package和deployment尚未形成产品Evidence。

因此本裁决只能授权canonical文档迁移候选，不能声明SEC产品闭环已经完成。
