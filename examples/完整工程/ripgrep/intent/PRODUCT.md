# ripgrep：检验案例的产品意图候选

本文件是 **ripgrep 案例的作者候选入口**，与本地合同一起提供真实要求和反例，检验[通用意图语言](../../../../docs/作者/第一层语言.md#intent-language-product)。它以 Project 的 `design` 内容保存；尚非取得完整固定解释的 `semantic` 模块，不能直接构建 `rg`。案例中的作者操作与落实责任见 [WHOLE-PRODUCT](WHOLE-PRODUCT.md#case-development-surface)。本文件的完成不代表通用语言版本完成。

## 所求成品

提供一个面向文件和字节内容的搜索工程：使用者能指定模式与输入范围，取得匹配、上下文、计数、路径或结构化结果，也能只发现文件、查询文件类型、查看帮助及生成手册和补全。结果、错误、部分输出、停止及资源行为共同属于产品含义。

交付可执行命令 `rg`，以及可供其他工程独立使用的 `globset`、`grep`、`grep-cli`、`grep-matcher`、`grep-pcre2`、`grep-printer`、`grep-regex`、`grep-searcher`、`ignore`。保持各公开包的身份、可用入口、类型、trait、回调、借用、错误与 feature 条件。九库是本产品的输出范围；作者不需要先建立九套 Gift 能力库才能开始表达本产品。

同时交付与成品相符的 Rust/Cargo 工程、依赖与构建输入、许可与原格式资产、help/man/补全、测试及 fixture、fuzz、benchmark、源码包与平台打包材料。平台支持与成员区别沿 [ENGINEERING](ENGINEERING.md)，不把开发工程、单独 crate 包和平台安装包混成同一个目录集合。

## 本版接受的含义

本版以固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 为独立兼容对照。下表的本地正文是已提取的具体要求与设计，不靠构建时读取上游 Rust 再猜行为。尚未提取或固定的公开内容仍是缺项，不能仅凭 P 的引用补成完成。

固定 P 的原产品 Rust 是事实材料和独立对照，不是这个入口按产品名隐式调用的实现，也不是新工程须人工同步维护的第二套行为源。已形成的产品含义在本文件及其准确引用正文维护；实现选择或创作由系统承担。旧 `author/`、Mixed 原型与 `native-support/` 继续仅作保全材料，不因本案例引用其历史而恢复活动写权。

| 所求含义 | 唯一内容位置 |
| --- | --- |
| 同一次调用的输入、各命令模式、结果、错误与终结 | [COMMAND](COMMAND.md)；参数来源归 [ARGUMENT-SOURCES](ARGUMENT-SOURCES.md) |
| 全部 104 个逻辑旗标、拼写、值域、默认与组合 | [CLI-OPTIONS](CLI-OPTIONS.md)，公开词表为 [flag-vocabulary](flag-vocabulary.json) |
| 名称、类型、ignore、隐藏、遍历与增量查询 | [PATH-SELECTION](PATH-SELECTION.md)，开放库责任为 [IGNORE-CONTRACT](../library/IGNORE-CONTRACT.md) |
| glob 模式与有序集合的公开含义 | [globset-contract](../library/globset-contract.md) |
| 匹配器、捕获、两个引擎与真实内容搜索 | [MATCHER-CONTRACT](../library/MATCHER-CONTRACT.md)、[ENGINE-CONTRACT](../library/ENGINE-CONTRACT.md)、[SEARCH-CONTRACT](../library/SEARCH-CONTRACT.md) |
| 文本、摘要、路径、JSON、颜色、链接、统计与写入 | [PRINT-CONTRACT](../library/PRINT-CONTRACT.md)、[JSON-OUTPUT](../library/JSON-OUTPUT.md) |
| 模式来源、终端、转义、解压与子进程公开工具 | [CLI-LIBRARY-CONTRACT](../library/CLI-LIBRARY-CONTRACT.md) |
| 原公开数据与 CLI 文档的同源生成 | [DEFAULT-FILE-TYPES](../library/DEFAULT-FILE-TYPES.md)、[CLI-DOCUMENTATION](CLI-DOCUMENTATION.md)及其实际数据和资产 |
| 跨成品共享、独立状态、包关系、工程装配 | [WHOLE-PRODUCT](WHOLE-PRODUCT.md)、[ENGINEERING](ENGINEERING.md) |

这些正文共同约束同一实现，不能分别挑选互不相容的见证。`grep` 重导出原定义；CLI 只在自身合同内配置、消费库和处置结果，不收窄独立库的合法用法。相同类型不合并两个实际实例；同一次调用的输出、统计、错误和退出不能从不同调用拼合。

兼容包括开放输入与实际作用，不仅是成功返回值：原始字节与非 UTF-8 路径、配置与 argv 区别、错误优先、已发生的回调/读取/部分写入、库复用、并发下允许的结果关系及资源寿命都按相交正文保留。参考版本中确实可观察的不规则行为保留在对应合同；修正它须成为有来源的产品变更，不能在优化实现时悄悄消除。

## 当前决定与允许变化

当前活动名称政策为 [PATH-SELECTION 的 P 条款](PATH-SELECTION.md#path-name-policy)。[Q 补丁](../changes/tail-dot-name.patch)是下一次修改的明确差额，不同时作为活动政策，也不是运行时开关。

实现可以重新选择算法、数据结构、索引、缓冲、私有函数和文件布局，以及合同允许的并行组织。必须满足上述公开行为、相交资源与平台条件；不得用修改输入域、错误行为或公开接口换取代码更短。目标使用成熟标准库与外部依赖时固定准确版本及适用条件；本工程的产品行为不能整体外包给一个藏有原 `rg` 的运行包装。

本版没有独立指定新的硬性能阈值，也没有要求精确耗时、私有地址或二进制逐字节相同。已有明确资源控制与公开观察继续保持。系统可比较合格实现的性能和维护成本，但没有测量时不能宣称更快、最优或已经减少总成本；需要牺牲兼容的优化须返回产品选择。

## 作者实际怎样改

改变文件名政策，只修改其原条款。例如接受“尾点名称应保留，只有最终分量恰为 `.` 或 `..` 才无名称”，就将 [Q 补丁](../changes/tail-dot-name.patch)应用到同一个作者发生点。系统沿实际引用重求 Types、hidden、遍历、增量缓存和 CLI 结果的影响，保留非 Unix、空名称、原字节及未受影响的约定；具体接受差额见 [changes](../changes/README.md)。作者不逐个重写调用者或 Rust 函数。

改变已有旗标的产品行为，修改 CLI-OPTIONS 中该项及确实改变的共同要求；不同时编辑参数解析步骤、结果投影和生成的 help。只改公开说明文字时修改其原文资产；只有它实际改变产品含义，才同时修改相交合同。增添产品用途时，先写新增的结果和保持条件，系统在当前工程形成必要的定义与实现候选；没有先上架某个业务能力包的前置。

需要精确控制算法、布局、ABI、资源上限或依赖时，在对应真实定义/控制位置增加这项决定；只接管该区域。其余内容仍沿已有定义、推导与委派形成。取消控制必须保留仍有效的公共要求，不能靠删除一个选择顺带放宽兼容。

## 本版可取得的结果

现在可以审查整套产品范围、全部现有本地行为合同、跨成品关系、作者修改位置和从该源到目标工程的责任设计。此入口没有新增函数语法、业务 kind、解析阶段或一套作者必须手填的固定字段表。

当前还不能从这些文件生成完整 `rg` 或九库：完整公开声明与固定语义内容、实现取得和 Rust 目标装配仍未闭合；生产 Reader、编译/运行及全工程等价验证也未执行。准确边界见[案例设计状态](WHOLE-PRODUCT.md#case-design-state)。这些缺项用于定位语言表达、落实设计或案例材料的实际不足，不自动转成先完成九库再设计语言的任务。
