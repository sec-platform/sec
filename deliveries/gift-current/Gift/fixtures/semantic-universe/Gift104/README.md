# Gift104：开放语义模块 + 限定 Method 资格 + 受管 TypeScript 目标（历史研究说明）

本文记录一个**范围明确的历史参考实验**，不是 Gift 已完成的生产 Semantic Kernel。它复用现有 `Gift103/` 解释器和 `Gift98/compiler/publish.py`，没有复制旧解释器、旧受管发布者、历史大块规范、未知来源 Provider 或构建缓存。

## 原案例的作者责任

原实验以 `examples/maintenance.module.json.definitions` 作为唯一作者源：`cd:*` 定义状态、策略、观察与效果计划，`guard:deadline` 规定可执行的时间窗口，`guard:capacity` 规定计量单位和所需容量；导出 Flow 的转换通过 `guards` 引用它们。没有新必选 `.gift` 或 `.intent` 语言；此处直接使用已存在的 `gift.author-module/1` JSON 外壳和精确的实验 Dialect。

本实例只模拟有界输入，另三个文件分别是 `maintenance.request.json`（运行请求）、`maintenance.simulator.json`（模拟策略/观察）和 `maintenance.guard-witness.json`（模拟时钟/资源读数），它们**不是**作者源码的重复定义，也不授权真实行为。

## 原实验环境与调用边界

原实验环境依赖 Python 3.11+、TypeScript `tsc` 和 Node 22；`verify_contracts.py` 还需预装 `jsonschema`。

原样本没有新的远程 runner、CI 工作流或线上依赖；原复验范围为本地隔离环境；这不构成当前执行请求。

## 原实验的文件责任

| 文件 | 唯一作用 | 禁止推论 |
|---|---|---|
| `engine.py` | 注册本地语义能力、解释输入、验证引用、保留模拟事实与需求失败 | 注册存在即目标能实现或生产 Grant 存在 |
| `methods.json` | 声明两个可筛选的纯计划 TS Method | 方法自称支持等于独立资格 |
| `target-implementation.json` | 记录准确的语义 kind 与目标消费者对应、代码形态及解释器/生成器/TS 运行库五处源码摘要 | 声称能力或 SHA 匹配就证明第三方语义正确/最快 |
| `emit.py` | 选择合格候选、生成真实 TS、复用旧受管 Reconciler | 代码生成即发布部署或外部效果发生 |
| `target-guard.ts` | 由 TS Target 执行时间和容量合同的有限模拟解释 | 真实环境时钟可信或容量已占用 |
| `verify_targets.py` | 三个领域 × 两种生成方法，跨语言对照正反例 | 所有行业、环境、资源规模都已验证 |
| `schemas/` | JSON 文档外层形状的辅助契约 | schema 可代替语义引用检查和现场保证 |

完整工程接口及 G0—G7 阶段权限门禁由 [原规范 Owner](../../../docs/70-工程系统与演进/实现与装配/开放语义模块与方法资格接口.md)维护，本文只是历史实验的机制与范围说明。

## 有效边界和保留问题

新 Guard 种类可通过本地 Registry 注册，不需为业务重写基础状态机；但尚无对应准确 kind 的 TS Target 方法时会被资格 Gate 拒绝，不能借用已登记的 Target capability 名称绕过。Method 更换不改变 `semanticRevision`，只影响目标 `index.ts` 与方法锁。生成目录有人手修改、未知日志或符号链接时不覆盖；受管发布仅在本地单写者可信条件下经过验证。

UTC 采用可规范比较的 1970—2100 年秒级字符串；真实物理时钟漂移、资源先读后被并发使用、租约与预留原子性都**尚未实现**。模拟的 `guardEvidence=SIMULATED_ONLY`、外部 `NOT_EXECUTED` 和 `NOT_ESTABLISHED` 必须原样保留。没有真实支付、设备控制、数据库、跨进程原子事务、可信 Provider/Grant、独立 Assurance、真实 Workbench、Rust Kernel 或生产级 Rust Target。

## 原单库效果实验与纯计划的独立范围

该目录后来在**现有参考代码上直接扩展**，而非创建新的竞争规范或新的 Gift 作者语言。原实验新增的 `local_effect.py`、`local-target-implementation.json`、两个 JSON 作者实例、`tests/test_local_effect.py` 和 `verify_local_end_to_end.py` 构成一个**本地 SQLite 单库**受检 Method。它与既有的两个 TypeScript 纯计划 Lowering 共享 `compile_author()` 的作者语义，但消费端、事实证据等级、准入和效果结算完全独立。

`--out` **必须是尚不存在的新目录**；验证器不会递归删除用户旧文件。运行器把派生的 `*.ts/*.js/*.d.ts` 和本地 `*.sqlite3` 写到该包外目录，源包不运输数据库、索引或编译缓存。原实验要求预装 Node、`tsc` 和 Python 的本地环境，不会远端安装依赖或调用云服务。

### 开发者与真实执行分别控制什么

开发者只在 `examples/local-reservation.module.json` 或 `examples/local-course.module.json` 中描述需要的状态、政策、容量阈值和 `reserveOneCapacityLocally` 效果种类。该效果种类**明确约定恰好扣减 1 单位**，容量守卫 `atLeast` 只表示提交前最低剩余量，不表示扣减量。更复杂的预留、扣款或设备行为必须提供另一种语义明确、确有实现的 Method，不得自动套用。

测试签发者在测试脚本内部生成签名 Grant；真实产品必须由独立受信的组织授权/撤销服务签发，绝不可将测试密钥、测试签发器或模拟观察提升为生产权限。`execute()` 会独立验签与核对范围，再读取**受信本地数据库**中的当前状态/容量，执行 deny-first Policy，拒绝无真实观察资格的转换。`readback()` 以授权绑定的 operation identity 查询既有 receipt。源码生成器的 `SIMULATED_PLAN_ONLY` 与 local commit 的 `LOCAL_COMMITTED` 是**两个独立的保证范围**。

### 实际方法适用条件与尚未支持的对象

适用：同一可写本地 SQLite 数据库、可信本机进程及其文件目录、测试级固定发行者密钥和本机 UTC 时钟、单资源行原子变化、无现实 attestation 依赖、已登记的 `guard:capacity`（可带来源恰为 `fixture-utc-clock` 的 `guard:deadline`）。提交前故障回滚；SQLite 提交后响应丢失按 receipt 做操作读回；重复操作不会再次扣减；不同操作针对旧 revision 的竞争由数据库事务串行化后拒绝。

不适用：实际付款、发通知、设备写入、外部数据库或跨进程/跨服务资源事务；真实密钥隔离/撤销，受攻击目录中的 SQLite 文件隔离；不可信时钟、独立事实取证、故障域外的 exactly-once、分布式一致性、真实硬件断电耐久及安全审计。高并发和故障只在本地样本的具体用例范围得到验证。完整权责与生产闭包继续由 [运行效果 Owner](../../../docs/50-执行运行与观测/持久化与恢复/事务提交-外部效果与幂等交付.md)、[授权 Owner](../../../docs/50-执行运行与观测/权限与资源/授权与执行准入.md) 和 [实施闭包](../../../docs/90-治理与参考/状态/实施闭包.md)维护。
