# Gift103：跨域语义解释、纯计划与 TypeScript 目标生成——有限真实样本（历史研究说明）

本文记录一个**演示性解释器和目标发射器的有限实验**，不是现有 SEC/Gift 生产 Compiler Kernel，也没有网络、支付、数据库、真实授权、持久化结算或设备控制能力。它验证的是：**新业务 Definition 可以不修改业务分派代码，经共同的语义解释与可复用方法生成真实可运行目标**，并且不能把政策、观察、候选计划、授权、操作发生与独立证据混成一种成功。

## 文件身份与单一作者来源

- `examples/checkout.module.json`：已有 `gift.author-module/1` 外壳的**订单履约**作者样本，包含状态、Policy、Observation、Effect 定义。
- `examples/device.module.json`：同一实验性语义 Dialect 的**设备告警**定义；解释器、生成器无第二业务专用分支。
- 对应 `*.request.json`：一次**运行输入快照**，非第二份作者语义。`*-simulation-trust.json`：明显标记 `SIMULATED_NOT_REAL_AUTHORITY` 的独立测试输入；不能当作实际支付回执、有效 Grant 或第三方证明。
- `cross_domain.py`：实际语义摘要只覆盖已解释内容，字段布局和显示名称不改变模型意义；原始作者字节摘要另外进入目标 manifest，不能以任何一方代替全部的 SourceSnapshot、ModuleUse 和 BindingLock。明确只解释 `gift.fixture.cross-domain` 精确选择符 `1`，严格校验声明形状、引用、状态、规则、观察与效果，返回**纯候选计划**。
- `emit_ts.py` / `target/plan-runtime.ts`：使用验证过的领域定义，确定性发射真实 TypeScript 分支与共享纯执行方法；目标源码保存到命令显式指定的**包外**目录，不重复保存于作者模块。
- `cli.py`：仅通过本地文件读取输入和 JSON stdout 返回候选；无现实操作。
- `tests/test_cross_domain.py` 与 `verify_targets.py`：精确正反例、不同领域同核、Python/TS 源码行为差异测试；它们不证明真实世界效用。

原有语义公共合同仍在[工程通用语义全域合同](../../../docs/20-语义与组合/共同语义/工程通用语义全域与闭合合同.md)，**八阶段与门槛**仍在[工程全生命周期八阶段](../../../docs/00-系统与原则/设计方法/工程全生命周期八阶段与准入合同.md)。这个 fixture 不增加全域 Core `kind`，也不发布新的独立作者格式。选择的方言还**没有正式锁定的外部语义包/资格**，因此即使 TypeScript 严格编译，也只能自证为有界示例方法。

## 实际命令

原实验运行条件为（只需要 Python 标准库；目标构建需要已安装 `tsc` 与 `node`）：

`cli.py` 允许以 `--simulation-trust` 展示可推导的变更计划；无模拟准入时会精确返回 `NEEDS_REAL_EVIDENCE_AND_GRANT`。成功演示的输出**始终**含：

```json
{
  "status": "SIMULATED_PLAN_ONLY",
  "realWorldAuthorization": "NOT_ESTABLISHED",
  "externalEffects": "NOT_EXECUTED",
  "externalSettlement": "UNKNOWN"
}
```

真实系统要把这些结论升级为执行，必须补：生产级固定 SemanticModule/锁、可信事实/Grant 验证器、可证明事务边界和恢复/幂等、可授权的 Operation、真实读回与独立保证；当前代码有意没有这个能力。若只是纯设计预览，可以安全在目前阶段停止。

## 有实际意义的反例与不支持范围

| 修改或异常 | 实际反应 | 为什么必需 |
|---|---|---|
| 输入冒称支付成功，但没有可信观察 | `NEEDS_ATTESTATION` | 不信任用户构造的 `untrustedClaims` |
| Policy 允许但没有当前 Grant | `NEEDS_GRANT` | 许可关系不能冒充实时权力 |
| 相同观察有冲突真值 | `CONFLICTING_ATTESTATIONS` | 不按照顺序默选“最新”真相 |
| 同一操作 ID 已处理 | `RECONCILE_OPERATION_FIRST` | 纯本地名单不证明外部效果处于何种状态 |
| 客户端旧 revision | `STALE_REVISION` | 不得用旧前像计划覆盖新状态 |
| revision 达 `uint64` 上限 | `REVISION_OVERFLOW` | 拒绝假增长、回绕或丢精度 |
| `(state,event)` 二义性 | 编译阶段 `AMBIGUOUS_TRANSITION` | 不能按数组顺序猜业务行为 |
| 无绑定或未知方言 | 拒绝 `UNSUPPORTED_DIALECT` | 不能把未知意义的 JSON 当已经得到的计算语义 |
| 设备“满足告警条件” | 仅生成 `sendAlert` 的未执行意图 | 软件计划不等于物理硬实时安全保证 |

目前没有：递归/层级状态、时间逻辑模型检查、租约、真实撤销、策略属性表达式、RBAC/ABAC 全模型、Provider 签名验证、租户权限隔离、数据存储、联合提交、真实外部请求、推送消息、硬实时设备 I/O、用户界面、Rust Target、官方 Schema/Dialect 注册和发布。另不提供带实际敌意 JavaScript Proxy/访问器对象的沙箱：TypeScript 纯计划入口要求可信解析的有界 JSON 输入。不能用原样本运行/测试推断这些能力已实现。

## 设计与产品接口关系

G2 有限语义定义、G3 明确跨域依赖与外部 Effect、G4 外壳/签名/失败合同、G5 有限 Python 解释器与 TS **纯计划**目标、G6 局部单元/差异验证分别有可检查产物。G5 的真实 Provider/Runtime、G6 的生产授权/安全/性能/部署资格、G7 的正式仓库采用与演进均没有凭本 fixture 达成；这些独立剩余工作持续列在[实施闭包](../../../docs/90-治理与参考/状态/实施闭包.md)。
