# ripgrep Flag 定义与更新：源码映射和开放接合

本页只覆盖固定上游 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/core/flags/defs.rs`、`flags/mod.rs` 中的 `Flag` 合同与本目录 `defs*.module.json` 候选。Q `7155f6408d370e699795dc75e954635abfaf08a6` 的这两个 Git blob 与 P 字节相同：`defs.rs` SHA-256 `6f63d96fcb519a8d2ea80c43362e5a1e453a383094e2258be4fe8400d54ed63e`，`mod.rs` SHA-256 `ec1627d2defce72bf5180a28f6e0a50c986cc261624c4927899da0eac7f64b0d`。这不宣称 P→Q 工程其他部分不变。

P `mod.rs` 的 `Flag` 有 12 个方法，以 `Debug + Send + Sync + UnwindSafe + RefUnwindSafe + 'static` 为前提，元数据中的字符串与切片是 `'static` 借用；`update` 以独占借用修改同一 `LowArgs`。`defs.module.json` 表示方法和前五项 trait 的要求，但当前相应共同供给及 `'static` 资格尚未全解析。每个 P 单元 struct 的名义身份在 `defs-identities.module.json`；103 个静态元数据实现位于对应的 `defs-impl-*.module.json`。`HyperlinkFormat` 的更新存在，其完整 `Flag` 实现**尚未创建**：P `defs.rs:2916–3038` 用 `LazyLock`、`hyperlink_aliases` 与 `display_priority().unwrap_or(i16::MAX)` 的稳定排序形成长文及 `'static` 借用切片。必须保持 DOC、CHOICES、BORROWED 三个独立的延迟初始化、其依赖、共享引用与真实别名来源；不可把今天的列表或空值硬编码为替代。

P `defs.rs:46` 的 `FLAGS` 是顺序明确的 `const &[&dyn Flag]`，而不是独立 `static`。条目借用需要准确的静态提升及对象生命周期，但这不保证同一地址；parser 自己的 `OnceLock<Parser>` 是独立状态。当前作者文件尚未提供这个异质 trait-object 切片及 `defs:FLAGS`、`defs:NameLong`、`defs:Update` 等真实分发接口。共同语义需要具备真实 dyn、静态提升/生命周期和分发资格；不能用按 flag 枚举、虚构业务回调或 Rust wrapper 假装该接口已经闭合。

以下顺序直接对应 P 的 `FLAGS`；行号是对应 `update` 方法所在的 `defs.rs` 行。`更新主体`一栏指现有普通 Gift 作者函数，同一行名为 `Update` 加原 struct 名。该表是逐项来源和实际候选定位，不是可运行性证明。

| Flag | P update 行 | 更新主体 |
|---|---:|---|
| `Regexp` | 5890 | [defs-values.module.json](defs-values.module.json) |
| `File` | 2028 | [defs-values.module.json](defs-values.module.json) |
| `AfterContext` | 186 | [defs-context.module.json](defs-context.module.json) |
| `BeforeContext` | 371 | [defs-context.module.json](defs-context.module.json) |
| `Binary` | 481 | [defs-switches.module.json](defs-switches.module.json) |
| `BlockBuffered` | 549 | [defs-switches.module.json](defs-switches.module.json) |
| `ByteOffset` | 611 | [defs-switches.module.json](defs-switches.module.json) |
| `CaseSensitive` | 669 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Color` | 764 | [defs-choice.module.json](defs-choice.module.json) |
| `Colors` | 892 | [defs-formats.module.json](defs-formats.module.json) |
| `Column` | 974 | [defs-switches.module.json](defs-switches.module.json) |
| `Context` | 1031 | [defs-context.module.json](defs-context.module.json) |
| `ContextSeparator` | 1172 | [defs-separators.module.json](defs-separators.module.json) |
| `Count` | 1294 | [defs-asserted.module.json](defs-asserted.module.json) |
| `CountMatches` | 1357 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Crlf` | 1418 | [defs-state.module.json](defs-state.module.json) |
| `Debug` | 1484 | [defs-asserted.module.json](defs-asserted.module.json) |
| `DfaSizeLimit` | 1537 | [defs-numbers.module.json](defs-numbers.module.json) |
| `Encoding` | 1630 | [defs-formats.module.json](defs-formats.module.json) |
| `Engine` | 1735 | [defs-choice.module.json](defs-choice.module.json) |
| `FieldContextSeparator` | 1812 | [defs-separators.module.json](defs-separators.module.json) |
| `FieldMatchSeparator` | 1920 | [defs-separators.module.json](defs-separators.module.json) |
| `Files` | 2155 | [defs-asserted.module.json](defs-asserted.module.json) |
| `FilesWithMatches` | 2208 | [defs-asserted.module.json](defs-asserted.module.json) |
| `FilesWithoutMatch` | 2253 | [defs-asserted.module.json](defs-asserted.module.json) |
| `FixedStrings` | 2314 | [defs-switches.module.json](defs-switches.module.json) |
| `Follow` | 2372 | [defs-switches.module.json](defs-switches.module.json) |
| `Generate` | 2452 | [defs-choice.module.json](defs-choice.module.json) |
| `Glob` | 2554 | [defs-values.module.json](defs-values.module.json) |
| `GlobCaseInsensitive` | 2619 | [defs-switches.module.json](defs-switches.module.json) |
| `Heading` | 2683 | [defs-switches.module.json](defs-switches.module.json) |
| `Help` | 2740 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Hidden` | 2810 | [defs-switches.module.json](defs-switches.module.json) |
| `HostnameBin` | 2875 | [defs-path.module.json](defs-path.module.json) |
| `HyperlinkFormat`（动态文档 witness 未闭合） | 3041 | [defs-formats.module.json](defs-formats.module.json) |
| `IGlob` | 3120 | [defs-values.module.json](defs-values.module.json) |
| `IgnoreCase` | 3181 | [defs-asserted.module.json](defs-asserted.module.json) |
| `IgnoreFile` | 3246 | [defs-values.module.json](defs-values.module.json) |
| `IgnoreFileCaseInsensitive` | 3298 | [defs-switches.module.json](defs-switches.module.json) |
| `IncludeZero` | 3357 | [defs-switches.module.json](defs-switches.module.json) |
| `InvertMatch` | 3412 | [defs-switches.module.json](defs-switches.module.json) |
| `JSON` | 3504 | [defs-modes.module.json](defs-modes.module.json) |
| `LineBuffered` | 3572 | [defs-switches.module.json](defs-switches.module.json) |
| `LineNumber` | 3629 | [defs-asserted.module.json](defs-asserted.module.json) |
| `LineNumberNo` | 3682 | [defs-asserted.module.json](defs-asserted.module.json) |
| `LineRegexp` | 3739 | [defs-asserted.module.json](defs-asserted.module.json) |
| `MaxColumns` | 3791 | [defs-numbers.module.json](defs-numbers.module.json) |
| `MaxColumnsPreview` | 3851 | [defs-switches.module.json](defs-switches.module.json) |
| `MaxCount` | 3912 | [defs-numbers.module.json](defs-numbers.module.json) |
| `MaxDepth` | 3976 | [defs-numbers.module.json](defs-numbers.module.json) |
| `MaxFilesize` | 4036 | [defs-numbers.module.json](defs-numbers.module.json) |
| `Mmap` | 4095 | [defs-switches.module.json](defs-switches.module.json) |
| `Multiline` | 4187 | [defs-state.module.json](defs-state.module.json) |
| `MultilineDotall` | 4254 | [defs-switches.module.json](defs-switches.module.json) |
| `NoConfig` | 4302 | [defs-asserted.module.json](defs-asserted.module.json) |
| `NoIgnore` | 4355 | [defs-state.module.json](defs-state.module.json) |
| `NoIgnoreDot` | 4421 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreExclude` | 4467 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreFiles` | 4514 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreGlobal` | 4561 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreMessages` | 4610 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreParent` | 4659 | [defs-switches.module.json](defs-switches.module.json) |
| `NoIgnoreVcs` | 4716 | [defs-switches.module.json](defs-switches.module.json) |
| `NoMessages` | 4763 | [defs-switches.module.json](defs-switches.module.json) |
| `NoRequireGit` | 4865 | [defs-switches.module.json](defs-switches.module.json) |
| `NoUnicode` | 4938 | [defs-switches.module.json](defs-switches.module.json) |
| `Null` | 4992 | [defs-asserted.module.json](defs-asserted.module.json) |
| `NullData` | 5047 | [defs-asserted.module.json](defs-asserted.module.json) |
| `OneFileSystem` | 5117 | [defs-switches.module.json](defs-switches.module.json) |
| `OnlyMatching` | 5164 | [defs-asserted.module.json](defs-asserted.module.json) |
| `PathSeparator` | 5216 | [defs-pathseparator.module.json](defs-pathseparator.module.json) |
| `Passthru` | 5310 | [defs-asserted.module.json](defs-asserted.module.json) |
| `PCRE2` | 5377 | [defs-switches.module.json](defs-switches.module.json) |
| `PCRE2Version` | 5434 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Pre` | 5530 | [defs-path.module.json](defs-path.module.json) |
| `PreGlob` | 5617 | [defs-values.module.json](defs-values.module.json) |
| `Pretty` | 5667 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Quiet` | 5726 | [defs-asserted.module.json](defs-asserted.module.json) |
| `RegexSizeLimit` | 5798 | [defs-numbers.module.json](defs-numbers.module.json) |
| `Replace` | 6030 | [defs-path.module.json](defs-path.module.json) |
| `SearchZip` | 6100 | [defs-modes.module.json](defs-modes.module.json) |
| `SmartCase` | 6179 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Sort` | 6358 | [defs-choice.module.json](defs-choice.module.json) |
| `Sortr` | 6460 | [defs-choice.module.json](defs-choice.module.json) |
| `Stats` | 6551 | [defs-switches.module.json](defs-switches.module.json) |
| `StopOnNonmatch` | 6598 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Text` | 6671 | [defs-switches.module.json](defs-switches.module.json) |
| `Threads` | 6740 | [defs-numbers.module.json](defs-numbers.module.json) |
| `Trace` | 6794 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Trim` | 6841 | [defs-switches.module.json](defs-switches.module.json) |
| `Type` | 6904 | [defs-values.module.json](defs-values.module.json) |
| `TypeNot` | 7126 | [defs-values.module.json](defs-values.module.json) |
| `TypeAdd` | 6994 | [defs-values.module.json](defs-values.module.json) |
| `TypeClear` | 7054 | [defs-values.module.json](defs-values.module.json) |
| `TypeList` | 7191 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Unrestricted` | 7246 | [defs-modes.module.json](defs-modes.module.json) |
| `Version` | 7320 | [defs-asserted.module.json](defs-asserted.module.json) |
| `Vimgrep` | 7387 | [defs-asserted.module.json](defs-asserted.module.json) |
| `WithFilename` | 7436 | [defs-asserted.module.json](defs-asserted.module.json) |
| `WithFilenameNo` | 7489 | [defs-asserted.module.json](defs-asserted.module.json) |
| `WordRegexp` | 7549 | [defs-asserted.module.json](defs-asserted.module.json) |
| `AutoHybridRegex` | 290 | [defs-state.module.json](defs-state.module.json) |
| `NoPcre2Unicode` | 4810 | [defs-switches.module.json](defs-switches.module.json) |
| `SortFiles` | 6243 | [defs-modes.module.json](defs-modes.module.json) |


## 行为核对及边界

- 32 个一般 switch 的字段、`Some`、枚举分支分别按 P 两种开关值核对；29 个必须启用的 switch 核对成功时按顺序写入、禁用时的 panic 及写入前短路。`Files` 使用原无消息 assertion 的默认消息；`Help`/`Version` 的更新只 assertion，实际短路属于 parser。
- 其余 43 个逐项核对普通赋值和顺序追加、上下文转换失败不写、`max-columns=0`/`threads=0`、各 choice 及错误、`--no-json` 只撤销 JSON、`--pre` 与 `--search-zip` 顺序、无约束级数的饱和递增及第 4 次错误。三个 separator 将转换错误向上传递；`PathSeparator` 区分零、一、多字节，错误文本保留原输入。`Encoding` 和 `ContextSeparator` 的非法 true switch 保留 Rust `unreachable!` 的 `internal error: entered unreachable code: ` 消息前缀。
- 使用现有受限 Expr 执行器和明确 stub 试算上述分支、返回、写入顺序与错误前状态；转换、字符/数字、bstr 和外部解析器的 stub 不是这些真实库的执行。还对 103 个已表达 witness 的每个显式静态元数据字面值及 `update` 目标与 P 逐值比较，并按默认方法确定未覆盖成员；只有 `HyperlinkFormat` 的两个动态方法不属于此比较。全部 `defs` 函数经严格 JSON、词法变量及本地引用检查。检查结果不证明生产 Reader、完整类型/效果/借用检查、native 链接、资源与析构顺序、目标编译或实际 runtime；具体源码或环境变化后须重新绑定证据。
- `convert` 的 `Str` 借用原 `OsStr` 且结果寿命跟输入；`String` 消费 `OsString`。数字转换保留原 `value is not a valid number`、人类可读大小的 `invalid size` 上下文和 `usize` 溢出的 `size is too big`。实际 Rust 数字解析及 `grep::cli::parse_human_readable_size` 仍须各自由真实供给与错误链保证。
- `ContextMode` 更新目前经 `TakeValue`、纯值 setter 与写回；必须证明其默认 trait、临时默认状态、借用、展开/Drop 与原 `&mut` 更新保持，不能仅从终态相同签发等价。`Mode` 的 Copy、原 `Mode::update` 行为、字段可见性和 `LowArgs` 的真实字段表示仍须共同类型和目标检查。序列 push 必须采用与原 `Vec` 的真实构造、容量、溢出和析构保持的供给；逻辑 `Sequence` 标签自身不证明这一点。

## 精确未闭合供给

1. `ripgrep:foundation:static` 的 `Str`、`StrSlice`、`EmptyStrSlice` 与 `&'static str`、`&'static [&'static str]` 的实际构造、存储及借用；当前名义 literal 和 JSON 列表没有凭外形取得真实静态身份。短名 `Option<machine:Byte>` 及 unrestricted 的字节输入同样尚未取得 `uint(8)` 到真实 `u8` 的合格 codec/类型关系。
2. `machine:Send/Sync/UnwindSafe/RefUnwindSafe` 及 104 个具体单元类型的 `Debug` 与 auto trait 资格、`'static` 约束；名字或 record 外形不能提供 witness。`Flag` 本身的 12 方法、默认值与每个 receiver/参数/错误/效果上界还需真实类型和目标逐项检查。
3. `machine:StrEqualStatic/ParseUsize/ParseU64/UsizeTryFromU64/UsizeSaturatingAdd/TextIntoBytes` 和 `path:OsStringIntoString` 等直接机器能力当前没有对应公开供给；真实标准库接口应按具体签名/错误/借用引入，不得用 flag 专用 native callback 替代。`ripgrep:external:anyhow`、`ripgrep:external:bstr`、`ripgrep:foundation:collections`、`ripgrep:cli:human`、`ripgrep:printer:color`、`ripgrep:printer:hyperlink`、`ripgrep:searcher:encoding` 尚需实际模块和合格调用。
4. `std:TextConcat` 的目标资格须与 Rust 原错误格式化的分配、失败、Unicode 和所有权行为对齐。所有 place 的受限借用和 fresh Region 需由共享语义及目标实现真实支持，不从手写回调或此处字面结构推断。
5. `HyperlinkFormat` 动态文档需要同一 alias 源、稳定排序、`LazyLock` 初始化与永久借用供给；`FLAGS` 的确切 104 个值、P 顺序、const 提升、对象安全及动态方法分发需连同 parser、help、man 和 completion 真正装配。即使结构全部合法，也必须独立检验初始化异常、线程、借用、所有权、类型、effect 与实际运行。

本次保留原始 `.tmp/whole-engineering-20261025` 中已有上游检出、census 与通用受限求值器作为辅助证据，未清理其他工作者的文件。无代码提交、推送或合并。对于跨本目录的缺项由各唯一 owner 决定和实现，不在本目录复制第二份共同能力或虚构业务 wrapper。

后续续接可先按 P/Q 的 Git blob 字节身份判断本片源码是否变化，再用 `FLAGS` 顺序及 struct 名连接上游行号与唯一 `Update`；相似 switch 共用同一套来源派生检查，复杂转换只核其独立失败和状态分支。实际共享类型、调用或源字节一变，按受影响闭包重新检查；既有 stub 结果不可升级成真实链接或替代后续验证。
