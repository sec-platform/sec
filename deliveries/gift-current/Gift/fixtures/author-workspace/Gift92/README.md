# Gift 92 大规模稀疏控制作者源码形态（设计候选）（历史研究说明）

- `01-inline-v2/` 使用已经存在的 `gift.controls/2`，是小项目的正规存储形态。
- `02-external-files/` 使用原实验阶段拟订的 `gift.control-files/1` 项目扩展、严格JSON分片文件，演示大项目的**同语义内容、不同源码物理组织**。
- `reference/example-descriptors.json` 是**仅用于验证样本**的描述符契约替身；`example.*`不是已发布或签名的Gift Descriptor。真实产品必须从有内容与revision资格的已绑定Descriptor解析，不能靠这份reference文件假装已经实现。
- `schemas/`只有候选存储外壳的JSON Schema，不覆盖真实Descriptor内容、跨文件双写、SourceSnapshot与执行效果。`verification/verify.py`补上有限多文件形状及失败反例，但不代替真实Gift读取器。
- 两个实例的 `projectId`、所有实际模块/Definition/目标都相同，表明它们**应作为互斥替代方案分别使用**，不能同时挂载在一个已接受工程中。
- 两个项目都有 `targets: {}`，这是合法的设计作者源，不是可运行程序。没有虚构Target、Method、Provider、Binding lock、发布或部署结果。
- 迁移必须按原规范冻结、比较、预备及真正共同提交；仅运行测试脚本不会修改任何用户现有工程。

**安全版本边界**：外部分片实例的根schema为候选`gift.project/2`，不是扩展了v1却让老Reader静默忽略；内联实例仍使用`gift.project/1`。

**语义分类修正（Gift 93）**：`EditorSubsystem.historyLimit`若决定用户可撤销步数，属于作者Meaning/Requirement；示例中的`example.editor.internal-history-reserve`只代表不改变该外部承诺的私有缓存预分配候选，不能与前者合并或当作相同写权。`example.*`仍然只是测试替身，不构成已发布Control descriptor。

现行控制写源与迁移按[稀疏控制 Owner](../../../docs/20-语义与组合/组合/稀疏控制与目标限定.md)解释。本文保留旧版形状的研究含义，不延长旧 writer；旧 `rootRef` selector 只有唯一匹配才可迁为现行 root occurrence，不能把历史记录改成新字段后声称原案已采用。
