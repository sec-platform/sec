# Gift120：公共业务模式实例化的编译阶段，而非临时应用（历史研究说明）

本文记录原纯语义编译的**有限参考方案**：`pattern_elaboration.py` 从已冻结的 `semantic:pattern` Definition 与版本化 `semantic:pattern-use/2` 的选择，校验角色基数、名义类型、对象身份、差异槽、Meaning 库的准确摘要、模型观察范围；将已知的一元 Meaning 变为带来源的 `predicate-use` 义务；不认识的 Requirement 只保留 `NEEDS_REQUIREMENT_READER` 和原引用，**绝不猜测它们的时间、权利或执行含义**。

没有生成医院、GPU 或订单应用，没有新增任何“行业 Method 模板”；`test_pattern_elaboration.py` 将现有 Gift118/119 的实际容量模式与 Gift112 原 Meaning/模型当成**已明确标注的本地参考输入**，同时测试集合/序列/多重集、Optional、数据锁、类型精化、观察范围和条件字段。这些负例检查的是编译器不能丢失哪些真实区别。任何结果仍标记 `ELABORATED_UNQUALIFIED`，不能提交为 `QualifiedMethod`、`SourceArtifact`、真实 Grant 或业务执行回执。

`capacity-use-v2.author-module.proposal.json` 是**单一合法作者格式的候选完整文件**；它依赖由真正宿主提供的冻结 `DefinitionRef`/Meaning/领域选择和对象读取器，不能靠测试中的临时 catalog 假装有医院授权。测试仅以 Python 构建一个隔离的输入选择，以便核对算法，不会修改父包内的历史作者源。

要进入真实产品，必须将相同职责纳入 Rust `compiler-kernel`，以真实的严格 SourceReader、类型/身份精化、RequirementReader、联合约束和 Method 实现供给消费，而不是把 Python 参考程序编进生产运行器。完成顺序与接口见[第28施工章](../../../docs/70-工程系统与演进/工程构造手册/28-抽象到业务系统-统一实施闭包.md#pattern-elaboration-implementation)，作者格式见[结构化源码](../../../docs/10-作者与输入/作者源/结构化源码.md#pattern-use-versioned-encoding)，核心精化条件见[抽象定义](../../../docs/20-语义与组合/组合/抽象与开放定义.md#pattern-use-multiplicity-refinement-contract)。

**尚未实现**：正式 Rust 生产 Reader、外部 Definition/Requirement 的资格读取、真正独立 type witness 验证、Method 搜索、联合实效、完整软件 ArtifactSet、真实 Provider/证据和自举；测试中的可注入 `check_type_refinement` 本身不构成独立证明。程序并未创建新的运行应用。
