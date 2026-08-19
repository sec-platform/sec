# SEC 术语表

| 中文直觉 | English term | SEC 中的含义 | 常见误解 |
| --- | --- | --- | --- |
| 正式唯一标准 | Canonical | 其他模块必须以其为准的正式事实/状态 | 不是“只有一个物理副本” |
| 决定权 | Authority | 谁能定义或改变某类事实 | 不是“谁读取了它” |
| 投影视图 | Projection | 从 canonical truth 派生的特定视图 | UI/图/文档不能反向成真值 |
| 证据 | Evidence | 对现实执行或观察的可追溯记录 | 一次 PASS 不等于全局正确 |
| 声明对象 | Claim | Verification 要证明的精确命题 | 不等于自然语言“看起来没问题” |
| 实体 | Entity | 工程语义中的稳定对象身份 | 不等于 class/file |
| 事实 | Fact | 关于对象的结构化事实 | 不等于日志字符串 |
| 断言 | Assertion | 某个来源对事实的声明 | 不等于已被接受 |
| 责任 | Responsibility | 工程语义责任边界 | 不等于目录 |
| 能力 | Capability | 可被要求、实现、组合和验证的能力 | 不等于 npm package |
| 积木 | Block | SEC 中一种可复用能力/结构载体 | 不等于所有代码块 |
| 端口 | Port | 可连接的 typed semantic boundary | 不等于 UI 上一条线 |
| 槽位 | Slot | 允许受治理实现/扩展进入的位置 | 不等于任意插件逃生口 |
| 合同 | Contract | 必须满足的结构化约束 | 不等于自然语言承诺 |
| 实现解析 | Implementation Resolution | 从 requirement 到具体实现选择 | 不等于安装依赖 |
| 合格性 | Eligibility | 候选是否满足所有 hard constraints | 不能被性能分数抵消 |
| 实现绑定 | Implementation Binding | 已冻结的具体实现闭包 | 不等于包名 |
| 变化 | Delta | 前后状态的结构化差异 | 不等于 Impact |
| 影响 | Impact | 一个变化传播到的依赖/责任/验证范围 | 不等于 git diff |
| 工程操作 | Engineering Operation | 受治理的修改/动作请求 | 不等于任意脚本 |
| 验证 | Verification | Claim + Applicability + Evidence → Result | 不等于“跑测试” |
| 主机 | Host | 执行 SEC 的物理/运行时环境 | 不等于 Target |
| 工具链 | Toolchain | build/typecheck/package 等执行 Provider | 不等于产品 runtime |
| 目标 | Target | 要生成的程序/平台目标 | 不等于开发机 |
| 运行环境 | Runtime Environment | 目标程序最终运行的物理环境 | 不等于执行 SEC 的 Host |
| Provider | Provider | 提供可替换机械能力的实现方 | 不自动取得 SEC semantic authority |
| Adapter | Adapter | 隔离 Provider 私有机制与 SEC 合同 | 不是第二业务模型 |
| 未知 | Unknown | 当前证据不足以作正/负结论 | 不能偷偷按 false 处理 |
| 不支持 | Unsupported | 当前能力合同明确不覆盖 | 不等于失败，也不等于 PASS |
| 未执行 | Not-run | 本应执行但尚未执行 | 不能投影 PASS |
| 提议 | Proposal | 尚未取得 canonical authority 的候选 | Issue/AI 输出都可能只是 proposal |
| 成熟度 | Maturity | specified/implemented/verified/... 的现实层次 | 文档存在不等于 implemented |
| 收口 | Closure | 所需 owner/input/effect/evidence/terminal 等边界完整闭合 | 不等于“这个 PR 合并了” |