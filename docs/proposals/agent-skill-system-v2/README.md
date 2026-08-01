---
title: SEC Agent Skill System v2
status: proposal
tracking: issue-228
exact-base: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
authority: none
---

# SEC Agent Skill System v2

## 一、裁决

SEC 不应继续把现有 17 个 Skill 逐文件补强。当前系统已经证明了 inventory、格式、路径覆盖和禁止捷径可以机器验证，但它把“唯一行为 owner”错误收缩为近似“一行为一个 Skill、一 Skill 独占一个行为”，导致同一工程生命周期的状态、权限、证据和停止条件散落在多份 prose 中。

V2 改为：

```text
AGENTS / canonical governance
→ Agent Role Profile
→ typed Agent Operation Envelope
→ exactly one Primary Skill
→ deterministic services / contracts / tools
→ typed outcome and next transition
→ Run State / Evidence / GitHub external facts
```

核心规则：

1. 一次操作只有一个 Primary Skill；不得叠加多个 Skill 来共同解释同一状态转移。
2. Role 拥有职责和可申请的权限上限；Skill 不是角色，也不能自授权工具、路径或 GitHub 动作。
3. Work Package、Candidate、Failure、Verification、Evidence、Integration 等状态由各自机器 owner 拥有；Skill 只消费和产生 typed references。
4. Impact、Gate selection、Evidence reuse、manifest parser、权限交集和 transition legality 必须由代码合同决定，不重复写入 Skill。
5. Context resume 是 orientation 的输入模式；trust-root bootstrap 是 integration 的 trust-migration 模式；task delegation 是 orchestration，不是 Skill。
6. Skill 使用渐进披露：frontmatter 用于发现，`SKILL.md` 只保留工作流闭包，详细 schema、示例和命令进入按需 `references/` 或受信代码。
7. 现有系统在正式迁移完成前仍是唯一运行事实；本目录只是 non-authority prototype。

## 二、证据与问题重建

### 2.1 当前有效成果

当前系统的以下成果必须保留：

- `.agents/skills/**` 有精确 inventory；
- frontmatter 和章节顺序有合同测试；
- tracked Markdown 和启发式运行面有 coverage；
- 强制禁止 hard reset、force push、跨 head Evidence 复用、候选自证和无条件关闭 Issue；
- repository orientation 与 full audit 已区分；
- exact-head Review、trust-root bootstrap、Gate custody、main readback 与 cleanup 均有明确概念；
- Skill 不应拥有产品算法、版本、动态状态或第二事实源。

### 2.2 决定性缺陷

| 重复控制语义 | 当前分布 | 后果 |
|---|---|---|
| snapshot / reload / resume | orientation、audit、A0、context-resume | 同一事实快照有多个 prose owner |
| Work Package / candidate / frozen | A0、work-package、worker、review、CI、trust-root | transition legality 依赖阅读顺序 |
| impact / Gate selection / reuse | worker、impact、CI、failure | 验证选择和重跑条件重复维护 |
| failure / proof reset | A0、worker、failure、context | 同一失败可能得到不同升级路径 |
| role / delegation | A0、worker、review、task-delegation | 角色身份和可复用工作流混合 |
| trust migration | CI、trust-root、review、A0 | trust-root 被表达为平行流程而非 integration mode |
| document/tool/provider governance | docs、toolchain、external、heuristic | 领域治理合理，但仍复制通用权限和停止规则 |

### 2.3 根因

根因不是 Skill 数量本身，而是五种对象未分层：

```text
role
operation
policy
state
evidence
```

现有 Skill 同时描述它们，导致：

- 修改一个状态机要同步多个 Skill；
- Agent 需要同时加载多个 Skill 才能得到完整规则；
- 一个 Skill 的“允许工具”可能与 Role 或 Task Envelope 冲突；
- 未实现的 Run Kernel 目标被 prose 模拟成当前状态；
- path coverage 证明文件被映射，却不能证明内部行为没有重复 owner；
- token 消耗随规则重复线性增长。

## 三、不可绕过的第一性约束

### 3.1 权威与事实

- `main` 是唯一正式产品事实。
- 动态运行事实来自 Git/GitHub、manifest、Checks、Review、Evidence 和未来 Run Journal。
- Skill 不保存 SHA、当前 PR、失败次数、当前 phase 或支持矩阵。

### 3.2 最小权限

最终可执行权限必须是交集：

```text
Role maximum
∩ Operation Envelope grant
∩ repository policy
∩ tool/provider capability
∩ current state transition
```

Skill 只能声明 `requiredCapabilities`，不能扩大该交集。

### 3.3 单一状态 owner

- work selection：selector owner；
- operation/capsule：Task Capsule / operation contract；
- package/integration：Work Package / Integration Epoch；
- candidate/failure：Epoch and Failure owner；
- verification：Verification Result owner；
- evidence/resume：Evidence DAG / Run Journal owner；
- resource cleanup：Hermetic Runtime / worktree hygiene owner。

Skill 不重建上述状态机。

### 3.4 一次操作一个 Primary Skill

同一 operation 不得同时绑定多个 Primary Skill。跨领域需求采用顺序 transition：

```text
orient
→ diagnose
→ design
→ implement
→ review
→ integrate
→ orient/closeout
```

领域治理任务同样先形成单一 operation，例如 `govern-toolchain`，需要架构变更时输出 `design-required`，而不是并发加载 design Skill。

### 3.5 失败显式化

每个 Skill 只返回有限 typed outcome：

```text
completed
blocked
unresolved
reconcile-required
design-required
implementation-required
review-required
integration-required
trust-migration-required
restart-required
no-change
```

自由文本只作诊断，不能驱动状态转移。

## 四、V2 分层架构

### 4.1 Universal Instructions

`AGENTS.md` 只保留始终适用的仓库不变量：

- main/live facts 优先；
- resolver 和 authority fail closed；
- Task Envelope / owned paths；
- 不自授权、不自证、不弱化验证；
- merge 后 main readback；
- machine-observable rule 下沉。

它不保存完整 Skill 列表、命令步骤、角色细节和动态状态。

### 4.2 Agent Role Profiles

Role 是执行者身份与权限上限，不是工作流：

| Role | 主要责任 | 默认写权限 |
|---|---|---|
| `sec-integrator` | 选择、协调、Gate custody、merge、closeout | control/GitHub；不写 Worker seam |
| `sec-worker` | frozen envelope 内实现 | branch 上的 granted paths |
| `sec-reviewer` | exact candidate adversarial Review | 无仓库写权限；只写 Review surface |
| `sec-auditor` | exact revision census / diagnosis | 只读；可写独立 Evidence artifact |
| `sec-maintainer` | docs/toolchain/provider/agent-system治理 | 仅对应 governance envelope |

角色可预加载明确 Skill 集，但每次 operation 仍只能激活一个 Primary Skill。子 Agent 不继承父 Agent 的 Skill 或权限，必须显式绑定。

### 4.3 Agent Operation Envelope

建议机器合同：

```ts
interface SecAgentOperationEnvelopeV2 {
  schema: 'sec-agent-operation-envelope-v2';
  operationId: string;
  exactMain: string;
  repository: string;
  target: {
    kind: 'repository' | 'issue' | 'work-package' | 'pull-request' | 'candidate' | 'failure';
    identity: string;
  };
  role: SecAgentRoleId;
  operation: SecAgentOperationId;
  primarySkill: SecAgentSkillIdV2;
  authorityReads: string[];
  authorityWrites: string[];
  pathReads: string[];
  pathWrites: string[];
  capabilities: SecCapabilityGrant[];
  trustClass: SecTrustClass;
  inputs: SecArtifactReference[];
  expectedOutputs: SecArtifactExpectation[];
  completionClaims: string[];
  stopConditions: string[];
  reloadIf: string[];
}
```

Envelope 由 trusted orchestrator/selector 签发。Skill 必须拒绝：

- role 与 operation 不兼容；
- primary Skill 不匹配；
- 缺少 required input；
- 请求工具或写路径不在 grant 中；
- exact main/target 已漂移；
- transition 不合法。

### 4.4 Deterministic Services

以下能力从 Skill prose 中移出：

| Service | 唯一职责 |
|---|---|
| repository snapshot resolver | exact main/target/worktree/GitHub snapshot |
| work selector | lifecycle-first 下一动作裁决 |
| Work Package / Integration resolver | scope、authority、path、resource、relation conflict |
| Change Closure compiler | producer/consumer/state/environment/trust/migration闭包 |
| impact selector | changed records → required/not-applicable/unresolved Gates |
| permission evaluator | Role ∩ Envelope ∩ policy ∩ provider |
| epoch/failure classifier | candidate phase、fingerprint、next action |
| verification aggregator | result truth、applicability、environment ownership |
| Evidence/Journal | reuse、resume、invalidation |
| publication/cleanup owner | commit/readback/receipt |

Skill 可以调用 service 并解释结果，但不能重写算法。

### 4.5 Primary Skills

V2 使用 11 个 Skill：

1. `sec-orient-work`
2. `sec-audit-repository`
3. `sec-diagnose-failure`
4. `sec-design-change`
5. `sec-implement-change`
6. `sec-review-change`
7. `sec-integrate-change`
8. `sec-govern-documentation`
9. `sec-govern-toolchain`
10. `sec-govern-capability`
11. `sec-govern-agent-system`

前三至七构成工程生命周期；后四是职责自然闭合、权限与验收独立的领域治理 Skill。

## 五、操作生命周期

```text
UNBOUND
  ↓ sec-orient-work
ORIENTED
  ├─→ AUDIT_REQUIRED → sec-audit-repository
  ├─→ DIAGNOSIS_REQUIRED → sec-diagnose-failure
  ├─→ DESIGN_REQUIRED → sec-design-change
  ├─→ IMPLEMENTATION_READY → sec-implement-change
  ├─→ REVIEW_READY → sec-review-change
  ├─→ INTEGRATION_READY → sec-integrate-change
  └─→ GOVERNANCE_READY → one governance Skill
```

合法后继：

| Primary Skill | 合法后继 |
|---|---|
| orient | audit、diagnose、design、implement、review、integrate、govern、no-change |
| audit | diagnose、design、govern-agent-system、no-change |
| diagnose | implement、design、integrate、blocked |
| design | implement、govern-domain、blocked |
| implement | diagnose、review、reconcile-required |
| review | implement、integrate、blocked |
| integrate | orient、restart-required、blocked |
| govern-* | review、integrate、design-required、no-change |

不允许直接跳转：

- implement → merge；
- design → passed；
- review → product write；
- audit → giant fix branch；
- governance → 自行修改其他 domain；
- failure → retry without changed causal input。

## 六、权限与信任类别

```text
read-only
branch-write
trust-root-write
repository-control
external-control
```

### 6.1 read-only

orient、audit、diagnose、review 默认使用。可读取 Git/GitHub、authority、source、tests 和 Evidence；不可修改 branch 或控制面。

### 6.2 branch-write

implement 和普通 governance 使用。只允许写 Envelope `pathWrites`，所有发布动作绑定 expected head/base。

### 6.3 trust-root-write

修改 selector、verifier、Skill contract、docs doctor、workflow、Hook、permission 或 merge authority。候选不能自证，integration 必须进入 `trustMigration` mode。

### 6.4 repository-control

只授予 integrator 的 typed GitHub/control actions：创建/更新 PR、dispatch、merge、closeout、branch cleanup。Skill 本身不能获得此权限。

### 6.5 external-control

涉及网络、凭据、Provider 写动作、发布或外部服务。必须经过 capability ledger 和独立授权；外部工具输出不是 SEC authority。

## 七、Skill 文件结构

每个 prototype 使用开放兼容 frontmatter：

```yaml
---
name: sec-...
description: 精确说明何时触发和何时不触发
compatibility: SEC Agent Skill System v2 prototype
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: ...
  sec-risk: read-only | branch-write | governed
---
```

不使用 `allowed-tools`：工具预授权由 Host 支持程度决定，且 Shell/MCP 权限不能由 Skill 自行放大。

正文固定为：

```text
目标
触发
不触发
必需输入
权限边界
执行
输出合同
失败与转移
示例
资源
禁止
```

详细 schema、命令、枚举和平台矩阵引用 canonical code 或 `references/`，不复制进所有 Skill。

## 八、旧 17 → V2 迁移裁决

| 旧 Skill | V2 去向 | 裁决 |
|---|---|---|
| sec-a0-integrator | `sec-integrator` role + orient/design/integrate | 角色与工作流分离 |
| sec-architecture-evolution | sec-design-change | 改名并收窄为 design operation |
| sec-ci-and-merge | sec-integrate-change | 合并 Gate、merge、readback、closeout |
| sec-context-resume | sec-orient-work resume mode | 不再建立第二 snapshot owner |
| sec-documentation-governance | sec-govern-documentation | 保留领域闭包 |
| sec-exact-head-review | sec-review-change | 保留独立只读 Review |
| sec-external-capability-governance | sec-govern-capability | 保留领域闭包 |
| sec-failure-recovery | sec-diagnose-failure | 只拥有 diagnosis，不拥有 retry算法 |
| sec-heuristic-governance | sec-govern-agent-system | 扩展为 role/skill/operation治理 |
| sec-impact-and-validation | deterministic services | 退役为 Skill |
| sec-repository-audit | sec-audit-repository | 保留 full census |
| sec-repository-orientation | sec-orient-work | 吸收 resume |
| sec-task-delegation | role/orchestration contract | 退役为 Skill |
| sec-toolchain-and-dependencies | sec-govern-toolchain | 保留领域闭包 |
| sec-trust-root-bootstrap | sec-integrate-change trustMigration mode | 退役独立 Skill |
| sec-work-package-lifecycle | design/integrate transitions | 退役独立 Skill |
| sec-worker-development | sec-implement-change | 保留 branch-write实现闭包 |

没有有效责任被删除。被退役的是错误的表达层，不是工程约束。

## 九、为何不是更少或更多

### 9.1 不采用一个万能 Skill

万能 Skill 会重新混合角色、状态和权限，并使按需加载失去意义。其最强反例是“继续 SEC”同时可能是 orientation、diagnosis、implementation、review 或 closeout；单一大 Skill 无法在不加载全部规则的情况下裁决。

### 9.2 不保留 17 个

17 个不是天然错误，但当前拆分轴同时使用角色、阶段、领域和异常模式，正交性不足。继续补丁会扩大交叉引用而非消除重复。

### 9.3 不把每个 domain 都做成 Skill

Semantic IR、Compiler、Runtime、Mutation、Verification 等产品 domain 主要由代码合同和 authority 拥有。只有当 Agent 操作的 trigger、permission、tools、outputs 和 stop 构成独立闭包时才需要 Skill。当前四个治理 domain 满足该条件；普通产品实现统一由 implement Skill 消费 domain authority。

## 十、正式迁移路线

### Phase 0 — Proposal / Evaluation

- 保留本目录；
- 对 17 个 Skill 的历史任务进行 replay；
- 验证 route 唯一性、责任无遗漏、token/冲突减少；
- 不修改当前 runtime。

### Phase 1 — V2 Contracts（trust-root candidate）

建立：

- Role/Operation/Envelope/Outcome/Transition schemas；
- registry parser/validator；
- permission evaluator；
- route determinism tests；
- old→new compatibility projection。

此阶段可暂时保留旧 Skill 文件，但 V2 registry 不允许双 owner。

### Phase 2 — Agent Profiles + Prototype Skills

- 新增 role profiles；
- 安装 11 个正式 Skill；
- AGENTS 收窄为 universal policy；
- 旧 17 标记 deprecated，只作兼容路由；
- 所有运行仍需 base-side trust validation。

### Phase 3 — Cutover

- 删除旧 Skill、旧一对一 behavior contract和重复 prose断言；
- test-impact、docs doctor、repository audit和CI切换到 V2 registry；
- 运行 historical task replay、negative permissions、exact-head Review和manual bootstrap；
- new-main readback后 `TASK_RESTART_REQUIRED`。

### Phase 4 — Run Kernel Integration

- Operation Envelope、outcome、transition接入 Task Capsule/Run Journal；
- resume不再由 Skill重算内部 phase，而由 Kernel签发新的 orient operation；
- integration epoch成熟后允许多个 operation并行，但每个 operation仍只有一个 Primary Skill。

## 十一、评估指标

不能以“Skill 数量减少”证明成功。至少衡量：

- route uniqueness：同一输入是否只解析一个 Primary Skill；
- behavior coverage：旧 17 的所有有效责任是否有去向；
- prose duplication：状态、权限、Gate、failure规则重复次数；
- deterministic ownership：可机器判断规则是否全部下沉；
- permission safety：Skill 是否可能扩大 Role/Envelope grant；
- transition correctness：非法跳转是否 fail closed；
- resume determinism：相同外部事实是否得到相同 next operation；
- historical replay：历史 PR/失败/closeout 场景是否作出正确裁决；
- context cost：普通 operation 加载正文和 references 的 token；
- first-pass yield：迁移后已知遗漏是否减少。

## 十二、最强反证与反转条件

### 12.1 “多个 Skill 组合更灵活”

只有当组合由机器编排、冲突解析和权限交集决定时成立。让模型自行叠加 prose 会恢复旧问题。未来可增加 machine-owned middleware，但仍不允许多个 Primary Skill。

### 12.2 “A0/Worker/Reviewer 本来就是不同工作流”

它们首先是信任和权限角色。同一 Worker 可执行 implement 或 diagnose，同一 Integrator可执行 orient、design或integrate。把角色当 Skill 会复制角色权限并阻碍操作复用。

### 12.3 “Impact 很复杂，应该保留 Skill”

Impact 的困难来自图、identity、unknown frontier、applicability和Gate selection，这些都必须 deterministic、可测试和可复用。Agent只需调用 selector、处理 unresolved并解释 witness，不应通过 prose猜影响。

### 12.4 反转条件

若 historical replay 证明某个被合并责任具有独立 trigger、权限、状态转移、完成 Evidence和停止条件，且无法由 mode 或 typed input自然容纳，则恢复为独立 Skill。恢复必须基于失败语料，不以文件数量或主观偏好决定。

## 十三、非目标

- 本 Proposal 不替换当前运行时 Skill；
- 不实现 Task Capsule、Change Closure、Run Kernel、Integration Queue或Evidence DAG；
- 不声称 11 是永久固定数量；
- 不把外部 Agent Skills 规范提升为 SEC authority；
- 不自动给 Shell、MCP、GitHub或网络权限；
- 不用 Skill 修补产品架构或验证缺陷；
- 不让 prototype 干扰 PR #227 或当前 active Work Package。
