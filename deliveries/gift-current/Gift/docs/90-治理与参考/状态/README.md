# 当前前沿

本目录只汇总**会改变下一步行动的当前未决**。已闭合的问题不在这里保存第二份历史复述：其结论、边界、失败语义和重开条件由对应 canonical owner 直接拥有。旧问题编号、旧计划编号、分支名、PR、提交、聊天和历史包都不是当前设计身份，也不构成完成率。

所有“设计已定但仍缺代码、接入或现实证据”的当前工作统一见[当前实施闭包](实施闭包.md)。旧 `U###` 坐标已退出当前设计与 source package；需要审计旧编号时读取对应历史制品，当前排序、完成率与关闭判断只使用真实 owner 和实施闭包。

<a id="whole-project-frontier"></a>
## 全工程当前前沿

已采用的主链没有因此新增万能层；这是一项架构选择，不是对全部未知问题已排除的证明。跨 owner 冲突、接口缺项与有依据风险仍按实际对象检查和修复。出现新事实时先判断它落在哪一类；只有现有 owner 无法保持一个会反转合法性、语义、恢复或 Evidence 结论的区别见证，才重开公共设计。

| 前沿 | 何时存在 | 当前处理 | 什么能关闭 |
|---|---|---|---|
| 语义扩展 | 新需求具有现有 Standard Semantics 无法表达的可观察区别 | 先由版本化 `SemanticModule` / Dialect 承担，只影响相交消费者 | 语义、迁移、Target 映射和相交 Evidence 合同闭合；若仍需系统级新不变量再提 Kernel |
| 产品实现 | 合同已定但 producer/consumer、编译、运行、恢复或客户端尚未实现 | 在真实仓库从 exact main/candidate 实施，不再用更多设计文字代替代码 | 实现进入正式 owner，所需本地/集成 Gate 与读回成立 |
| 绑定与集成资格 | Provider、Target、VerificationMethod、宿主、SDK、ABI 或工具只完成发现/注册，尚未证明当前 binding 可用 | 固定准确版本、环境、能力、权限与 Evidence；发现不等于采用 | exact binding 的资格、失败/恢复与消费者符合性成立 |
| 经验与外部事实 | 性能、容量、时序、真实副作用、平台 bug、可访问性、实际用户效果、远端成本等不能由规范推出 | 只测会影响 Claim 的当前配置；复用仍适用的已有 Evidence | 取得绑定主体/环境/方法的可复核观察，或明确撤销相关承诺 |

<a id="compiler-kernel-implementation-frontier"></a>
## 编译与实现

- Gift 自身 compiler-kernel 的长期生产 owner 收敛到 Rust；若真实仓库仍有 TypeScript producer，其能力按逐项切换门禁接替，禁止“语言方向已定”代签迁移完成。
- 用户产物的 Target 与 Gift 自身实现语言正交。TypeScript 目标先形成可用闭环；Rust Target 已有开放 `TargetProfile` 设计，但真实 lowering、Cargo/rustc adapter、ABI、诊断、SourceMap、Artifact、运行宿主与符合性仍是实现工作。
- 增量查询、依赖闭包、并行调度、缓存、固定点、取消和资源预算已有公共合同；只有真实 producer/consumer、性能资格与恢复证据才能关闭实现前沿。
- 新语言、ABI、平台或封装通过开放 Target 生命周期接入，不新增中央 `TargetKind`；真实支持范围以当前 target revision、toolchain、provider 和 Evidence 为准。

<a id="developer-surface-frontier"></a>
## 开发者、Workbench 与 Graph

- 首个实现门仍是 AI/脚本 headless 闭环；人类主客户端目标采用 Code-OSS / VS Code Extension-first，但宿主选择不代签实现完成。
- Workbench 只能消费 canonical owner 的语义、权限、Operation、Evidence 与运行状态，不建立第二类型系统、第二配置真值或第二写者。
- Graph mutation 按 Operation kind 独立取得 `GraphMutationReadiness(kind, implementationRevision, providerSet)`；资格由 capability/Assurance 事实派生，客户端不保存独立“已解锁”真值。Connect/Disconnect 的成功、非法/陈旧拒绝、effect readback/恢复、owner 写回边界、CLI/客户端同义性和无旁路仍需真实实现证据。
- 调试、profile、trace、record/replay、浏览器 execution context、移动 install/process、设备 flash/boot、GPU stream/event/allocation 等均按真实 Provider 能力接入；名字、SDK 存在或一次成功调用不能代签完整能力。

## 执行、恢复与现实作用

- 多文件提交、外部作用、重试、取消、unknown outcome、补偿和 readback 的合同已明确；真实文件系统、VCS、远端服务、设备和 Provider 必须按其实际原子性/幂等性验证。
- UNKNOWN 不能当失败后盲重放；先按 durable Operation/Attempt identity 读回，再决定 join、恢复、补偿或新 attempt。
- 权限、凭据、撤销、秘密、配额和资源预算只由真实 authority/Provider/Execution owner 提供；模型输出、配置文件存在和客户端开关都不能签发权限。

## Assurance 与成熟能力复用

- 当前方法链为 Claim → ProofObligation → VerificationMethodSelection → Evidence → Verdict；VerificationMethod 是开放合同，不是固定测试枚举。
- 成熟语言、标准、ABI、库、算法和证明应先用于建立**保证下界与差异边界**，不要求为了“自己发现”而重做已有内部机制。多个独立成熟实现用来暴露共同机制、可选 capability、实现差异和隐藏前提；共同出现不等于规范保证。
- 只有当前绑定新增的可用性、性能、调度、平台缺陷、真实 Effect/readback/recovery、设备/网络/组织环境等事实必须实机取证。已有等价且仍新鲜的 Evidence 应复用。

## 文档与仓库

- 完整 source package 同时提供当前规范和[完整研究、案例与来源](../../../research/README.md)，并保留 SourceProfile 范围配置和许可；来源与用途在对应正文解释，当前包不含机械发布/查询工具；可重建导航、Unit locator、reader/audit 与 QueryIndex 均在包外按需生成。研究角色与规范 authority 分开；不以未采用、未成为 Claim 或文件增多为由移出有用资料。旧会话和重复历史规范不成为当前入口。
- 文档机械检查只验证包成员、链接/锚点、Contract Unit locator 和确定性派生；不通过字符串单元测试锁正文，也不把文档通过冒充产品符合性。
- 正式仓库的 `main`、开放 PR/Issue、CI、review 和真实 diff 只能在实施时从仓库重新读取。本离线包不保存其活动状态副本。

## 重开规则

只有以下事实之一出现，才需要扩展当前设计：

1. 现有 owner 无法表达一个可复现且会改变合法行为的新区别；
2. 两个现有 owner 对同一状态/权限/身份/恢复责任形成真实竞争 authority；
3. 现有合同在真实标准、成熟实现或实机反例下被证伪；
4. 新消费者要求稳定公共行为，而现有扩展协议无法在不修改不相交对象的情况下承载；
5. 安全、恢复、兼容或 Evidence 需要新的系统级不变量。

仅出现新行业、新产品名、新库、新目标语言、新客户端、更多文件或更多案例，不足以重开 Kernel。

## 已采用意图接合后的真实缺口

[意图投影/六工具扩展](../../80-开发者与接口/工具协议/意图发现与候选展开.md)、[可选语义](../../20-语义与组合/可选语义/README.md)、[源码/worker画像](../../70-工程系统与演进/实现与装配/源码分区与机器合同.md)已有明确设计owner；不再把缺作者发现入口与未实现能力混为一类。机器decoder/codegen、真实仓库映射、MIG切换、目标/Provider、Graph写入、运行故障/规模/安全及混合域资格仍需其真实证据，按[实施依赖与符合性](../../60-保证与证据/验收/意图覆盖与纵向符合性.md)关闭，不能用文字或资料恢复代替。

## 现行设计接缝的一次性入口

已采用支持子域的有型交接及可否证正常/异常结果由[全域接合检查](../../60-保证与证据/验收/全域接合检查.md#gift-closed-design-cross-domain-matrix)提供导航，各字段仍以表中链接到的原owner为准。本目录仅负责指出缺真实实现、资格或现实观察的剩余，不另复制同一套规范；新发现若确实推翻机制再重开唯一owner。

现行跨层机器合同、直接owner与未闭合实施资格统一查阅[通用工程合同责任导航](../../00-系统与原则/统一机器合同接合与原责任导航.md)；该导航不替代各规范正文，也不把示例Schema或静态测试认定为Gift产品已实现。
