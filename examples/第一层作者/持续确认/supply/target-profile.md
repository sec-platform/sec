# 确认交互目标设计

固定profile:confirmation-interactive-host修订1，消费同源确认组件与[观察供给](observation-profile.md)。本文件为完整目标设计内容，不是已安装lowering清单。

1. 接受该组件根与四项 eventParticipation/observationParticipation，形成单文档、单用户的内存交互会话。每次激活取得新的真实 Session 身份、该文档与单调 clock；原激活/文档 owner 或合格模型先建立来源，再通过原 context 输入绑定组件的 `session`。类型声明和 source selector 都不能代替这一激活。根 Project 不持久化伪 objectRef，也不把源码组件当 Session。
2. `Session` 是本目标要求的真实外部/激活上下文输入，不是静态构造值；目标 Method 必须公开其生成入口与绑定证明。未具备这项 Method 时是 NeedsSessionBinding/Method，不得由“选中组件根”宣称已有运行 Session。源允许保留并静态解释为带该明确上下文前提的要求族。
3. 最小交互面包含编辑输入、已展示预览列表、每项预览的确认操作、当前已生效修订显示。预览历史保留足以支持用户确认旧预览；不能用只显示最新预览的 UI 暗中删掉旧确认的合法域。输入内容与修订从本会话原编辑对象取得，机器 occurrence id/ordinal 由原发生 owner 提供，不让用户填写。
4. 用户编辑/确认分别进入该根的 edits/confirmations subscribe use；预览只有真实向用户展示后进入 previews publish use；生效只有实际文档后态完成后进入 applications publish use。输出事件与后态/可见性/同次关联必须符合观察 profile 的覆盖资格。它不要求手写 listener、队列、workflow 步骤或阶段函数。
5. 源 Clause 拥有期限、身份、允许旧确认、至多一次、确认次序与文档改变合同；目标不复制第二份公式。程序生成 Method 须证明有因果、无预知未来的策略，再取得满足真实一秒期限的执行/资源/宿主资格。条件性因果策略推导见[工程说明](../README.md)，该推导不代签现实运行证据。
6. 会话持续可运行只是接受环境前提；没有隐含断电恢复、磁盘持久化、网络重连或多用户并发保证。真实资源不足与宿主终止沿原故障规则报告，不伪装 InvalidInput，也不能在正常域无限拖延。输入资格变更、期限变更及旧预览策略修改形成真实后继，重新核相交方法/保证。
7. 构造性实现、UI lowering、原生观察适配、工具锁、构建与实际运行均未取得；目标缺项不能由此设计声明或空方法填补。若请求生成，返回原 Needs 而非空产物成功。本稿只交付作者设计输入及其明确实现责任。
