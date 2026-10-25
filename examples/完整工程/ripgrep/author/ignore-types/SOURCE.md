# ignore 类型数据与选择策略的 Gift 作者源码

本目录交付的是完整内置类型数据，以及 `ignore::types` 中已经写出主体的分类、选择、状态推进算法。它是整个 ripgrep 作者迁移的一个真实分量，**不是完整 ripgrep 迁移完成，也不是已经替换原生 `Types` 的可运行成品**。原生 `Types` 整体没有被重新标为供给；尚缺的文本操作、glob 编译与集合匹配、公开借用视图和实际调用接线在本文逐项列出。

## 源码与准确来源

| 本目录作者文件 | 内容与身份 | 原始来源 |
|---|---|---|
| [default-types.module.json](default-types.module.json) | `ripgrep:ignore:default_types`；`DefaultTypeGroup` 类型与 `DefaultTypes` 常量 | `crates/ignore/src/default_types.rs` 的完整 `DEFAULT_TYPES` |
| [types.module.json](types.module.json) | `ripgrep:ignore:types`；12 个类型、45 个有实际主体的纯函数 | `crates/ignore/src/types.rs` 的数据更新、选择、构建顺序、结果分类 |

固定来源 P 为 `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`，源树 `e41450e1cd2b5b7a3fef684b5c38cf5d504fc030`。来源 Q 为 `7155f6408d370e699795dc75e954635abfaf08a6`；两份被迁出的原文件在该差额中保持，`pathutil` 的 Unix `file_name` 改动会影响 `Types::matched` 的输入分支。Q 不需要另抄本目录全部作者源。

`default_types.rs` 原始字节 SHA-256 为 `8ae3b4c5bd69a1bf6e5335d926eedbdcf6906c3cf17f2eff7aed646ae3ccbcd1`。本目录沿原 ripgrep 来源归属；原工程的 `LICENSE-MIT`、`UNLICENSE` 及归属仍随完整来源交付，不因把数据转成 Gift 而撤销。

数据完整性按实际数组取得：**219 组、224 个别名、594 个组内 glob 项、609 个展开后的 name/glob 对**。保留组顺序、别名顺序、glob 顺序、大小写、通配符内容和重复。`py`/`python` 等别名是分别登记的类型名；它们不是引用同一可变条目的别名指针。保留原顺序不表示原源已经把每组 glob 排序；显示用排序属于 `definitions()`。

常量是 `Sequence<DefaultTypeGroup>`，每组是 `{names:Sequence<Text>,globs:Sequence<Text>}`。作者值通过真正的 `Expr.sequence`、`Expr.record`、标明 Text 的 `Expr.literal` 构造，**没有把 JSON 数组／对象当任意 Type 的 literal**，没有把 Rust 初始值文本塞进不解释的字符串。数据只保存一份，`types` 通过 workspace import 消费 `defaults:DefaultTypes`。

## 已有主体和原函数的对应

| 原始位置／行为 | Gift 定义 | 已表达的行为 |
|---|---|---|
| `FileTypeDef`、`Selection`、`TypesBuilder` | 同名数据投影与 `Builder` | 类型名、按加入顺序的 globs、选择顺序及否定标志；不把默认表或选择集合去重 |
| `TypesBuilder::new` | `NewBuilder` | 空定义、空选择 |
| `TypesBuilder::clear` | `Clear`、`RemoveDefinition` | 仅删除指定定义，不删除已有选择；之后 build 仍可能报未知类型 |
| `TypesBuilder::add` | `AddAfterNameClassification`、`PutGlob` | 拒绝 `all`；按准确 Unicode 分类结果决定是否接受；已有类型追加 glob，新类型建立定义；不编译 glob |
| `add_def` 的两个有效分支 | `AddRootAfterLexing`、`AddIncludeAfterLexing`、`AllNamesPresent`、`IncludeExisting`、`AddGlobsAfterNameClassification` | root 分支拒绝空 name/glob；include 先检查所有来源存在，再逐次读取当前表、复制本轮 globs 并追加；错误不被成功吞掉 |
| `TypesBuilder::add_defaults` | `AddDefaults`、`AddDefaultGroups`、`AddDefaultNames` | 原组→别名→glob 三重顺序；对已有定义继续追加；再次调用再次追加 |
| `select`／`negate` | `SelectAfterKeyEnumeration`、`AppendNamedSelection`、`AppendAllSelections`、`IsExactKeyEnumeration` | 非 `all` 可先记录不存在的类型；`all` 只选调用当时已经存在的键，保留原枚举次序；重复选择保留 |
| `Selection::is_negated`、`name`、`inner`／`map` 的具体消费者 | `Selection`／`ResolvedSelection` 字段及实际使用主体 | 保留名称、否定方向、所选定义快照；不复制一个无人调用的泛型回调镜像 |
| `has_selected`、`Types::is_empty`／`len` | `HasSelected`、`IsEmpty`、`Len` | 至少一个正向选择、选择数量；不是定义数量，也不是 glob 数量 |
| `TypesBuilder::build` 的控制顺序 | `StartBuild`、`NextBuildStep`、`AdvanceAfterGlobSuccess`、`BuildCursor`／`BuildStep` | 当前 selection 查定义→请求逐 glob 编译并加入构建器→成功后才追加索引映射并推进当前 glob→保存该选择→下一个选择→最后组装集合；每个 glob 对应准确 selection/glob 双索引 |
| build 的两种 glob 错误 | `GlobCompileFailure`、`GlobSetFailure` | 单 glob 失败保存 `Some(pattern)` 与 `err.kind().to_string()`；集合组装失败保存 `None` 与 `err.to_string()`；未知类型保持独立错误 |
| `Types::matched` 的前置分支 | `StartMatch`、`AfterFileName` | 目录或空 glob set 立即 NoMatch；否则才提取文件名；没有文件名时按 hasSelected 决定 unmatched-ignore／NoMatch；有文件名才进入 glob 匹配 |
| `matches.last()` 与最终分类 | `LastMatchIndex`、`ClassifyMatches`、`Unmatched` | 消费真实 globset 返回顺序的最后索引；沿映射取得 selection 与完整定义；否定得到 Ignored，正向得到 Whitelisted；无匹配但有正向选择得到 IgnoredUnmatched |
| `Glob::file_type_def` | `FileTypeDefOfMatch` | 没有匹配原因和 unmatched-ignore 均返回 None；真实命中的 ignore／whitelist 返回对应完整定义 |

`AppendText` 等有限序列辅助函数也都有主体，只调用当前有限纯基底 `std:SeqUncons`／`SeqPrepend`。文本相等只用已有 `std:TextEqual`，索引运算只用已有数学整数 `std:IntAdd`、`IntSub`、`IntEq`。未添加任何虚构 `std:HashMap`、`std:TextSplit`、`std:Glob` 名称。

这些类型是当前可审查的语义值投影，不直接等于原 Rust 公共 API 的物理表示。`IsEmpty`／`Len` 消费 Builder 中的选择投影；构建前后选择数量相同，不能把这件事误报成已经完成 Rust `Types` 接口替换。公开借用、封装与原生 ABI 的接线另见剩余义务。

## 必须保持的顺序与错误反例

1. `add("", "*.x")` 原生接受：`chars().all(...)` 在空序列上为真；`add_def(":*.x")` 拒绝。Gift 的 Add 与 RootAfterLexing 分开，不以“名称应非空”扩大原验证。
2. `add(name, glob)` 只保存 glob，错误的 glob 可能在 build 时才失败；未被选择的非法 glob 不应因本轮添加就被编译或拒绝。
3. `clear("rust")` 不撤销先前 `select("rust")`。build 走到该选择才报 `UnrecognizedFileType("rust")`。随后重新添加该名字时，已有选择读取 build 时的现行定义。
4. `include` 在任何修改前检查所有被引用名字。`combo:include:html,missing` 必须在 html 被加入之前失败，原 Builder 保持。
5. `x` 初始 globs 为 `["a"]`，再执行 `x:include:x,x`：第一次引用从当前表复制 `["a"]` 后追加成 `["a","a"]`，第二次复制更新后的两项后追加成四项。不能一次性快照所有 include 来源，也不能去重。
6. `add_defaults` 在已有同名类型后追加，连续调用两次会有两份默认 globs。显示排序不能去掉相等项。
7. `select("all")`／`negate("all")` 按当前 HashMap 键枚举次序展开。排序这次展开可能改变公开匹配原因中的 FileTypeDef，也可能改变 build 的首个错误。Gift 要求 `currentKeyOrder` 是当前键的无遗漏、无重复排列；`IsExactKeyEnumeration` 负责内容一致性，**其原生枚举来源与同一调用时刻的绑定仍是待实现边界**，不能由调用方任选排列就声称具体运行保持。
8. 某个早期选择含非法 glob、较晚选择引用未知类型时，必须先报早期 glob 错误。`NextBuildStep` 在 CompileGlob 即停，不预查后续全部名称。CompileGlob 只返回 `pattern`、`literalSeparator` 和当前未推进的 `cursor`；它不提前调用 `AppendSlot`，不构造 `onSuccess`。只有本 glob 编译并加入同一构建器均正常完成，消费者才能调用 `AdvanceAfterGlobSuccess(cursor)` 计算下一状态。
9. `AssembleSet` 只在所有选择与 glob 编译成功后出现。无选择也仍需构造空集合；它与“有选择但零 globs”的情况在 hasSelected、len 上不同。
10. `StartMatch` 先判目录／glob set 为空，不能先提取 filename 或匹配。`Some(empty filename)` 仍应进入 glob 匹配；不能按长度把它变成 None。调用 `AfterFileName` 的 `hasFileName` 必须来自 Option 的标签。
11. globset 的最后匹配索引胜出，不是字典序最晚类型，不是只看白名单／黑名单数量，也不是任意 set 迭代顺序。`ClassifyMatches` 不排序外部结果。
12. `ClassifyMatches` 返回的外层 None 表示无效匹配索引／无效 selection 索引，不是业务 NoMatch。正常、合格 globset 输入应始终得到 Some；该保护结果不能对外冒充原生的一次成功匹配。

构建消费者的成功／失败边界是明确的源协议：先取得 CompileGlob；按其 pattern 和 literalSeparator 执行原 `GlobBuilder::build`，成功结果加入同一个 `GlobSetBuilder`；两步都正常完成后，才调用 `AdvanceAfterGlobSuccess`，取得 Some(nextCursor) 后进入下一次 `NextBuildStep`。编译错误直接经 `GlobCompileFailure` 结束，不调用推进函数；加入构建器时的 Fault／资源失败按实际失败通道结束，同样不推进。`AdvanceAfterGlobSuccess` 在返回 Some 之前追加当前 `(selectionIndex,globIndex,glob)`，去掉一个 pending glob，并增加 globIndex；其输入 cursor 是未推进的值。

推进函数返回 None 仅表示输入没有 active selection 或没有 pending glob，是消费者协议错误，不能当作业务匹配结果或编译成功。检查 cursor 的形状不证明外部编译成功；成功事实由上述真实编译／构建消费者持有，不用虚构成功 Bool、回调供给或 source 字段代签。追加映射本身若失败，也不得对外发布推进后的 cursor、尝试后续 selection 或把失败改成普通 Glob 错误。实际构建器中已经取得的 glob 由原构建生命周期清理。

旧设计把追加映射藏在急切求值的 `onSuccess` 记录字段里，可能在非法 glob 得到其原错误前，先发生遍历／分配失败。现已从作者调用顺序移除这一前置计算；**即使推进函数声明纯，也不能把它跨越 glob 编译／加入成功边界提前执行**。这个顺序约束已经闭合；Seq 与 Vec 的具体成本仍须按目标方法资格分别证明，不能再用成本未实现来豁免该顺序。

## 当前类型、集合与资源边界

- Text 按 Unicode 标量序列、无隐式规范化／大小写折叠／locale 相等解释，以保持 Rust `String` 键相等。原 glob Text 不进行大小写转换。公共 Text 解释和目标方法仍须准确绑定，不由 JSON 的字符串形状签发。
- Builder 的 definitions 序列是 HashMap 的有限值模型。所有从 `NewBuilder` 经本目录合法增删操作可达的状态具有唯一名称；序列内部保存次序不承担 HashMap 遍历顺序。伪造重复名称的透明记录不在该可达状态证明内。最终公开库须用现行 opaque 入口或等价的检查构造封闭此不变量，不能把任意记录默认为合法原生 Builder。
- globs、selections、match indices 都是有序且允许重复的序列；definitions 的名字是唯一键。HashMap 的随机种子、桶布局、容量不成为普通集合值语义，但对 `all` 暴露出来的枚举次序必须按观察范围保持。
- 原 `Types.defs` 是按名称排序、其中 globs 也排序的展示副本；`selections` 中克隆的 FileTypeDef 则保留原加入次序。Gift 的 `BuildMetadata.definitions` 与 `ResolvedSelection.definition` 分开；不可把展示排序后的定义反过来拿去编译 glob 或作为匹配原因。
- `StartBuild` 的 `sortedDefinitions` 是**尚待闭合的精确输入**，要求它由当前 Builder 产生，按 Rust `str::cmp` 排名称与每个 glob，并保留重复。现有函数不验证这项关系，不能据其名字声称排序已经实现。
- `FileTypeDefOfMatch` 返回的是不可变语义值。原 `Glob<'a>` 返回的是借自同一 `Types.selections` 的定义引用；需要目标方法保持该生命周期、身份与字段借用。复制一个等值对象不能自动代签指针相同或借用不分配。
- 当前 Int 索引是无界数学整数；原实现是 usize。所有可达构建索引从零递增，范围由实际集合长度限制；目标须证明长度／索引转换和资源上限。负数或越界外部匹配索引在模型返回无效输入，不能映射成 Rust 越界成功。
- 有限不可变序列与记录可以表达上述逻辑；并不承诺与 HashMap/Vec/Arc/Pool 相同的分配、复制、尾共享、栈深、Send/Sync 或调度代价。`Append*` 的直接递归表示会反复遍历前缀，不可据纯语义证明原程序的性能。
- `termination="total"` 是需要检查的义务。辅助递归减少一个有限序列；`NextBuildStep` 的未停递归只在当前 selection 无剩余 glob 时完成该 selection，或者消去一个剩余 selection 并建立其 active 状态。有限 selection 数与相位共同给出下降依据。字段自身不等于生产终止证明，也不消除真实内存／取消边界。

## 真实消费者与 P/Q 差额

`crates/core/flags/hiargs.rs::types` 按顺序先 `add_defaults`，再依 `LowArgs.type_changes` 顺序执行 Clear/Add/Select/Negate，最后 build。不能把这些变化按操作种类重分组。`crates/core/main.rs::types` 用 `definitions()` 打印 `--type-list`，因此排序、重复项、分隔符与空定义时的退出码属于真实观察。

`crates/ignore/src/dir.rs::Ignore::matched` 先消费 override，随后 ignore 规则，再消费 Types；ignore 结果可立即返回，类型 whitelist 会更新最终保留的 whitelist。不能将本目录的类型结果提升为整个 Ignore 的最终结论。serial／parallel Walk 与公开 `IncrementalIgnore` 经原 Ignore 匹配链消费该结果，`IncrementalIgnore` 的叶路径及祖先隐藏判定还直接消费 `is_hidden_path`，这两条消费者不可混同。

`Types::matched` 在原 `types.rs` 中调用 `pathutil::file_name`。P 的 Unix 实现会拒绝任何以 `.` 结尾的整个路径；Q 只拒绝最终分量 `.`／`..`。例如 `file.` 在 P 进入“无文件名”分支，在 Q 进入 glob 匹配；具体 ignore／whitelist 结果由本目录的 hasSelected、选择顺序及 glob 真正匹配共同决定。Q 没有授权更改类型表、选择优先级、include 规则或非 Unix filename 行为。

## 尚未交付的实际源码义务

| 剩余对象 | 精确缺项与应接的责任 |
|---|---|
| `add` 的 Unicode 验证 | 需要实际 Text→Unicode scalar 分解和与所选 Rust 工具链 `char::is_alphanumeric` 同一 Unicode 数据版本的分类；不是 ASCII 字母数字检查。`allCharactersAlphanumeric` 当前是带来源义务的输入，尚无实际 binding |
| `add_def` 文本语法 | 需要按 `str::split(':')` 保留空字段／尾字段，恰好 2 或 3 项；3 项中第二项准确为 `include`、第三项原字符串非空，再按逗号保留空项切分。`AfterLexing` 函数没有隐藏执行这些步骤；尤其不能将空第三项的 `[""]` 当成已合格 include |
| `definitions()` | 实际 Rust 字典序比较、稳定保留重复的 globs 排序及 definitions 名称排序；须生成显示副本，不改编译／匹配用的原加入顺序 |
| `all` 的集合遍历 | `IsExactKeyEnumeration` 已验证集合内容，但没有取得原 HashMap 的同次枚举事实；需要合格映射表示／保持观察范围，不能以排序或固定种子暗改原合同 |
| glob 构建与匹配 | `GlobBuilder::literal_separator(true)` 的解析/编译、GlobSetBuilder.add/build、GlobSet 的原有有序 index 结果、空集合语义；相交 parser 作者模块为 `ripgrep:globset:parser`，其 `ParseScalars` 可供后续整合，不等于此处已绑定整个编译／集合 |
| BuildCursor 执行消费者 | 需要真实消费者执行 CompileGlob 的编译及加入构建器，正常完成后调用 `AdvanceAfterGlobSuccess`，采用 Some 的下一 cursor；编译／加入失败不得调用推进函数，推进失败不得继续；最后 AssembleSet。上述先后关系已在作者协议和主体中固定；实际 GlobSet／Regex 及资源清理消费者尚未接通 |
| `Types::matched` 接线 | 需要按 MatchStep 顺序取得 P/Q／平台对应 filename，之后才借用线程安全匹配缓存并调用 globset；无效证据不能转成业务 NoMatch |
| 公共类型、错误和借用 | 需要原 `Types`／`Glob<'a>`／`FileTypeDef` 的公开访问、Clone/Debug、生命周期／线程安全、Error 外层投影和资源释放的保持；当前值模型不签发 ABI 等价 |
| 入口、构建与交付 | 需要真实 Gift 类型／链接／目标消费者、完整工程 roots 采用和上述 native 区域唯一作者迁出。当前未修改 Rust 区域，不能称现有 materialize 已经消费本目录 |

这些缺项不能通过把整个 `ignore::types::Types` 设为一个原生函数供给来关闭。文本拆分／Unicode 性质／字典序属于公共细粒度能力；glob parser、regex/set 属于独立实现责任；类型选择规则已经在本目录有可审查主体。若后续采用新的公共基本能力，直接把相应实际主体接上，不保留第二份选择规则。

## 本次检查与未执行验证

已执行：两份 JSON 的严格重复键检查；canonical `Expansion` 展开；所有 local/import/std 引用存在性与当前 std 名单检查；函数主体的局部变量作用域检查。成功边界修订后，两模块合计 59 个定义，203 个引用位置通过核对。完整默认表字节未变，复用其结构读取、219/224/594/609 计数及别名唯一性结果。这些检查不提供生产类型检查、运行或等价证明。

本次成功边界差额另外执行 17 项受限 Expr／调用 trace 断言：请求首 glob 时不调用 AppendSlot；人工注入编译错误时不推进；模拟编译成功和 set-add 成功后才追加准确映射；原 cursor 不变，下一 cursor 只消费一个 glob；第二个请求不急切追加；后续未知类型只在先前 globs 成功后出现；inactive 或空 pending cursor 返回 None 且不追加。期望值和边界按上游原顺序人工固定，编译／加入采用显式 trace stub；这不是实际 globset、Gift runtime 或分配失败的运行证据。

首次规范 codec 尝试在模块展开前被并发修改中的 Schema 图 `extension old node mismatch` 拒绝。主线程同步真实 opaque 语义变更的前像后，重建现行 canonical 图并展开本目录两模块已经通过；没有删掉前像检查或另建宽松 decoder。完整 Schema 检查仍交由主线程绑定最终文件修订统一执行。

本次实际读取的结构与值 owner 为 `schema/author/universal-author-module-2.schema.json`、`schema/author/first-layer/convergence-examples.schema.json`、`schema/author/first-layer/codec-parameters.json`；展开使用 `tools/documentation/codec_parameters.py` 与 `author_codec_spec.py`。相交语义按 `docs/领域/计算基础/文法类型与求值.md` 的固定 std、Text、有限值和终止合同，以及 `docs/作者/组合/结构编辑与身份保持.md` 的字段／复制／调用资格读取。Schema、纯展开与生产类型解释属于不同证据层。

未执行：生产 Gift 解释／编译、目标 Rust 生成、真实 Types 替换、Unix／非 UTF-8 文件名路径、并行缓存与释放、真实资源差错注入、四对象 P/Q 运行等价、性能／分配和公众借用兼容性。本目录没有运行 Cargo、联网、安装依赖或修改已有原生文件。

上述反例来自已读原始语义的独立人工推演，未把同一作者 AST 产生的结果再作为自身 oracle。一次性数据读取与 JSON 构造辅助只用于书写，交付作者源为两份 JSON；它没有生成任何 Rust，不作为编译器或第二份作者真相保留。
