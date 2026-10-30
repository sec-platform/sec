# ripgrep 作者候选与语言检验入口

本案例候选从 [PRODUCT](PRODUCT.md)进入；作者操作、字段分工、固定编译、失败与再次修改在 [WHOLE-PRODUCT](WHOLE-PRODUCT.md#case-development-surface)。通用产品的设计在 [第一层语言](../../../../docs/作者/第一层语言.md#intent-language-product)，本目录用于检验它。下列 JSON 是局部语义，不能凭其长度、数量或正确性认定语言版本已完成；本案例完整机器源与全工程等价也尚未完成。

根部 [gift.project.json](../gift.project.json) 选择 `intent/` 和 `library/` 中的候选结构作者模块，采用 `design-converged`。设计源选择 [rg 一次调用的产品合同](COMMAND.md)、[帮助与补全合同](CLI-DOCUMENTATION.md)及 [globset 规范正文](../library/globset-contract.md)，原格式资产选择 [许可文本、公开说明及原生模板](../assets/README.md)。当前有退出决定、[参数来源合同](ARGUMENT-SOURCES.md)、[部分路径选择](PATH-SELECTION.md)，以及绑定真实规范来源的 [globset 要求根](globset.module.json)。这是整个 ripgrep 第一层工程的进行中草稿；完整 CLI、九库公开合同、资产交付和生成 Target 尚未形成。

参数来源不再以独立阶段函数和 `LowState<Rest>` 记录转交流程；该组草稿及其唯一递归串接依赖已退役，准确行为保留在原参数合同。CLI-OPTIONS 已把 104 项连接到有型产品投影，并定义覆盖、保序、条件复位、出现序号及上下文关系；ARGUMENT-SOURCES 将它们连接到同次实际输入、配置和消息资格。这里仍是语义签名设计，准确类型引用、固定方法及目标接合未完成；P 的解析器真实返回 Result<()>，产品投影不是它的虚构返回值。globset 通过既有 req:rule 引用准确的模式、字节和有序集合关系，正文是其唯一含义来源；该来源不是机器解释器，缺 RuleMeaningMethod、公开类型／Target 和开放观察接合仍逐项保留。既有结构/有限值检查不使这些草稿成为最终作者方案。旧 `author/` 算法草稿、P/Q 混合原型和 native-support 不在活动源集合内，原文件仍保全。

## 顶层入口与未采用草稿

先由[联合产品合同](WHOLE-PRODUCT.md)取得完整产品的共同含义，再进入相交的命令、路径、模式和格式定义。该合同明确十个成品的真实关系、共享定义与独立运行、库错误与命令处置、包/feature 和完整资产责任；捕获它不等于已经取得九库全文、固定解释或 Target。

产品作者入口的责任见[本工程的开发入口](../README.md#产品作者实际需要的开发入口)：作者按需补充所求结果、约束及必要差异中的独立信息，系统利用上下文形成准确规格，承担派生关系和实现。可复用合同可继承，新项目含义可以按需形成，不以预定义产品能力目录作为输入前提。没有普通函数体并不自动使一张关系表适合作为顶层源；准确规格也不等于作者必须逐项手写全部语义。

此前的 option-relations 数据及其说明已移出活动 Project，作为有前像和哈希的审查材料保留；104 项公开词表与行为仍由 CLI-OPTIONS/ARGUMENT-SOURCES/COMMAND 拥有。path-selection 阶段模块也已从 semantic 范围明确排除，原文件保全；[路径合同](PATH-SELECTION.md)保留公开优先、来源、错误、回调和增量行为。它们不再是待扩写的顶层作者入口，也没有搬入 library 继续算减负。下面的退出和呈现定义仍仅承担各自明确的产品决定，不代替完整产品根。

## 搜索结果形式的产品决定

[search-result.module.json](search-result.module.json) 保存六种 SearchMode、九种 SearchPresentation 及纯定义 RequestedPresentation。它只拥有归一模式、quiet、stats 如何共同选择公开呈现，不复制 parser、matcher、searcher、printer 或 worker。Bool 载荷表示统计资格；JSON/QuietJSON 必需统计，用 Unit 保留该区别。QuietJSON 的结果事件被抑制而结尾仍有 JSON summary，不能合并成普通的安静文本统计。

[命令选项](CLI-OPTIONS.md#结果呈现统计与终结共享同一选择)规定每个构造的真实消费者、全局早停、适用选项和同次关系，[命令合同](COMMAND.md#模式结果与退出决定的接合)把其输入接到同次有效决定。已有 match/if/variant/Bool/Unit 足以给这个有限产品选择确定含义，没有新语法、解释器或阶段函数。结构与全部 24 种输入的值核验仍只证明这项选择；原生类型绑定、端点、完整命令解释、九库及 Target 继续开放。它不成为用不断增加局部函数替代产品根的许可。

## 命令退出的产品决定

[cli-exit.module.json](cli-exit.module.json) 用现有有型变体和一个纯函数 `RequestedExit` 定义**给定退出原因时应请求的退出方式和代码**。该函数本身就是有完整含义的定义，不再额外包五个 Goal、四个 Meaning 和四个解释函数。它不复制搜索、遍历、打印或 Rust 实现；只固定产品退出决定。类型、精确匹配和分支均来自既有语言，没有新增 Schema、解释器或 Rust 包装。

`ExitReason` 是这项决定的输入域；`ExitRequest` 的 `Return(Int)` 与 `DirectExit(Int)` 区分正常返回和直接进程退出请求。二者不因代码相同就可互换：直接退出影响栈清理，实际目标接合须保留该区别。函数纯且对声明输入域为全函数，不表示进程总会完成。尚在运行、未取得观察、panic、信号或 OS 故障不虚构成其中一个值。

下表是每个输入构造的准确含义和实际生产者义务。来源均为固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的相对路径；它规定后续接合须保留什么，不声称这些生产者已由当前源码实现。

| 输入 | 载荷的含义与适用域 | 来源 |
| --- | --- | --- |
| `SearchOrFiles(SelectedQuiet)` | Search/Files 返回 Ok(selected=true)，同次有效 quiet=true；Unit 不要求额外读取错误累计。 | `crates/core/main.rs:77–103` |
| `SearchOrFiles(SelectedNonQuiet(errorRecorded))` | Search/Files 返回 Ok(selected=true)，quiet=false；Bool 为同次消息系统的错误累计。 | 同上 |
| `SearchOrFiles(Unselected(errorRecorded))` | 普通 Search/Files 分支未传播 Err，得到实际 matched=false；包括不可匹配快捷分支，不要求存在 search 调用回执。Bool 为同次错误累计，不需要 quiet 值。 | 同上 |
| `Types(hadTypes)` | 类型条目迭代完成，所有已尝试的写入均成功；条目为空时无需写入。Bool 表示同次条目数非零。 | `main.rs:329–347` |
| `Generation(Unit)` | 所选 man/补全生成的写入调用返回 Ok。 | `main.rs:355–368` |
| `HelpOrVersion(Unit)` | 解析后最终 special 是短/长帮助或普通版本，相应写入调用返回 Ok。 | `main.rs:383–408` |
| `Pcre2Version(pcre2Feature)` | 最终 special 为 PCRE2Version，写入调用返回 Ok；Bool 为该二进制是否编译 pcre2 feature，不是 JIT 可用性。 | `main.rs:383–408`、`flags/doc/version.rs:53–78` |
| `PropagatedBrokenPipe(Unit)` | 传播至 main 的真实错误链中存在 `io::Error` 且 kind 为 BrokenPipe；此路径不执行顶层错误诊断。 | `main.rs:43–65` |
| `PropagatedErrorReported(Unit)` | 真实错误链不含上述 BrokenPipe，且顶层诊断写入调用已成功返回。 | 同上 |
| `DiagnosticWriteFailure(isBrokenPipe)` | `eprintln_locked!` 的前缀或正文写入发生错误；Bool 表示该实际写入错误的 kind 为 BrokenPipe。此路径直接退出，可发生在配置、普通消息、ignore 消息、debug/trace 或顶层错误报告期间。 | `messages.rs:33–99`、`logger.rs:31–54` |

`selected` 是模式实际返回的 matched，不等于正则匹配、不等于有 stdout。不可匹配快捷分支可直接返回 false；FilesWithoutMatch 的二进制 quit 可不打印路径而返回 true。`errorRecorded` 来自 `err_message!`，不等于“曾有任意错误”或“显示过错误”；`--no-messages` 不阻止累计，ignore 消息不设置它。局部吞掉 BrokenPipe 后若返回 Ok，仍进入 Search/Files 完成域，不能根据错误名称一律选 `PropagatedBrokenPipe`。

这些输入是同一次产品决定的充分值，不是外部认证接口、持久运行台账或新公开 rg ABI。错误原因分类只计算本项退出决定；原错误链、部分输出、被捕获错误和作用不能因此丢弃，仍由其真实错误/输出合同保留。构造名或正确类型不能证明值来自实际运行；模式选择、结果生产和真实退出消费者尚未完成。五项原分离 Goal 的问题是互不相关角色未接合；目前把值到结果关系直接收归函数的同次调用，**仍不冒称该函数已与进程连接**。

## 证据与尚未接合的边界

当前源码的结构与有限纯值证据以相应捕获哈希为准，不是生产 Reader 或 Rust 编译证据。该决定只使用闭合变体、Bool、Unit 和固定整数结果，因此可逐分支穷举全部十五个合法输入值；不需要通过有限整数样本推断输出只会是 0、1、2。函数没有其他结果构造、外部引用或作用。

实际作用仍须由完整工程接合：正常返回中的运行期清理、直接退出的清理差异、缓冲 flush、stdout/stderr 部分写入和物理送达都没有由 `Return(0)` 获得证明。诊断失败可发生在持 stdout 锁的工作线程，`DirectExit` 须在实际失败位置接合，不能先退栈或回 main 再按相同退出码替代。顶层异常、panic/abort、外部终止和不终止也不被这份有限退出决定覆盖。

- [命令选项](CLI-OPTIONS.md)已收齐 104 旗标词表、逐项决定和相交组合；其类型化解释、CLI 解析和配置、输入准备、文件集合、匹配、打印和错误累计尚未形成完整第一层组合。
- 九库的公开类型、trait、回调/借用、错误、feature/cfg 和开放消费者尚未闭合；尤其不能把 Sink 声明的“false 后停止”当作 P 所有路径的真实行为。
- 原格式资产、完整产品根、Rust Target 和真实 Method 资格未接合；不以一个可导出的政策函数充作 CLI 或九库。
- 全工程 P→Q 的 Unix 路径政策修改、消费者闭包与逐项等价审查尚未闭合。
- 生产 Reader、类型/效果/借用检查、Rust 生成、Native/Gift 运行、平台、并发/资源/性能与发行验证未执行。

之前两份退出 Goal/判词源已从活动集合退役，准确前像保留在任务辅助目录 `.tmp/whole-engineering-20261025/wave2/retired-author/exit-goals/`；仅供审查恢复，不是第二个可编辑政策源。其历史有限关系 PASS 不转授给新源码。
