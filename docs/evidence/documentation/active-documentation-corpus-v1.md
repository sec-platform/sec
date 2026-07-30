---
title: Active Documentation Corpus v1 迁移裁决账本
status: evidence
last-reviewed: 2026-07-29
---

# Active Documentation Corpus v1 迁移裁决账本

## 证据身份

本文是 Issue #173 / `active-documentation-corpus-v1` 的迁移与审计 Evidence，不是产品、架构、流程或当前状态的 authority。

- source `main`: `c289a44609a3502140ede55857d90109d4db744f`
- source corpus candidate: PR #196 head `7b86bff6a1afb88c52b86e0f58af83d6a63f87b5`
- reconciliation branch: `docs/active-corpus-deep-reconciliation-v1`
- audit scope: PR #196 归档的 active corpus、其 active replacements、相关代码合同、Skills、测试/CI authority 与 Issue #173 验收
- excluded write scope: PR #196 当前 review finding 所在代码、测试、control-plane 和 stale-root cleanup；这些由并行执行者处理

账本只证明本次逐节裁决。后续 `main`、domain contract、consumer 或 product Goal 变化时，必须重新审查相关条目；不得把本文复制为第二套设计。

## 裁决词汇

| 裁决 | 含义 |
| --- | --- |
| `retain` | 独立稳定机制继续保留在唯一 active owner |
| `merge` | 与另一稳定机制自然归属同一 owner，去重后合并 |
| `code-owned` | 精确字段、状态、算法、路径、版本或当前能力由代码/测试/metadata拥有 |
| `skill-owned` | 需要 Agent 判断的 trigger、权限、执行、停止或恢复进入唯一 Skill |
| `control-owned` | 当前 SHA、PR、candidate、Gate、failure、next action 只存在于 resolver/control/Evidence |
| `proposal` | 长期设计仍有效，但在类型、builder、validator、consumer和tests落地前不得宣称实现 |
| `archive` | 保留历史原文以追溯，不参与当前 authority |
| `delete` | 无独立机制、无消费者、重复或与当前事实冲突，不保留 active compatibility stub |

## 全局裁决

1. 历史编号 `00–14` 不是领域边界；新 owner 按 Product、System、Semantic Model、Delta/Impact、Mutation、Compiler/Target、Capability/Block、Brownfield、Workbench/AI、Runtime、Change、Verification、Development、External Provider、Nexus Corpus 和 current control 划分。
2. 旧文档原文作为 latest-main historical bytes 归档；归档文件的旧 `status: active` 只属于历史内容，不使其继续拥有当前事实。
3. 稳定文档只保留对象、不可约约束、机制、生命周期、失败/反转和完成判据。精确 union、schema、diagnostic、algorithm、command、dependency、version、path inventory 和当前支持矩阵下沉到代码/metadata/tests。
4. 需要 Agent 判断的执行闭包进入 `.agents/skills/**`；文档只保留领域边界和唯一 owner链接。
5. 当前 candidate、CI/Review、run、failure和 next transition 进入 `docs/work/**`、PR/Issue、Checks、Artifacts 或未来 Run Journal，不进入 stable prose。
6. Proposal 必须显式标记未实现；设计、类型声明、单测、部署和现实支持是不同层级。
7. Navigation、README、AGENTS、图示和报告是投影，不得拥有第二套产品/架构事实。

## `00-文档索引与一致性规则.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner / consumer | 失效与复核条件 |
| --- | --- | --- | --- | --- |
| 文档分层、权威优先级、重复事实治理 | 稳定机制 | `retain + merge` | `docs/authority.json`、`docs/development-governance.md`、`sec-documentation-governance` | registry/domain模型改变 |
| active / planned / current / historical 的区别 | 稳定生命周期 | `retain` | registry lifecycle；current/target标签进入各领域文档 | 新 lifecycle kind 或 promotion 状态出现 |
| 一个主题一个 canonical owner | 稳定不变量 | `retain` | authority registry ownership keys；Docs Doctor | 跨域 owner 或 projection 规则改变 |
| Markdown 全量分类与 Agent 行为覆盖 | 可执行合同 | `code-owned + skill-owned` | `agent-skill-contract.ts`、repository audit、documentation/heuristic Skills | tracked surface/behavior registry变化 |
| frontmatter/H1/link/Unicode/deprecated token | 机械校验 | `code-owned` | docs-doctor与合同测试 | validator contract升级 |
| 旧编号文档完整清单 | 历史索引 | `archive + delete active` | `docs/archive/authority-v5/**` | 仅历史追溯 |
| 动态数量、当前 SHA、当次结果 | 易变事实 | `control-owned` | resolver/PR/Evidence | 每次 candidate变化 |
| “旧路径必须存在”的 required-owner规则 | 失效实现 | `delete` | 由 `docs/authority.json` exact records替代 | registry退役时重算 |

## `01-用户能力模块化开发-主题整理稿.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| 用户为何不应只操作源码/文件 | 产品问题 | `retain` | `docs/product.md` | 恢复工程语义空间与用户可见结果 |
| Block/Responsibility/Contract/Port 的产品直觉 | 产品与能力模型 | `merge` | product + capability/block | 分发单位与架构理解单位分离 |
| 模板、SDK、低代码、工作流、代码图、AI助手对比 | 产品边界 | `retain` | product | 防止 SEC 被降级为相邻品类 |
| “芯片/管脚/连线”类视觉比喻 | 解释材料 | `archive` | 可在产品教育材料投影 | 不作为正式数据模型 |
| 生态飞轮、长期护城河 | 产品机制/判断 | `retain` | product | Contract/Block/Evidence/Migration资产飞轮 |
| 具体业务例子和早期 brainstorm | 历史候选 | `archive` | 无 active owner | 不能使 core 特化 |

## `02-工程编译器-MVP-PRD与架构稿.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| 产品定位、核心价值、非目标、适用范围 | 稳定产品 | `retain` | product | 已恢复用户结果、复杂算法边界和成功判据 |
| Authoring→IR→Compilation→Projection 主链 | 稳定架构 | `retain + merge` | system architecture | 当前/目标链明确分层 |
| Workspace zones 与所有权 | 稳定架构 | `retain` | system architecture +代码路径合同 | `.sec` 不再整体标为可删缓存 |
| CLI/Workbench/AI/Registry 产品表面 | 产品边界 | `retain` | product + workbench/AI + capability | transport不拥有语义 |
| Block 与 Responsibility 分工 | 稳定机制 | `retain` | product + capability/block | 避免按 package理解架构 |
| exact Node/Bun/version/support 叙述 | 动态实现事实 | `code-owned + control-owned` | runtime metadata/contracts/Evidence | stable doc只保留版本策略和成熟度链 |
| 规划中的 Workspace/Target IR 被写入总链 | 长期架构 | `proposal` | system + workspace/target proposals | 未实现不得称当前 snapshot |

## `03-MVP实施计划与路线图.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| TypeScript-first、Core语言无关 | 稳定路线原则 | `retain` | roadmap/compiler-target | 多语言由Provider扩展 |
| 阶段 DAG 与进入/退出条件 | 稳定路线 | `retain` | roadmap | 不复制当前 active package |
| Target IR 跨层进入门 | 稳定退出条件 | `retain` | roadmap + compiler-target | 每层冻结 public contract、revision、negative behavior 与 test ownership 后进入 |
| provisional snapshot 失效/rebind | 稳定退出条件 | `retain` | roadmap + delta-and-impact | 新 domain revision 进入后旧 snapshot 失效，由同一 lowering owner 重建 |
| aggregate completion | 稳定退出条件 | `retain` | roadmap + engineering-workspace-domains | 所有 required domain、跨域引用、projection、Mutation/recovery 与产品纵切片同时闭合 |
| 两个独立团队 | 稳定退出条件 | `retain` | roadmap + external-provider-policy | 至少两个独立团队完成 publish→adopt→upgrade→retire 生命周期 |
| 永久 regression | 稳定退出条件 | `retain` | roadmap + verification-governance | 每个新漏洞映射回 canonical contract 并形成永久 regression |
| Target Profile、Type Algebra、Application/Behavior/Program IR | 长期架构 | `proposal` | compiler-target + roadmap | 需独立kernel逐层进入main |
| Engineering Workspace domains | 长期架构 | `proposal` | engineering-workspace proposal | 不能建立巨型optional object |
| Workbench/AI/Brownfield/Nexus/production阶段 | 产品路线 | `retain` | roadmap +各domain owner | 恢复明确完成门 |
| 当前完成状态、PR、SHA、active next | 易变控制 | `control-owned` | `docs/work/**`、live resolver | 不进入稳定路线 |
| Type Algebra最小集合与不支持行为 | 稳定目标 | `retain` | compiler-target | exact schema以后由代码拥有 |
| 用户可见健康/影响/证据结果 | 产品验收 | `retain` | product/workbench/roadmap | 不只验收内部类型 |

## `04-AI自主实现执行蓝图.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| main/GitHub/docs/manifest/Evidence事实层级 | 开发治理 | `retain` | development governance | live事实优先于PR body和聊天 |
| current-state / rolling-plan / active pointer | 控制面机制 | `retain` | development governance +代码 resolver | 当前内容只在control-owned surfaces |
| A0/Worker、single writer、Gate custody | 开发治理 | `retain` | development governance +对应Skills | 角色不复制产品合同 |
| Branch/PR/merge/readback生命周期 | 开发治理 | `retain` | development governance +CI/merge Skill | branch不是待机械合并功能包 |
| 行为路由表 | 启发式投影 | `skill-owned` | `agent-skill-contract.ts` + Skills | stable doc只保留Skill边界 |
| exact commands、Gate payload、重跑流程 | 机械/启发式执行 | `code-owned + skill-owned` | runners/workflows/Skills | 不复制到架构正文 |
| future Run Kernel / automatic resume | 长期架构 | `proposal` | development-run-kernel proposal | 当前仅manual-shadow重算 |
| 当前任务、failure、exact candidate | 易变控制 | `control-owned` | Work Package/PR/Evidence | 不进入稳定正文 |

## `05-编译器核心实现规格.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Semantic Core、Host、Toolchain、Target分离 | 稳定架构 | `retain` | runtime + system | runtime-neutral不等于无I/O抽象 |
| Workspace source/project/control/local state zones | 稳定架构 | `retain` | system +代码路径合同 | identity-bound state单独分类 |
| Governed Source、Slot、Opaque Boundary | 稳定机制 | `retain + merge` | product/capability/brownfield | 复杂逻辑不强塞Slot |
| compiler public facade、module responsibility | 公共实现边界 | `code-owned` | imports/contracts/tests | stable doc只保留单一facade原则 |
| Resolver/Composer/Lowerer职责 | 编译架构 | `retain` | compiler-target + capability | exact stage实现由代码拥有 |
| CodeBuilder、生成规则、幂等 | 实现合同 | `code-owned` | generator/codegen tests | 不在稳定正文复制API清单 |
| runtime dependency、Playwright、staging、Windows launch等超长算法 | 当前实现细节 | `code-owned + evidence` | runtime/verification contracts和physical Evidence | 从稳定总览删除，必要时生成reference |
| 当前 module/path/field清单 | 易漂移事实 | `code-owned` | source/types/tests | 文档不维护第二 inventory |

## `06-Registry与Block协议规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Registry source、Block职责与生命周期 | 稳定机制 | `retain` | capability/block | 已恢复 resolve→publish→upgrade→retire |
| requires/provides/conflicts与确定性Resolution | 稳定机制 | `retain` | capability/block +resolver code | ambiguity fail closed |
| Capability、Typed Port、Slot | 稳定协议 | `retain` | capability/block | Port schema、Slot提升条件已恢复 |
| Semantic Contract与显式cross-contract import | 稳定语义 | `retain` | capability/block +semantic linker code | 同名不自动链接 |
| Generator protocol与single artifact writer | 稳定机制 | `retain` | capability/block +compiler-target | shadow/parity/switch/retire |
| exact manifest fields、current kinds、overlay algorithm | 当前schema | `code-owned` | manifest types/loaders/tests | 可生成reference，不手写清单 |
| 当前“implemented/not implemented”表 | 易变状态 | `control-owned/code-owned` | main readback/roadmap | stable doc不静态复制 |
| trust/signature/license/Effect boundary | 稳定机制 | `retain` | capability/block +external provider +release | AI confidence不能代替trust |

## `07-Pass状态机、错误码与恢复机制.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| parse→semantic→lower/compose→verify→emit因果链 | 稳定架构 | `merge` | system/compiler-target/verification | 不把规划stage写成已实现 |
| Pass输入输出和失败阻断 | 稳定机制 | `retain` | compiler contracts +verification | 上游失败阻止下游猜测输出 |
| pending/running/succeeded/failed/blocked/skipped | 当前状态模型 | `code-owned` | pipeline types/tests | stable文档不冻结旧enum |
| Issue/diagnostic分类 | 领域机制 | `merge` |各domain diagnostics | exact code/prefix由代码拥有 |
| recovery从accepted revision重算 | 稳定机制 | `retain` | semantic mutation +verification +development failure recovery | 不是“继续跑” |
| exact error code表、current pass list | 当前实现 | `code-owned` | code/tests/generated reference | 删除第二清单 |

## `08-Verification、Provenance与Graph规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Verification只读canonical semantics | 稳定边界 | `retain` | verification governance | report/Evidence可写，语义不可写 |
| Acceptance、Policy Gate、coverage | 稳定机制 | `retain` | verification +semantic model | runnable mapping不属于IR |
| Artifact Provenance vs Fact Provenance | 稳定分层 | `retain` | verification +semantic model | origin不能自动成为内容authority |
| Project baseline、drift guard、specific staged exclusions | 当前算法 | `code-owned` | code/tests | 只保留“derivative cache不成为Evidence”原则 |
| ExplainGraph、ReviewSummary、Semantic View | 投影机制 | `merge` | delta/impact +workbench/AI | 不是IR替代品 |
| Evidence层级和Provider boundary | 稳定机制 | `retain` | verification +external provider | stale/partial显式 |
| exact Mutation Verification report/schema/adapter algorithm | 当前实现合同 | `code-owned` | mutation/verification code/tests | 稳定正文不复制版本和字段 |

## `09-AI Runtime、任务信封与治理规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Platform authority / AI bounded operator | 永久边界 | `retain` | workbench/AI +product | AI只proposal |
| Context Packet最小充分投影 | 稳定机制 | `retain` | workbench/AI | freshness、source下钻和unknown已恢复 |
| Task Envelope operation/path/effect/fact/verification/budget | 长期协议 | `proposal` | workbench/AI；未来types/builders | 当前Slot envelope不能冒充完整Operator |
| Semantic Operation授权交集 | 稳定机制 | `retain` | workbench/AI +mutation | request不能提交derived risk/Delta/Impact |
| Runtime Evidence与Provider | 稳定机制 | `merge` | workbench/AI +external provider +verification | 只能缩小/辅助，不扩大权限 |
| Budget、failure、audit | 稳定机制 | `retain` | workbench/AI | 不需要模型chain-of-thought |
| exact V2 interface/operation enum | 未冻结schema | `proposal/code-owned later` | future implementation | 设计示意不能成为兼容合同 |

## `10-升级迁移与Override规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| identity/compatibility/migration/verification四问 | 稳定机制 | `retain + expand` | change management | 增加Impact/deployment/retirement |
| Manual/rule-backed/emergency Override | 稳定机制 | `retain` | change management | Manual drift不成semantic source |
| file/config/slot/DB migration类别 | 当前union | `code-owned` | upgrade types/tests | stable doc只留kind要求 |
| Semantic Migration与Fact validity | 稳定机制 | `retain` | change management +semantic model | assertion按来源重建 |
| Expand/Migrate/Contract数据演进 | 生产机制 | `retain` | change management | 不自动保证零停机 |
| rollback三层、forward-only、backup/operator | 稳定机制 | `retain + expand` | change management | 增加irreversible point与forward recovery |
| exact command/operation清单 | 当前实现 | `code-owned` | upgrade code/tests | 不复制 |

## `11-Workbench与可视化规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Architecture/Scenario/Data/State/Contract/Effect/Impact Views | 稳定产品机制 | `retain` | workbench/AI | 同一canonical state多投影 |
| Unified Inspector | 稳定UX合同 | `retain` | workbench/AI | 增加freshness/implementation/terminal层级 |
| Overlay与authority/confidence视觉分离 | 稳定机制 | `retain` | workbench/AI | overlay不改canonical graph |
| legacy Explain/Review兼容tabs | 迁移机制 | `retain until consumers migrate` | workbench/AI | 不允许旧mutation升格 |
| UI operation→plan→apply→terminal | 稳定操作链 | `retain` | workbench/AI +mutation | accepted后从canonical重载 |
| local HTTP origin/host/capability | 安全边界 | `retain` | workbench/AI +transport code | 在读workspace前拒绝 |
| exact TS interfaces、UI layout图、current endpoint | projection/current implementation | `code-owned/archive` | UI/transport code | 不作为稳定authority |

## `12-编译管道与行为流图示.md`

| 旧图/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| 总体编译链图 | 导航投影 | `merge` | system architecture | 图不拥有stage状态 |
| canonical→projection图 | 导航投影 | `merge` | system +workbench | 不反向成为事实源 |
| AI执行链 | 导航投影 | `merge` | workbench/AI +mutation | exact状态由代码拥有 |
| Semantic Mutation图 | 导航投影 | `merge` | semantic mutation | 不拥有字段和algorithm |
| Provenance图 | 导航投影 | `merge` | semantic/verification | Artifact与Fact来源分开 |
| 七类View图 | 导航投影 | `merge` | workbench/AI | 可从owner文档生成 |
| 图中把planned Normalize/lower写成implemented | 过时事实 | `delete/correct` | roadmap/main | 图不能越级宣称实现 |

## `13-独立工具分发与打包规划.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Core/Host/Toolchain/Target/Optional Adapter五轴 | 稳定架构 | `retain` | runtime/distribution | 任何轴不能推断另一轴 |
| Node/Bun exact baseline和release schedule | 易变政策/事实 | `code-owned + evidence` | machine support profile/metadata | stable doc保留min/reference/canary策略 |
| package root/executable/assets/caller workspace | 稳定layout | `retain` | runtime/distribution +layout code | unknown layout fail closed |
| portable lease完整generation/hardlink算法 | 精确实现 | `code-owned + evidence` | workspace-write-lease code/fault tests | stable doc只保留single-writer/recovery原则 |
| Windows/Unix/WSL能力 | 稳定平台边界 | `retain` | runtime/distribution | target-platform path语义独立 |
| release package/public mirror/SBOM/signing | 稳定发布机制 | `retain` | runtime/distribution +future Release domain | 当前未实现部分标proposal |
| exact current dependency/runtime implementation | 当前实现 | `code-owned` | package/lock/code/tests | 不复制 |

## `14-Engineering IR与语义事实规范.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| IR定位、multigraph、Entity/Fact/Assertion | 稳定语义 | `retain` | semantic model | 已恢复完整身份与边界 |
| exact Entity/Predicate unions、signature variants | 代码合同 | `code-owned` | shared types +predicate registry/tests | stable doc只保留active/reserved机制 |
| Authority、Confidence、Provenance、Evidence refs | 稳定语义 | `retain` | semantic model | strongest-wins禁止 |
| input/semantic revision、自引用排除、digest payload | 精确算法 | `code-owned` | builders/validators/contract freeze | stable doc保留revision分域 |
| Builder/current producer清单 | 当前实现 | `code-owned` | code/tests/generated reference | 不手写第二inventory |
| Scenario derived cache | 稳定机制+精确算法 | `retain concept/code-owned exact` | semantic model +IR code | Scenario不是第二入口 |
| Workspace Semantic Linker | 稳定机制+当前实现 | `merge/code-owned` | capability/block +semantic code | import/qualified identity保留 |
| Validated IR boundary/deep freeze | 稳定机制 | `retain` | semantic model +validator code | consumer只收branded snapshot |
| Fact Delta | 独立算法域 | `merge` | `docs/delta-and-impact.md` +code | 两个validated endpoints，不由Mutation自报 |
| Impact propagation | 独立算法域 | `merge` | delta/impact +versioned rule registry | signature不拥有传播方向 |
| Semantic Mutation request/plan/apply/recovery | 独立事务域 | `merge` | `docs/semantic-mutation.md` +code | proposal不拥有derived result |
| exact diagnostics、schema、rule IDs、revision payload | 代码合同 | `code-owned` | code/tests | 可生成reference，不复制到stable prose |
| future Type Algebra/Target/Workspace domains | 长期架构 | `proposal` | compiler-target/workspace proposals | 不能由类型片段证明实现 |

## `architecture/sec-ts-ir-layers.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Target Profile、Type Algebra、Application/Behavior/TS Program IR职责 | 长期架构 | `retain as proposal` | compiler-target | 每层独立validate/freeze/revision |
| Behavior IR有限表达/Extension/Opaque | 稳定目标 | `retain` | compiler-target +product | 不追求任意算法IR |
| Program IR vs TS AST/backend | 稳定边界 | `retain` | compiler-target | backend不重新解释业务 |
| current generator reconciliation | 迁移机制 | `retain` | compiler-target +capability | artifact single writer |
| exact future interfaces | 未冻结schema | `proposal` | future code Work Packages | 不作为当前compatibility |

## `architecture/engineering-workspace-ir.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Repository/Documentation/Gate/Agent/Release/Decision/Evidence domains | 长期架构 | `retain as proposal` | engineering-workspace proposal +system | 独立domains，不建巨型对象 |
| current semantic loader迁移 | 迁移设计 | `retain` | proposal +future code owner | 禁止第二filesystem loader |
| Documentation domain对象 | 长期架构 | `retain` | proposal；当前registry为阶段性实现 | registry仍需typed vocabulary/bindings |
| Gate/Result/Evidence层级 | 长期架构 | `merge` | verification +proposal | current contracts保持authority直到迁移 |
| Product Decision vs Evidence Ledger | 长期架构 | `retain` | proposal | support/contradict不写回semantic authority |
| aggregate Snapshot | 长期架构 | `proposal` | future aggregator | 未实现domain不能空对象占位 |

## `architecture/brownfield-import.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Attach/Lift/Reconcile/Adopt/Normalize | 稳定机制 | `retain` | brownfield | 已恢复完整阶段和退出门 |
| Source Program Model最小对象和identity | 长期协议 | `retain as proposal` | brownfield；future code | observed/derived，不是Engineering IR |
| Provider contract | 稳定边界 | `retain` | brownfield +external provider | coverage/freshness/unknown必需 |
| mutation/round-trip/safety/privacy | 稳定机制 | `retain` | brownfield | 默认不执行不受信代码 |
| exact Nexus path count/current corpus fact | 易变Evidence | `control/evidence-owned` | Nexus ledger/corpus | 不进入stable Brownfield doc |

## `goals/SEC-Engineering-Workspace-Compiler.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| 长期产品Goal、世界模型、用户结果 | 稳定产品 | `merge` | product | 不保留第二Goal文档 |
| 完整Workspace/Target domains | 长期架构 | `proposal` | system/compiler/workspace proposals | 设计≠实现 |
| 当时阶段和实现判断 | 历史事实 | `archive` | 无active owner | 由最新main/roadmap替代 |

## `governance/agent-skills-and-development-run-kernel.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| 确定性规则/启发式/审计Evidence三分 | 稳定治理 | `retain` | development governance | Skill不是第二事实源 |
| AgentOperation最小闭包 | 启发式协议 | `skill-owned` | agent-skill registry +Skills | exact sections由机器验证 |
| repository orientation vs audit | 稳定治理 | `retain` | development governance +Skills | 全仓任务使用exact tracked census |
| V19 run/session/worktree/capsule机制 | 长期架构 | `proposal` | development-run-kernel proposal | 当前不宣称自动恢复闭合 |
| exact current path counts/behavior IDs | 代码事实 | `code-owned` | agent-skill contract/audit | stable doc不复制数量 |

## `governance/external-capability-and-provider-policy.md`

| 旧章节/陈述簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| Discovery→Research→Decompose→Map→A/B→Decision→Retire | 稳定政策 | `retain` | external-provider policy | 后续正文恢复完整流程 |
| Provider不可成为Core authority | 永久边界 | `retain` | external provider +semantic/brownfield | 外部结果只Evidence/candidate |
| decision taxonomy与duplicate removal | 稳定政策 | `retain` | external-provider policy +ledger | 引入能力必须删除/阻止自研重复 |
| direct/daily/architecture/security/brownfield modes | Agent/tool启发式 | `skill-owned + retain policy boundary` | external capability Skill | 具体路由不写两套 |
| GitNexus/CodeGraph等当前工具结论 | 易变Evidence | `ledger/control-owned` | external capability ledger | 不在stable prose绑定品牌版本 |
| benchmark指标与SEC/Nexus corpus A/B | 稳定研究方法 | `retain` | external-provider policy | 作者benchmark不够 |

## Nexus governance corpus

| 旧材料 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| absorption/conformance contract | 项目专属稳定合同 | `retain` | `docs/corpus/nexus/contract.md` | Nexus是conformance corpus，不是Core模板 |
| mechanism/path/EPR/Skill/parity inventory | 机器Evidence | `ledger-owned` | nexus absorption ledger | counters必须typed/validated |
| historical absorption report | historical Evidence | `archive` | archive | 报告不能替代ledger/current main |
| Nexus特有路径、浏览器、locale、hardlink、SPECTRA/HALO | project values | `retain project-specific` | Nexus policy/profile/fixture | 通用机制提升到相应domain |
| unexplained delta、accepted parity、retirement | 完成条件 | `retain` | Nexus contract/ledger | 100%分类不等于全部吸收 |

## 测试与 CI 文档

| 旧材料/章节簇 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| unit/contract/integration/e2e职责 | 稳定验证 | `retain` | verification governance | 由证明对象和副作用分类 |
| affected/fast/slow/full与Quick/Risk/Release | 稳定反馈机制 | `retain` | verification governance +code contracts | 不是每次全跑流水 |
| exact suite/files/commands/timeouts/concurrency | 机器事实 | `code-owned` | test-budget/impact/CI/runner | 不复制到stable docs |
| performance SLO、结构性budget、采样协议 | 稳定测试方法 | `retain` | verification governance；exact数值由代码/Evidence | 单次duration不裁决 |
| resource scheduling、mutable workspace、cache | 当前实现算法 | `code-owned` | runner/tests | 提升稳定owner/receipt原则 |
| failure reuse、proof reset、trusted bootstrap | 稳定机制 | `retain` | verification +development | 同input不重复确定性失败 |
| historical exact run/SHA/failure | historical Evidence | `archive` | evidence/archive | 不回填active authority |
| `test-and-package-architecture.md`兼容stub | 失效历史入口 | `delete active/archive original` | archive | 不保留unregistered root document |

## 根 README、AGENTS 与导航

| 旧材料 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| README产品摘要、入口、status | 导航/产品投影 | `projection` | generated/verified from product+registry+main | 不拥有动态支持矩阵 |
| AGENTS行为路由 | Agent投影 | `projection` | Skills/agent registry | 不复制完整执行算法 |
| docs/README文档目录 | 生成导航 | `projection` | `docs/authority.json` | 手改漂移应失败 |
| 旧root文档正文 | historical | `archive` | archive | 不作为当前authority |

## `docs/work/**` 与 Work Package 历史

| 旧材料 | 分类 | 裁决 | 当前唯一 owner | 说明 |
| --- | --- | --- | --- | --- |
| current-state resolver配置/稳定Goal facts | current control | `retain` | live resolver contract | 不静态写当前SHA/PR |
| rolling-plan active+2–5候选 | current control | `retain` | A0/live plan | 不是永久backlog |
| active pointer path+digest | current control | `retain` | resolver | 不复制scope和tests |
| selected Work Package manifest | frozen execution contract | `retain until completion` | manifest +A0 | merge后归档 |
| old work snapshots/manifests | historical control | `archive` | archive/work-packages | 不参与current selection |
| 并行Work Package/Integration Queue字段 | 目标机制 | `proposal` | development governance/future resolver | 未实现前保持单formal active包 |

## 新 active corpus 的对抗审查结论

### 已通过的方向

- 历史编号和宽泛路径 fallback 被替换为自然领域 owner 与 exact registry。
- README/AGENTS/docs README 被收窄为导航/路由投影。
- archive 保留 latest-main历史 bytes，避免旧正文继续竞争 authority。
- Product、Semantic、Mutation、Runtime、Verification、Development、Brownfield 等领域已分开。

### 本后继分支修复的内容缺口

PR #197 内容重放：父 PR #196 已等价 replay #197 的 17-file 独有内容，其中 14 file 内容一致，3 file（roadmap exit-condition 去重、evidence ledger 更新）实际叠加。#197 已关闭为 superseded。

- 恢复 Product 的用户结果、适用范围、相邻系统和长期完成判据。
- 修复把整个 `.sec/**` 当作可删缓存的错误分类。
- 恢复 Fact/Assertion lifecycle、冲突、unknown和validated boundary。
- 恢复 Block lifecycle、Resolution、trust、Migration与single writer。
- 恢复 Brownfield完整inventory、Source Program Model、Provider contract、安全和MVP Gate。
- 恢复 Workbench多View、Inspector、Context freshness、Task/AI权限、HTTP安全和terminal UX。
- 将 Runtime稳定策略与具体Node/Bun/lease实现分离。
- 恢复 Compatibility、数据迁移、irreversible point、deprecation与retirement。
- 将 Verification当前强制不变量与未来Result/Ledger/Hermetic架构分离。
- 将 Development当前单包/manual-shadow规则与未来parallel resolver/Run Kernel分离。

### 尚需独立实现或由并行执行者处理

以下不是本文 authority，不在本分支越权修改：

1. PR #196 的现有 unresolved review findings和由此产生的新 exact head。
2. `docs/authority.json` 的 typed domain/audience/consumer/update-trigger vocabulary、executable binding、replacement edge和freshness模型。
3. Docs Doctor 对 archive demotion、code/Skill consumer存在性、generated review date、migration-ledger coverage和stable-content claim类型的更强验证。
4. Documentation Domain IR 的 raw/validated type、builder、revision、query和Mutation；当前 registry只是阶段性 authority。
5. Verification Result Truth、Execution Ledger、Evidence DAG、Hermetic Runtime、parallel Work Package resolver、Integration Queue和Development Run Kernel。
6. Target Profile、Type Algebra、Application/Behavior/Target Program IR、generic lowering与multi-language Provider实现。
7. 任何因父分支新 head而需要的rebase、conflict reconciliation、focused tests、trusted bootstrap、hosted Evidence和merge授权。

## 完成条件

本账本只有在以下条件同时满足时可被引用为 migration Evidence：

- 每个旧 active owner和独立章节机制都有明确分类、去向、唯一 owner与复核条件；
- 新 active正文不存在由本账本已识别的内容丢失、越级实现声明或第二事实源；
- archive保持historical身份；
- parent PR的代码/registry/docs-doctor和review问题由其owner闭合；
- successor candidate基于最终parent head重新对齐，并通过适用docs/contract/audit/Review/Evidence；
- merge后从新`main`复核active corpus、关闭Issue #173并归档active Work Package与本Evidence。
