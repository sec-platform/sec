# Gift137：非计算业务选择、证据及规范义务参考源（历史研究说明）

基于 Gift136 多模块作者示例，保留全部原模块来源。工作流 `SaveWorkflow` 中的 `chooseOutcome` 具有两条可能同时成立的业务路线，使用明确数字优先级，分别给出 `NEITHER` 和 `BOTH` 的不同后继。`SaveAuditObligation` 展示义务要求必须链接到真正的 Norm 定义，而不能借一个 `permit` 规则代替。

`SaveNeedsReview` 与外部 `ext:*` 均没有被实现或证明。结构通过只代表 JSON Schema、局部引用和静态选择合同合法，不证明领域 Meaning 成立、政策权威存在、Norm 有效、状态机运行、Method 可用或完整 IDE 已生成。

原实验入口： `fixtures/developer-foundation/Gift137-noncompute-selection-and-norm/verify_selection.py`。依赖 `jsonschema`。工作区结构沿用 Gift136；目标根明确扩为四个：产品、六模态Goal、SaveWorkflow、SaveAuditObligation。移除某根即改变当前产品的要求覆盖和资格范围；`gift.lock.json` 不应被示例伪造。
