# 连续确认的观察供给设计

本项目 profile 消费原 Event、Observation、Time、Source occurrence 与本轮 observedDomain，不新增业务解释器、阶段函数或持久日志。它提供四个观察投影的明确模型与资格；实现状态为 NOT_IMPLEMENTED。

source:occurrence的类型与投影同时消费本工程捕获的[源发生固定解释](../../源发生绑定/README.md)及其Subject声明，沿原Reader/Profile/EngineImage与Lock闭包固定profile:source-model-occurrences修订1。只导入同名req:subject不构成该解释；清单捕获设计输入也不签发生产资格。

**真实会话与源码组件分开。**`local:Session` 是本模块真实 req:subject 声明。目标/激活入口的合法输入须从既有真实 issuer/会话 owner 或已合格模型取得一个 Session Subject，并给出其激活与所选 source Component 的对应；对象携 root、session epoch/identity、文档及 clock 的原来源。示例组件只用 context 转传它。sourceComponent 是已捕获候选中的 Component 主体；同一 source Component 可产生多个不同会话，两者绝不因代码一样合并。没有真实/合格模型来源时返回 NeedsSessionBinding，不写伪 objectRef、空 record 或特殊 issuer 字符串补它。

**clockRef 有真实源，clock 实例有独立来源。**全部 Observation/Temporal 的 clockRef 为实际导入声明 `time:SessionReading`，解析到现有 `module:event-time-ranges/SessionReading` 的准确 Declaration。此 profile 将这个声明识别为本次模型的时钟读数 family；这只是固定类型/单位解释，不自动认证钟。实际 clock identity 由被绑定 Session 的真实 clock domain 实例化；Reading.clock 的值须由该 producer 关联到该 domain。跨 session 即使同一 Type、同一数值和同一显示文本仍拒绝/缺资格。profile 与 Time consumer 必须联合接受此 family→session clock 解释；未接受时明确 NeedsClockInterpretation，不能把一个 Type Ref 自身当真实 Clock。

每个 SessionCut 的身份包含准确 Session、sourceComponent、ObservationUse、源修订、评价点 τ 与 coverage。它由原激活/事件/文档 owner 或合格静态轨迹模型提供，不由客户端构造。四个投影只读已保留切面，不触发输入、显示、应用、计时器或重新读取 live 对象；合格静态证明可以承担同义事实，不强制每次运行保存日志。

| 观察 | 准确域 |
| --- | --- |
| EditsAt | 该 Session 与绑定 subscribe EventUse 的、截至 τ 已发生的全部合法编辑出现 |
| PreviewsAt | 该 Session 与绑定 publish EventUse 的、截至 τ 真实已向用户展示的全部预览出现；“计划生成”或离屏临时值不是展示 |
| ConfirmationsAt | 该 Session 与绑定 subscribe EventUse 的、截至 τ 用户实际确认的全部出现；入口只接指向该用户已看见预览的合法确认，允许旧预览 |
| ApplicationsAt | 该 Session 与绑定 publish EventUse 的、截至 τ 全部实际生效出现，包含其对应文档实际后态；必须完整覆盖该文档全部实际应用/状态变更，不能只过滤自报的应用消息 |

同一发生在后续 cut 保持相同 id/ordinal/at/不可变 payload；两个相同内容/时刻的不同发生 id 不同。id 只在该 Session 的准确流/引用域解释，ordinal 是四类发生共同的真实会话顺序，不能由内容 hash 或采集顺序猜测。Reading 为同一 clock 下已取得的不可变锚点。审计证据晚到可以证明固定过去 cut，实际发生晚于 cut 不能倒填；事实时间、观察到达与本次判断分开。

`completeness:closed` 在此指**给定 τ 的已发生前缀闭合**，不指未来整个会话结束。缺成员、来源、覆盖、clock、会话对应、型或精化时为 Need/冲突，不能返回空序列取得空量词真。Applications 的遗漏、未授权文档写入或无法把实际后态对应到本次生效是违反 coverage/对应义务，不通过“没有发布事件”把它排除域；这使第五份 Change 记录与关系表没有独立必要性。

同一个 τ 上被共同使用的四个域须能组成同一合格 cut；外层 e 在 τ₀ 绑定后保持快照，内层 Temporal 在 τ₁ 进入新的 observedDomain 可以取得 τ₁ 的新预览域。普通 Goal/Meaning 参数没有被重绑。range 在进入该 temporal 的环境中固定，未来检查不滑动续期。

header 的 bigint→精确 Int，Reading→实际 time:SessionReading，四个事件类型→本模块对应直接 record 的同一名义类型。Content 的数学域是 Pair 的有限集合，Pair 按 person/shift 两个精确 Int 比较；声明数组只是本 profile 的候选 native 表示，适配必须保持集合成员，不把数组位置、对象地址或重复编码变成额外分配关系。这个表示差额必须由实际 native adapter 合格保持，未取得前为 NeedsHeaderAdaptation，不能自行以 TS 结构相同签发。

源模型的 EventUse/ObservationUse、运行 Session、保留 SessionCut、普通不可变事件值四层分别保留。用于 observedDomain 的每个实际 ObservationUse 必须核 observer 返回的 Sequence<T>、全部 predicate 对 T 的真实约束、session/clock/scope/profile/coverage；同返回型不同会话或错误 profile 仍不相容。Meaning.formula 中的 observation 参数也是原有词法绑定，不能在共享关系内部重新选择源发生。

Application.documentRevisionAfter 必须是同一次实际应用完成时该 Session 文档的真实后态；revision 与 confirmationId 等普通字段不得靠应用自报就取得该对应。Session 的同一文档来自真实激活上下文；本例不再复制一个未被要求消费的组件 currentRevision 状态，也不把已有文档初态强制设为0。所有实际应用保持原文档及准确版本对应，观察覆盖其全部实际变更。每个 revision 在该会话的同一文档版本域唯一指向不可变 content；若同 revision 携不同内容，则输入/来源不合格，不能任意选择一个满足公式。缺这个文档绑定是 NeedsDocumentBinding，不是“观察函数未实现”之外可以忽略的语义。

**一秒是义务，不是环境自动保证。**假设环境允许会话继续运行并不推出一秒内完成。该 profile/普通时间 helper 只定义窗口与见证；抽象产品策略的可行性与实际 Method 的调度、资源、执行时间及 UI 可见性资格分别证明。不能静默缩小原输入或把一直未预览改成宿主 Fault 来满足期限。
