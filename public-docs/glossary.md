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
| 能力 | Capability | 可被要求、实现、组合和验证的能力语义 | 不等于 npm package、Block 或 Provider |
| 合同 | Contract | Capability/Operation 等必须满足的 owner-issued typed 约束 | 不等于自然语言承诺 |
| 端口 | Port | Implementation 层消费 Contract 的 typed connection point | 不等于 UI 上一条线或万能插件口 |
| 实现候选 | Implementation Candidate | 满足 Requirement 的一个完整具体实现 closure candidate | 不等于包名 |
| 实现解析 | Implementation Resolution | hard eligibility 后从合格候选中裁决具体实现 | 不等于安装依赖 |
| 合格性 | Eligibility | 候选是否满足所有 hard constraints | 不能被性能分数抵消 |
| 实现绑定 | Implementation Binding | 已冻结的具体实现闭包 | 不等于包名、Provider 名或当前 PATH |
| 分发包 | Distribution Package | 只有真实独立 distribution/trust/support/evolution 生命周期时才存在的物理分发载体 | 不等于每个 Capability 都必须有一个 Block/package 壳 |
| 分发绑定 | Distribution Binding | exact acquisition Requirement 到合格 distribution source/content 的绑定 | 不拥有业务语义或最终 Resolution |
| 旧 Block | Legacy Block | current/历史实现中的旧能力载体；仅在迁移 consumer 存在时保留 | 不是 target canonical Capability primitive |
| 旧 Slot | Legacy Slot | current/历史 schema 中的旧扩展槽；只允许 migration reader 有界解释 | 不是新的通用扩展机制 |
| 变化 | Delta | 前后状态的结构化差异 | 不等于 Impact |
| 影响 | Impact | 一个变化传播到的依赖/责任/验证范围 | 不等于 git diff |
| 纯计划 | Pure Operation Plan | 只由 definition/input/immutable observations/requirements 导出的零 Effect 计划 | 不包含 live Effect Grant、Provider handle、Allocation 或 deadline epoch |
| 准入执行 | Admitted Execution | exact plan 与 live Grant/Binding/Allocation/preimage 的交集 | 不重算业务 Definition |
| 工程操作 | Engineering Operation | 受治理的修改/动作请求 | 不等于任意脚本 |
| 验证 | Verification | Claim + Applicability + Evidence → Result/Aggregate | 不等于“跑测试” |
| 主机 | Host | 执行 SEC 的物理/运行时环境 | 不等于 Target |
| 工具链 | Toolchain | build/typecheck/package 等执行 Provider | 不等于产品 runtime |
| 目标 | Target | 要生成的程序/平台目标 | 不等于开发机 |
| 运行环境 | Runtime Environment | 目标程序最终运行的物理环境 | 不等于执行 SEC 的 Host |
| Provider | Provider | 提供可替换机械能力的实现方 | 不自动取得 SEC semantic authority |
| Adapter | Adapter | 隔离 Provider 私有机制与 SEC 合同 | 不是第二业务模型 |
| 未知 | Unknown | 当前证据不足以作正/负结论 | 不能偷偷按 false 处理 |
| 不支持 | Unsupported | 当前能力合同明确不覆盖 | 不等于失败，也不等于 PASS |
| 未执行 | Not-run | 本次没有物理执行；是否合理还取决于 applicability/reuse reason | 不能无 reason 投影 PASS |
| 提议 | Proposal | 尚未取得 canonical authority 的候选 | Issue/AI 输出都可能只是 proposal |
| 成熟度 | Maturity | specified/implemented/verified/... 的现实层次 | 文档存在不等于 implemented |
| 收口 | Closure | 所需 owner/input/effect/evidence/terminal 等边界完整闭合 | 不等于“这个 PR 合并了” |
