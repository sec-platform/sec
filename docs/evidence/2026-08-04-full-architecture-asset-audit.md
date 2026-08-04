# SEC 全架构、全资产与全路线审计（2026-08-04）

> 性质：绑定 `main@335ffdbe1279e4284babf6f3133846970e7ac8ee`、1B-3 候选分支与旧 PR #266 过程分支的历史架构审计 Evidence。其 W/N/S 三轨与 Product Decision/Portfolio、基础设施饥饿保护等发现已由 `main@a91ac030` 重建的 `canonical-architecture-convergence-v1` 候选吸收；本文保留为审计记录，不拥有当前状态或长期路线。
> 本文件不拥有产品、架构、路线或当前状态；最终裁决必须迁入既有 canonical owner。

## 1. 审计目标

本轮不是再写一份总计划，而是回答四个问题：

1. SEC 最终理论、产品、编译器、Brownfield、Workbench、AI、Runtime、Verification、Release 与生态设计是否形成一个无冲突整体；
2. 当前仓库所有主要资产分别是什么、成熟到哪一层、由谁拥有、哪些只有设计没有实现；
3. 历史 Goal、Issue、Draft PR、Proposal、Skill 与当前 `main` 是否存在重复 owner、顺序冲突、过度前置或被替代结构；
4. 从当前真实状态到完整 SEC 终态，唯一产品主线、Workspace/Nexus 线、运行治理线和专用 Target 线应如何收敛。

## 2. 证据边界

### 2.1 已核验

- GitHub `main`、开放 PR/Issue、相关分支与 commit 关系；
- 当前 canonical 产品、架构、领域、Verification、Runtime、Development 与 Workbench 文档；
- Engineering IR、Semantic Frontend、Impact、Semantic Mutation、Workbench、CLI、Task Envelope、发布脚本、依赖和 Nexus ledger 的关键实现；
- Issue #132、#167、#175、#176、#188、#191、#193、#194、#205、#207、#215、#219、#221、#222、#224、#235、#237、#239、#244、#247–#265；
- PR #236/#240–#245/#250/#253/#254/#260/#266 与 1B-3 分支；
- 历史总 Goal 与文档系统 V4 中仍有效的 Nexus、Workspace Domain、产品化、外部能力与完成标准。

### 2.2 尚未物理核验

GitHub connector 不能代替本地 exact-tree 运行，因此本轮没有声称完成：

- `git ls-tree` 全 tracked-path 原始 blob census；
- untracked/ignored、submodule、LFS、release artifact 与本地 worktree 物理清点；
- `bun run docs:doctor`、`bun run audit:repository`、typecheck、test、browser、package 或 platform Gate；
- Nexus 仓库真实 checkout、EPR 29/29、Skills、entrypoints、public/deployed surfaces 与 parity 物理遍历；
- GitHub ruleset、CODEOWNERS、required checks、public visibility 和外部部署面的完整读回。

因此本文件是高覆盖架构/资产审计，不是“全资产物理无遗漏证明”。后者必须由 R3 Physical Observation 与 Nexus Conformance Track 机器执行。

## 3. 当前工程事实

### 3.1 主干与活动候选

- `main`：`335ffdbe1279e4284babf6f3133846970e7ac8ee`，已包含 Verification 1B-1、1B-2。
- 1B-3：`fix/verification-writer-profile-v1`，相对 main 一个 commit，已补真实 SM-3 unit/Playwright acceptance fixture 与 manifest scope；尚未发现正式 PR、物理 Gate、Review 或 merge Evidence。
- 1B-4：尚未从新 main 建立正式候选。
- PR #266：`docs/canonical-architecture-convergence-v1@133ff889555b79820587505dc95ac63c1f030037`，Draft、mergeable，无 CI run，13 个文档/registry/Evidence 文件；不拥有当前 control plane。

### 3.2 开放候选栈

除 #266 外，开放 Draft 主要是：

- 文档栈：#236 → #243；
- 安全/Agent 栈：#245 → #250 → #253 → #254；
- Verification 后继：#240、#242；
- Release：#241；
- Formatting：#260。

这些分支多数基于旧 `main@6cc3bf8` 或旧 stacked branch，未完成当前主干 tests/Review/Gate。它们不是“等待合并的功能包”，只能作为设计来源，由新路线按真实 consumer 重新提炼。

## 4. 全资产分类与成熟度

成熟度使用：

```text
D  只有设计/权威
C  有合同或局部实现
I  已进入 main 的真实实现
P  有物理验证
S  产品支持
```

### 4.1 产品与长期权威资产

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| `docs/product.md` | D | 产品边界强，PR #266 已补 Brownfield / generation 双主链 |
| `docs/system-architecture.md` | D | 分层和单写者强；需加入全资产 Domain/Nexus convergence 的明确位置 |
| `docs/roadmap.md` | D | R0–R16 主脊正确，但当前遗漏显式 Workspace/Nexus/专用 Target 轨道 |
| `docs/authority.json` | I | registry v1 已有唯一 owner 与生成导航；proposal lifecycle v2 未进入 main |
| 领域 docs | D/C | 语义、Impact、Mutation、Brownfield、Target、Runtime、Verification 设计总体成熟 |

### 4.2 Canonical Engineering Semantic Kernel

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Entity / Fact / Assertion | I | 真实类型、identity、authority、provenance 与 validated boundary |
| Semantic Contract | I | State、Operation、Policy、Permission、Effect、Scenario、Acceptance 已存在 |
| Responsibility entity | I/C | Entity kind 已存在；稳定 reconstruction/adoption 尚未实现 |
| deterministic revision / deep freeze | I | 真实实现；canonical comparator 仍需统一 code-unit 规则 |
| Semantic Frontend | I | 读取 plan/lock/block/contract/policy 等声明输入；不是 Source Program frontend |
| Projection / Explain | I/C | 有真实 projection，但对任意工程的 source-grounded coverage 未证明 |

核心裁决：R1 不是空壳，但当前主要是声明驱动 Engineering IR；不能扩大成“已理解任意 TS 工程”。

### 4.3 Physical Workspace / Source Program / Brownfield

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Brownfield 五阶段设计 | D | Attach → Lift → Reconcile → Adopt → Normalize 正确 |
| Source Program Model | D | 未找到正式类型、producer、validator、revision、query 和 product ingress |
| repository physical inventory | C | 有 repository audit、Git census 等开发工具，但尚不是产品级 Physical Workspace Domain |
| Language Provider | D/C | ts-morph/TypeScript 被 compiler 使用；未形成 Source Program Provider 合同 |
| Responsibility reconstruction | D | Issue #224 设计成熟；无正式 product producer |
| 外部 Brownfield proof | D | 没有两个无关外部 TS 仓库的 Attach/Adopt/Mutation/Normalize 证据 |

这是当前最大产品断层。

### 4.4 Delta / Impact

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Fact Delta | I | 有真实 canonical producer |
| Impact propagation kernel | I | 有 fixpoint、witness、certainty、unknown frontier 框架 |
| active propagation rules | C | 主要只有 IMPLEMENTS、DEPENDS_ON、REQUIRES、LOWERS_TO、VERIFIED_BY |
| state/effect/permission rules | D | READS/WRITES/MUTATES/OWNS/PERFORMS_EFFECT/REQUIRES_PERMISSION 等仍 unknown |
| predicted vs actual calibration | C/D | Mutation 有调用面，但没有外部真实 corpus 的 precision/recall/omission proof |
| Test Impact | I/C | affected trust boundary 已修；完整 Semantic Test Impact Graph V2 未实现 |

框架正确，关系覆盖不足。不能用“Impact 引擎存在”代替 Self-Impact 成立。

### 4.5 Operation / Semantic Mutation

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| plan/apply transaction | I | lease、CAS、journal、staging、Verification、publish、readback、rollback/recovery 均有真实实现 |
| operation registry | C | 当前主要只有 `add-state-transition` |
| terminal truth | I/C | accepted/rejected/rolled-back/recovery-required 设计强；Verification legacy classification 尚在 1B-4 |
| Workbench operation | C | 当前 `applyViewMutations` 仍直接修改 app plan，是 legacy product path，不是完整 semantic operation |
| Brownfield governed-source mutation | D | 尚无真实 Source Program/Adopt owner 支撑 |

Semantic Mutation 是当前最强资产之一，但它领先于通用 Observation/Responsibility/Impact 输入。

### 4.6 Target Compilation / Generator

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Target Profile / Type Algebra 设计 | D | 设计成熟；完整机器实现未证明 |
| Application IR | D | 未找到正式 active implementation |
| Behavior IR | D | 未找到正式 active implementation |
| Target Program IR | D | 未找到正式 active implementation |
| current semantic lowering | C/I | 有少数 operation/generator lowering，例如 state-transition map |
| generic TS lowering | D/C | 仍有 reference-product、Customer/Ticket、Next/React/Prisma 绑定 |
| Task Envelope | C | 当前是 Slot fill envelope，且硬编码 Customer 测试 |

不能先批量实现三层 IR 空壳；必须以真实 Artifact owner 迁移逐层证明。

### 4.7 Workbench / CLI / AI 产品面

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| CLI command surface | I | 命令很多：init/add/resolve/compose/adapt/verify/workbench/semantic 等 |
| command breadth | C | 命令存在不等于通用产品闭环；多项仍消费 reference plan/model |
| Workbench views | I/C | 有 architecture/scenario/state 等 projection |
| Workbench write path | C | legacy view mutation 与 Semantic Mutation 并存，需 consumer cutover |
| Context Packet / Task Envelope v2 | D | 当前 Slot envelope 不能代表最终 Operation Envelope |
| AI bounded operator | D | 权限理论成熟，真实 product adapter/operation ingress 未闭合 |

### 4.8 Verification / CI / Test Runtime

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| five-state Verification Result | I | 已进入 main |
| owning environment / order lattice | I | 1B-1 已进入 main |
| Acceptance Coverage | I | 1B-2 已进入 main |
| writer profile / no-policy / no-test truth | C | 1B-3 候选，未物理收口 |
| Mutation classification | D/C | 1B-4 未进入 main |
| CI Evidence V4 | D/C | #242 为旧 stacked Draft；不是当前事实 |
| Execution Ledger / Evidence DAG / Run Journal | D | 不应在产品主线前完整建设 |
| Hermetic resource runtime | C/D | 多处局部实现，尚无统一 product contract |
| Playwright | I | 有真实 browser value，但当前过度进入公共 runtime/fixture 路径 |

完成 1B-4 后必须停止无限 Verification 元模型扩张，除非出现当前产品纵切片的 P0/P1 真值 blocker。

### 4.9 Development / Agent / Skill

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| thin AGENTS router | I | 正确方向 |
| 17 Skills | I/C | 有 inventory/contract tests；Workflow/Role/Facet/State 混合、正文重复、部分过期 |
| Agent profiles | C | 与 Skill 正文重复，architecture reviewer 历史路径问题尚未在 main 修复 |
| Work Package/control plane | I | 强治理、single writer、readback 已真实存在 |
| V3 parallel resolver | I/C | 合同进入 main，但 #207 指出 relation/epoch 语义仍不完整 |
| Task Capsule/Change Closure/Selector | D | Issue 设计很多，不能先建完整平台再找 product consumer |
| Agent Operation System v2 | D | Role → Operation Envelope → one Primary Skill → machine services 方向正确 |

### 4.10 Runtime / Dependency / Provider

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Host/Toolchain/Target/Provider 分离设计 | D | 设计正确 |
| root package | I | 仍混合 Compiler、Next/React、Playwright、GitNexus、Workbench、release tooling |
| Node public host | D/C | Issue #167 完整；当前 root Toolchain 仍 Bun-centric |
| Browser Provider | C | Playwright 能力真实，但还不是干净 optional Provider |
| External capability ledger | I/C | 有 machine ledger；实际 Provider A/B 和 retirement 仍有限 |
| GitNexus/Graphify | C | 只应作 Evidence Provider，不应成为每任务常驻前置 |

### 4.11 Release / Public / Operations

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Release/Support 设计 | D | 成熟度分层正确 |
| current public publisher | I（危险） | live worktree copy、新历史、force-push，必须尽快删除网络写入 |
| release workflow | C | #241 证明 credential path仍有旧 blocker，候选基于旧 main |
| public collaboration boundary | D/C | #244/#245 有重要设计与候选，但不应带动全知识/Review栈 |
| deployment/operations | D | 应在真实 package/deployment consumer 后实现 |

### 4.12 Nexus / Workspace Domains / Product Decision

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Nexus corpus contract | D/C | 有正式 corpus contract |
| Nexus absorption ledger | C | 当前 `census-required`，baseline null，EPR 0/29，counts 未建立 |
| Repository Domain | D/C | 开发工具有局部实现，产品 Domain 未闭合 |
| Documentation Domain | I/C | registry/docs-doctor 已接近产品原型，但仍主要服务仓库治理 |
| Workflow/Gate Domain | D/C | 有 CI contracts，但无统一 Workspace product domain |
| Agent Operations Domain | D | Skill system尚未 productized |
| Release Domain | D | 尚无结构化 product snapshot/promotion |
| Evidence Ledger Domain | D/C | 多种 Evidence 合同存在，统一 domain 未实现 |
| Product Decision / Portfolio | D | 历史 Goal 明确要求；PR #266 当前未显式放入路线 |

#266 的最大遗漏是把这些资产压成“有 consumer 时激活”的一句横切规则，且没有 Nexus 无遗漏阶段。

### 4.13 Web、更多语言与专用 Target

| 资产 | 当前层级 | 结论 |
| --- | --- | --- |
| Web frontend architecture | D | Issue #222 已定义 HTML/CSS/DOM/template/browser 分层，未进入根路线显式轨道 |
| additional languages | D | R16 有概念，但需 Frontend/Source Analysis/Backend/Build Runtime/FFI 五件套 |
| hardware target | D | 长期合理：Engineering semantics → hardware IR/RTL → synthesis/place-route/timing feedback；不能当前抢占 TS 主线 |
| mobile/native/kernel/driver/crypto/ML/data lineage | D | 应作为 specialized target/provider families，在 TS + release 基础后进入 |

## 5. 设计 Review 总结

### 5.1 应保留的第一性不变量

- `main` 唯一正式事实；
- Authority / Canonical / Evidence / Projection 分离；
- stable Entity/Fact/Assertion identity；
- Responsibility 不是函数/文件/Block；
- unknown/ambiguous/conflict/opaque 显式；
- single writer per canonical object/resource；
- Brownfield 与 generation 共用 Engineering Semantic Model；
- predicted 与 actual Delta/Impact 分离；
- Operation 独立于 Caller，权限是交集；
- Mutation 统一 lease/CAS/journal/Verification/publish/recovery；
-未运行/unsupported/stale/invalidated 不得 PASS；
- Target、Host、Toolchain、Provider、Runtime、Distribution 正交；
- AI/Workbench/Provider 只提交 proposal，不扩大 authority；
- 新 owner 必须迁移 consumer 并退役旧路径。

### 5.2 必须修正的设计

1. **单线 roadmap 过度压缩产品全貌**：主脊正确，但必须增加 Workspace Domain、Nexus Conformance、Specialized Target 三条受约束轨道。
2. **Nexus 不可被两个外部 TS 演示替代**：它承担全 workspace 资产、EPR、Skills、entrypoints、public/deployed surfaces、parity 和 retirement 的无遗漏证明。
3. **Product Decision / Portfolio 缺明确归属与路线**：不能永远停留在历史 Goal。
4. **Issue 图仍是旧路线**：#132/#175/#167/#191/#205 等大量 Program必须在新 roadmap进入 main 后重算 disposition；Issue存在不是自动后继。
5. **基础设施饥饿保护要成为路线规则**：完成一个基础设施包后，除非 P0/P1 blocker，至少推进两个直接产品能力包。
6. **Skill V2 不应现在完整落地**：先修两个确定性过期点和 minimal #245；完整 Operation Compiler延后至真实 product artifacts。
7. **Workspace Domain promotion 应使用成熟度阶梯**，不是 read-only domain 也必须先拥有 mutation/recovery 才能存在。
8. **专用目标必须晚于 TS 基线**：Hardware/Web/Native 等可以提前只读 corpus/architecture，但正式实现由真实 consumer驱动。

### 5.3 应拒绝的路线

- 把所有开放 Draft 按依赖链逐一合并；
- 1B-4 后自动进入 #216 → #207 → #178 → #179 → #189；
- 先建完整 Knowledge Closure、Practice Corpus、Review Finding、Evidence DAG、Run Kernel，再做产品；
- 先实现全 Application/Behavior/Target Program IR，再寻找 Artifact consumer；
- 用更多 Governance 文档、Skill、Issue 数量代替 Source Observation/Brownfield 证明；
- 以 Nexus ledger 文件存在或计数模板存在宣称 Nexus 已吸收；
- 让 Playwright/Next/React/GitNexus继续成为所有 Core 变化的默认闭包；
- 用公开镜像 force-push 或 live worktree copy当发布。

## 6. 严重度排序

### P0

当前未发现已证明会立即破坏 main 数据或授权的 P0；但本轮没有执行物理 Gate，不能据此声明无 P0。

### P1

1. 1B-3/1B-4 未收口时，Verification full-runtime/Mutation classification 仍不是最终真值。
2. `scripts/publish-public.ts` 保留 live-tree + force-push 网络写入口。
3. Task Envelope 仍硬编码 Customer/Ticket tests，直接破坏 Core 反特化。
4. Source Program Model、Responsibility reconstruction 与关键 Impact rules 缺失，导致产品通用性未成立。
5. Nexus ledger 仍是空 baseline；全资产/无遗漏目标没有任何现实完成证据。
6. #266 缺 Workspace/Nexus/Specialized tracks，却把自身描述为 complete convergence source。

### P2

- canonical comparator 使用 `localeCompare` 的表面仍需统一；
- root dependency/package boundary 过宽；
- Workbench legacy view mutation需迁移；
- 17 Skills 与 Agent TOML重复；
-开放 Issue/PR 大量过期依赖和 completion wording；
- Release credential、Draft status projection、Formatting、CI pinning 等维护债务；
- Workspace Domain proposal和Run Kernel proposal尚未完成 lifecycle retirement。

## 7. 修正后的全路线

完整路线由一条产品主脊与三条受约束轨道构成。轨道不是平行 authority，也不能任意抢占主脊。

### 7.1 产品主脊 P

```text
P0  当前 Verification 真值收口
P1  Canonical Architecture Convergence
P2  最小安全/破坏性入口收口
P3  去业务特化
P4  Physical Workspace Observation
P5  TypeScript Source Program Model
P6  Responsibility Reconstruction / Reconcile / Adopt
P7  Semantic Delta / Impact
P8  Operation / Authorization / Planning
P9  Controlled Mutation
P10 Brownfield Adoption / Normalize
P11 Target Profile / Type Algebra
P12 Application / Behavior / Target Program lowering by real consumers
P13 General TypeScript Engineering Compiler
P14 Workbench / AI Semantic Operator
P15 Agent Operation Compiler / Run Kernel
P16 Release / Deployment / Operations
P17 Registry / Ecosystem / Additional Languages
```

### 7.2 Workspace Domain 轨道 W

由产品 consumer 激活，成熟度逐级提高：

```text
W0 inventory
W1 raw + validated identity/revision
W2 query/projection
W3 Delta/Impact
W4 governed mutation
W5 migration/compatibility
W6 fault/recovery
W7 product-supported
```

推荐依赖：

```text
P4 → W-Repository
P1/P4 → W-Documentation
P2/P7 → W-Workflow/Gate
P14/P15 → W-Agent Operations
P16 → W-Release
P2/P7/P16 → W-Evidence
P14/P16 → W-Product Decision / Portfolio
```

任何 Domain 可先到 W1/W2 提供只读价值，不要求先实现全部 mutation/recovery；但不能以只读 inventory宣称整个 Domain 产品化。

### 7.3 Nexus Conformance 轨道 N

N 轨道可以只读并行，但正式 Adopt/Normalize必须消费 P/W 主链：

```text
N0 exact repository/artifact census
N1 path classification 100%
N2 mechanism decisions 100%
N3 EPR 29/29 + current Skills + entrypoints + public/deployed surfaces
N4 Workspace Domain bindings
N5 accepted semantic/diagnostic/effect/failure parity
N6 consumer migration + shadow/readback
N7 retirement / unexplained delta = 0
N8 full Attach → Lift → Reconcile → Adopt → Normalize proof
```

Nexus 完成门保持：

```text
unclassified = 0
undecided = 0
missing parity = 0
unexplained delta = 0
unauthorized retirement = 0
```

### 7.4 Specialized Target / Provider 轨道 S

```text
S0 corpus + architecture only
S1 Physical inventory/provider contract
S2 Source Program provider
S3 cross-artifact Impact
S4 governed mutation
S5 deterministic lowering/round-trip
S6 physical runtime/target acceptance
S7 supported target/profile
```

顺序建议：

1. Web frontend artifacts：HTML/CSS/DOM/TSX/Browser；
2. Node/Bun/Edge/Worker/Service target families；
3. database/persistence/deployment providers；
4. mobile/native/desktop；
5. systems/kernel/driver/embedded；
6. hardware IR/RTL/synthesis/timing feedback；
7. cryptographic/formal/high-assurance targets；
8. ML/data-pipeline/model-lineage domains。

正式 S-track 不能改变 R1 Engineering Semantic authority，也不能在 TS 主脊未闭合时建立第二 compiler core。

## 8. 立即执行顺序

### A. Verification closure

1. 完成 1B-3：真实 SM-3、focused/affected/typecheck/docs/audit/Review、trusted-base manual bootstrap、merge/readback。
2. 从新 main 建 1B-4：isolated runner core/wrapper；nonzero + invalidated/unsupported/not-run → blocked；canonical failed + nonzero → failed；仅 canonical passed + zero 成功。
3. 关闭 Issue #215、旧 #234 linkage，并清理被替代 Verification candidate。

### B. Architecture convergence

4. 从 1B-4 后的新 main 重建 PR #266。
5. 将本审计发现的 W/N/S 轨道、Product Decision/Portfolio、基础设施饥饿保护正式迁入 product/system/roadmap。
6. 运行 docs doctor、authority/consumer/cycle census、repository audit、独立 Review；squash merge/readback。
7. 重算 `docs/work/**`；旧 `#216 → #207` 队列失效，不能自动执行。

### C. 最小安全收口

8. 删除 `scripts/publish-public.ts` 网络发布与 `package.json` `publish`；保留未来 exact-tree read-only readiness preflight 需求。
9. 从 #245 只提炼 external-text metadata boundary、candidate reviewer isolation、过期 reviewer path修复；不带入 #250/#253/#254 全栈。

### D. 产品通用性首闭环

10. 删除 Task Envelope Customer/Ticket硬编码；从 Acceptance、Impact、test ownership派生 tests。
11. P4 Observation V0：SEC 自身 + 三个无关 TS fixture 的 exact physical inventory。
12. P5 Source Program Model 分三层：
    - file/module/symbol/span/import/export/definition/reference；
    - type/call/reference candidate/ambiguity；
    - state/effect/error/permission/framework candidate。
13. P6 在 SEC 三个不相关子系统重建 Responsibility；Reconcile并 Adopt 一个区域。
14. P7 增加 READS/WRITES/MUTATES/OWNS/PERFORMS_EFFECT/REQUIRES_PERMISSION/scenario/acceptance rules，并以 predicted vs actual/full校准。
15. P8 为一个真实 Authoring Source建立 Operation/Auth/Plan。
16. P9 修改真实 Semantic Contract，而非任意 TS 常量；完成 CAS、journal、actual Delta/Impact、Verification、rollback、readback。
17. P10 在两个无关外部 TS repo重复；至少一个 governed mutation、一个 Normalize。

### E. 编译生成与产品面

18. P11 Target Profile / Type Algebra只实现真实 consumer所需组合。
19. P12 用一个真实 Artifact owner逐步迁移 Application/Behavior/Target Program层；每层有合法性、oracle、source map和退役旧 writer。
20. P13 三个无关业务模型、一个 Governed Extension、正负/失败/upgrade/round-trip完成 generic TS compiler proof。
21. P14 Workbench/CLI/AI全部消费同一 Operation facade；退役 legacy view mutation旁路。
22. P15 再实现 Agent Operation Compiler、one Primary Skill、typed transition、Run Kernel；真实管理 P4–P14 产物。
23. P16 exact tracked-tree package/release/deployment/rollback/operations。
24. P17 Registry、多语言和 Specialized targets按 S-track扩展。

## 9. 优先级与饥饿保护

- P0/P1 integrity、安全、数据/源码破坏、错误 merge authority可以打断产品主线。
-普通维护、知识摄取、Review 平台、完整 Run Kernel、完整 Evidence DAG、完整 Integration Queue不能自动前置。
-每完成一个非 P0/P1 的基础设施包，接下来至少完成两个直接推进 P4–P14 的产品包，除非新 Evidence证明产品被真实阻塞。
-只读 Nexus census、Provider research、architecture corpus可以并行，但不能成为“已经推进产品”的替代计数。

## 10. 结论

SEC 的理论内核和大量可信机制是真实资产；当前失败不是“工程全错”，而是：

```text
可信治理/transaction/verification资产较强
>
通用 source observation / responsibility / impact / product operation资产
```

正确路线不是删掉治理内核，也不是继续扩建治理平台，而是把现有可信内核用于证明：

```text
看见真实工程
→ 恢复可证责任
→ 计算真实影响
→ 执行受控操作
→ 在外部 Brownfield 与 Nexus 全资产上证明无特化、无遗漏、可回退
```

PR #266 在吸收 W/N/S 轨道和完成物理审计前，必须保持 Draft，不能再描述为“complete canonical convergence”。
