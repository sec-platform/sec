# ripgrep 局部混合原型的案例画像

本画像绑定此前只迁Unix路径函数的混合原型。它的源保全、调用关系与有界证明继续有效，但不能满足整个ripgrep转成Gift开发面源码的当前目标；十个native产品根不等于十个Gift作者模块已完成。后续全量作者层在`author/`推进，不能用本画像提前签发完成。

本文定义本例新设计的两个画像：

- SourceProfile：id `example:ripgrep-cargo-source`，revision `"1"`。
- Target：id `example:ripgrep-cargo-rust`，revision `"1"`。

这些 ID 是本次设计声明，**不表示已经安装、执行或取得生产资格**。本文是案例画像，不新增公共 Schema、全局 registry、通用 compiler 分派或另一份 Cargo 依赖锁。本轮交付是完整工程设计及相交等价审查；生产 Reader、编译、测试、生成物运行与发布均不能由本文签发 PASS。

P 的原生检查点是 `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`，tree 为 `e41450e1cd2b5b7a3fef684b5c38cf5d504fc030`；Q 的原生检查点是 `7155f6408d370e699795dc75e954635abfaf08a6`。名称 P/Q 只指本例固定版本，不能成为通用编译器中的业务分支。具体实例采用哪份模型、方法和原生前像，由该实例的准确材料与绑定固定；若修复了 P 的行为，必须把对 Q 的保持与相对 P 的有意差额分开，不笼统声称 P/Q 全域等价。

## 1. 作者边界与唯一写源

本例是**完整混合作者工程**。CLI、九个库、所有 P/Q 跟踪源、配置、测试、维护入口、许可证和资产均保留。原生 Rust 文件继续是可编辑 native 作者源；`flags/defs.rs`、`flags/parse.rs`、`main.rs` 的业务决定不改写为 JSON，不改称外部 supplier，也不经过 Args/Error/Effects/CommandSupply 回调表。

唯一迁出的算法区域是 `crates/ignore/src/pathutil.rs` 中 `file_name` 的 `#[cfg(unix)] imp` 内部算法。其模型主体由本例 Gift 模型拥有；平台边界仍由 native wrapper 拥有。普通 Rust 借用方法是该模型的独立实现供给，保持证明连接二者；它不是按 projectId、版本名或 fixture 命中生成代码的编译器。

每个独立实例以该实例目录为路径基础，Cargo workspace 根固定为 `native/`：

| 对象 | 实例中的位置与唯一责任 |
| --- | --- |
| 保留的 native 作者工程 | `native/` 下原 Cargo 布局及所有实际成员；允许后续原生编辑 |
| Unix 平台 wrapper | `native/crates/ignore/src/pathutil.rs` 的原 `file_name`；只负责取得 OsStr 字节、调用绑定方法和把返回借用转换为 OsStr |
| 方法唯一 Rust 源 | `native/crates/ignore/src/gift_path_policy.rs`；实例内后续修改只在这里发生 |
| 私有模块接合 | `native/crates/ignore/src/lib.rs` 中 `#[cfg(unix)] mod gift_path_policy;` |
| Gift 模型 | 实例实际采用的模型文件；拥有该字节算法的模型主体，不复制 CLI/九库的 native 主体 |
| 编译产物与分析视图 | 派生结果；不取得上述源的写权 |

方法模块保持 private。方法函数采用 `pub(super)`，使声明所在的 crate 根及其后代 `pathutil` 可合法访问；不向 ignore 的公共 API 新增出口。函数的真实符号由方法材料及实际源码绑定，不能凭文件名猜测或生成同名空函数。

分发材料 `methods/P/path_policy.rs`、`methods/Q/path_policy.rs` 是版本化创建材料。materialize 只创建**全新实例**并拒绝覆盖已有实例；复制到实例上述位置后，不在同一实例保留第二个同义可写方法文件。分发检查点不会自动覆盖实例编辑，实例编辑也不隐式回写分发材料。P/Q 实例彼此独立，不指向同一个可写源。以后重建现有实例必须消费该实例当前作者源；重新从分发材料创建的是另一实例，不是恢复并保留现有编辑。

## 2. SourceProfile 的十个模块根

SourceProfile 消费实际 Cargo manifest、锁和源，不从目录名推导 package 或 crate。下表依据固定参考工程的 manifests 给出十个产品根。ModuleView ID 后缀使用实际 target/crate 名；package 名另列，不能把连字符 package 名与下划线 crate 名互换。

表内路径相对实例的 `native/`。ID 是本例稳定逻辑说明；准确版本、实例和配置另由绑定确定，不把路径、P/Q 标签或 ID 拼写当作内容身份。

| ModuleView ID | Cargo package | kind / target、crate 名 | manifest | 根源 |
| --- | --- | --- | --- | --- |
| `module:ripgrep:bin:rg` | `ripgrep` | bin / `rg` | `Cargo.toml` | `crates/core/main.rs` |
| `module:ripgrep:lib:globset` | `globset` | lib / `globset` | `crates/globset/Cargo.toml` | `crates/globset/src/lib.rs` |
| `module:ripgrep:lib:grep` | `grep` | lib / `grep` | `crates/grep/Cargo.toml` | `crates/grep/src/lib.rs` |
| `module:ripgrep:lib:grep_cli` | `grep-cli` | lib / `grep_cli` | `crates/cli/Cargo.toml` | `crates/cli/src/lib.rs` |
| `module:ripgrep:lib:grep_matcher` | `grep-matcher` | lib / `grep_matcher` | `crates/matcher/Cargo.toml` | `crates/matcher/src/lib.rs` |
| `module:ripgrep:lib:grep_pcre2` | `grep-pcre2` | lib / `grep_pcre2` | `crates/pcre2/Cargo.toml` | `crates/pcre2/src/lib.rs` |
| `module:ripgrep:lib:grep_printer` | `grep-printer` | lib / `grep_printer` | `crates/printer/Cargo.toml` | `crates/printer/src/lib.rs` |
| `module:ripgrep:lib:grep_regex` | `grep-regex` | lib / `grep_regex` | `crates/regex/Cargo.toml` | `crates/regex/src/lib.rs` |
| `module:ripgrep:lib:grep_searcher` | `grep-searcher` | lib / `grep_searcher` | `crates/searcher/Cargo.toml` | `crates/searcher/src/lib.rs` |
| `module:ripgrep:lib:ignore` | `ignore` | lib / `ignore` | `crates/ignore/Cargo.toml` | `crates/ignore/src/lib.rs` |

完整 public set 是**固定 crate 实例和配置下，依 Rust 可见性从该根实际可达的全部公开成员集合及其类型、合同闭包**，包括合法公开子模块、重导出、类型、构造器/变体、traits、可访问关联项、函数、常量、statics 和 macros。保留原定义身份、公开路径、重导出别名、泛型、条件成员及来源；同名不能合并不同定义。公开类型不自动公开其 private 字段。集合从实际源与编译上下文派生，不能用手写若干函数或 grep 的 pub 行数代替。

九库分别形成 public-set 根；即使某成员不被 rg 调用，也不能从完整库交付中删除。一次具体构建按所选 features/cfg 解释成员；整个设计保留各条件分支及其输入义务，不把互斥配置的成员拼成一个虚假的单次构建集合，也不把当前未选分支视为可以丢弃的源。新增、删除、重导出或可见性变化使相交集合依赖失效。

`rg` 的根还包含本 Target 明确认可的**非公开二进制入口** `crates/core/main.rs::main`。它不是一个伪造的 public export。Target 从 Cargo 的 `[[bin]] name="rg"` 与 `path="crates/core/main.rs"` 取得入口，按该固定 Rust 入口合同处理；不能因为默认公开集合为空就返回空 ArtifactSet 并声称 CLI 完成，也不能选第一个私有函数当 main。对普通 import 或显式 export 的 private 访问仍然拒绝。

十个产品根不是全仓所有 Cargo target 或工程资产的数量。实际 manifest 中的 integration test、其他测试、构建脚本、维护/fuzz 工程及其独立入口继续保留并按原 membership 与调用条件解释；不从产品根表消失就失去作者身份。包发布 exclude 也不是 SourceScope 删除清单。

## 3. 准确输入与读取规则

每次分析固定一个实例和一份候选。最小实际输入闭包包含：

1. 当前采用的全部 native 作者字节、Gift 模型、方法源、平台接合及各自来源/前像；P/Q 分发材料和当前实例分别标明，不允许静默混合。
2. 根与成员 `Cargo.toml`、`Cargo.lock`、Cargo workspace/target 成员关系、依赖源与锁定内容。已有生态解析由 Cargo 责任承担，不另维护竞争 semver 解算。
3. 真实 Rust 工具链/标准库、edition、rust-version、host 与 target triple、features、cfg、profile、panic/overflow 等实际编译选项及影响解释的环境。固定参考 workspace 为 edition 2024、rust-version 1.96；个别成员的独立声明仍按其真实 manifest 读取，不能被这个 workspace 摘要覆盖。
4. 实际 Cargo 配置、其查找路径与负依赖，链接器/本地库条件，以及宏、`include!`、`include_str!`、`include_bytes!`、build.rs 和生成输入的实际闭包。依赖不存在、未取得与配置中明确关闭必须区分。
5. 构建脚本读到的环境、工具与文件及其冻结输出。此工程根 build.rs 会读取目标 OS/env、Windows manifest，并执行 `git rev-parse --short=10 HEAD` 取得版本显示材料；不能让新实例意外捕获外层 SEC 仓库的 Git 状态。实例须具有本例明确的版本上下文或保留该项未闭合，不伪造运行结果。
6. 文档、许可证、平台资源、补全与 man 生成素材、部署/打包配置、测试数据和维护脚本等实际成员及消费关系。源成员完整性、构建读取闭包和发行成员集合分别保留，不能用一个集合代替其余两个。

只读发现/导入不自动执行宏、build.rs、外部工具、依赖安装或联网。没有冻结输出时可继续保存完整设计与源，并准确标出未来构建输入；实际执行须在获准环境取得这些内容。路径位于 native SourceScope 只说明候选输入范围，不授予编译工具任意读盘、写源或扩大可见性的权限。

SourceProfile 由真实语言前端或已接受合同导入器形成只读模块/类型/调用视图。完整 native 接口已有类型与公开集合时不要求另写 callable/predicate selection 文件。观察签名不改变原作者所有权，也不把 native 模块提升为另一份 Gift 主体。

## 4. 模型、借用方法与平台接合

模型算法和普通 Rust 方法分别是语义源与一个实现，保持关系由本例独立审查材料给出。采用后的 Unix wrapper 必须只完成：

1. 从原 `&Path` 取得 `&OsStr`，再按 Unix `OsStrExt::as_bytes` 取得借用。
2. 普通调用本实例 `gift_path_policy` 中已绑定的真实方法。
3. 将 Some 返回字节切片通过 Unix `OsStrExt::from_bytes` 转成同一输入上的 OsStr 借用；None 原样返回。

原 `imp` 不再保留同义分支算法；`file_name` 外层泛型、调用点与 non-Unix 分支继续 native。Windows 的元数据/隐藏属性路径及其他 pathutil 函数均不借此次迁移改义。

方法必须具备 `for<'a> fn(&'a [u8]) -> Option<&'a [u8]>` 的真实借用关系：返回切片来自输入，寿命不越过输入；空值、索引与切片范围符合模型。域是原 Unix 路径字节，而非 UTF-8 字符串，不做 Unicode 解码、规范化或有损转换。不能用拥有的 String/Vec、全局缓存、Arc 或复制结果替代原借用。

方法保持零堆分配、不执行文件系统/进程/网络/时钟/随机操作，不产生新可见共享状态；安全切片操作须由边界证明排除越界。这里是设计与保持证明的义务，源文件存在或签名匹配不是这些性质的执行证据。

共同 Borrow/Region、参数模式、noescape 和 Drop/清理合同各有独立含义。真实 Rust 签名和固定方法体支持哪些关系，由相交检查取得；不以类型名或 noescape 一项替代生命周期证明。此同步调用没有把输入保留到调用之后的接口，也不创建任务域。

## 5. Target 的组合与发行范围

### 本例准确的模型—方法—使用点选择

下面是两个分发检查点的**设计绑定**，由本 Target 画像负责解释；它不是已封存的 RealizationBinding、UseBinding 或生产资格回执。`materialize.ps1` 只装配这些已写好的源，不执行该解释。未来实现若不能取得下列绑定，必须返回缺项，不能绕过模型直接把 Cargo 成功当作 Gift 成功。

| 绑定边 | 准确设计 |
| --- | --- |
| 主体与出现 | 模块 `ripgrep:ignore:unix_path_policy` 的公开定义 `FileName`；相交 native 出现是 ignore crate `pathutil::file_name` 中 `#[cfg(unix)] imp` 的唯一 helper 调用 |
| 根可达性 | `module:ripgrep:lib:ignore` 是显式产品根；其 Unix `file_name` 使用点通过本绑定选择 `FileName`，从而把该模型和实际调用的本地辅助定义纳入闭包。其他经 ignore 到达的产品根复用同一 crate 实例。非 Unix 路线保留完整模型源，但不执行本使用点；不可达的 `IsHiddenPathOnly` 不会因此默入生成任务 |
| 适用域 | 有限 Unix OsStr 字节序列；每项为 0..255；仅固定 native crate 实例的 cfg(unix)；不承诺所有数学 Int 序列或非 Unix Path 规则 |
| 方法 | 实例唯一文件 `native/crates/ignore/src/gift_path_policy.rs` 的 `file_name`；限定使用域为 ignore crate 的 private 模块，签名 `for<'a> fn(&'a [u8]) -> Option<&'a [u8]>` |
| 表示关系 | 输入切片的字节顺序对应模型 Sequence<Int>；返回 None/Some 与模型 Option 一一对应；Some 的字节值与输入内同一后缀、指针及寿命关系同时保持。这里是抽象关系，不在运行时物化 Sequence、Vec 或 String |
| 使用点转换 | 唯一 wrapper 使用 Unix `as_bytes` 和 `from_bytes`；两次均为借用视图，参数原输入、返回原后缀，不复制，不做文本转换，不提升可见性 |
| 资格及残余 | `EQUIVALENCE.md` 给出相交结构论证；实际 Reader、类型/效果/借用检查、方法资格签发、Target 绑定与 Unix 运行均尚未执行，不能把本表当成通过的锁 |

分发内容绑定采用下表 SHA-256，指向实际完整文件字节。绑定到内容，不能通过 P/Q 标签推断算法：

| 分发检查点 | `models/<检查点>/path-policy.module.json` | `methods/<检查点>/path_policy.rs` |
| --- | --- | --- |
| P | `7a1a1d4f44640a6bc2d70d5d57faf62ea2581947ca11693590da4afdccbccb8f` | `6064f2ba9f9d7f80918ab4149d74227171b1f13ea5d4f9de82c631f5bc55d38b` |
| Q | `f0fb0eb9463661691488e194c676684d976f95d349edfdfa5e5fec55e25be171` | `da833e7a860eaaebcbe3721cbbbc55f9cbfd852207d1380b7b2cafdd96852f7c` |

模型、其展开输入/标准纯基底、方法、wrapper、crate 实例、cfg/features、依赖或目标上下文任何相交变化，都使旧保持/使用绑定失效，必须在新候选上重新取得相交证明。模型改变而 native 方法未改变时不能沿用旧资格；方法改变而模型未变时也不能自称等价。P→Q 是作者对模型和方法的同一次有意修订，Q 的原生回归测试随 Q 源保留。原 native `is_hidden_path_only` 继续拥有隐藏判定正文；模型中的 `IsHiddenPathOnly` 是对消费者的论证模型，不是第二个运行时正文。

### 组合与输出

Target 消费十个固定产品根、整个保留工程及准确模型/方法绑定。已有 native 主体保持其原生语言解释与 Cargo 成员关系；它们通过正常 Rust 构建参与成品，不需要先转成共同 AST 或同义 JSON。

本次固定的方法目标位置是 `native/crates/ignore/src/gift_path_policy.rs`，并在同一 ignore crate 内通过 private cfg(unix) 模块接合。这是本例普通依赖布局；通用 compiler 不根据 projectId、ModuleView ID、P/Q 或文件名匹配去生成某个特制算法。方法源码本身由实例作者维护，Target 不重新生成并覆盖它。若方法实现改变，重新证明它与所采用模型的保持关系。

Cargo 的实际构建布局、功能开关、allocator、linker、本地库和平台资源继续有效。bin rg 与九库各自保留其成品形状及公共边界；不把库全部内联进 CLI 后称九库已经交付。发行、文档/补全生成、测试与其他维护动作按原真实入口分别处理，不由“Target 已声明”隐式触发。

类型/函数绑定在实际 crate/module 使用域内检查：`pub(crate)` 不变成跨 crate 的 pub，private 不因可读源而可导入。native opaque/名义身份、借用和条件 ABI 绑定同一个 crate 实例；不能把两个 P/Q 实例或不同 feature/config 的同名类型混用。本例无需公开 `gift_path_policy` 或给下游用户增加新 API。

Target 组合时核所有根共享成员、初始化、依赖与配置。单根设计成立不代签其余根；共享输入冲突不能以逐根“成功”消除。未来输出应绑定具体成员和构建环境；本轮未执行的编译、测试、真实输出及平台运行明确保留为未验证。

## 6. 失败、失效与重建

| 条件 | 规定结果与恢复 |
| --- | --- |
| materialize 目标实例已存在 | 拒绝覆盖；保留现有工作。选择全新实例或按另行明确的编辑流程处理 |
| manifest/锁/源/方法与固定候选不一致 | 保留具体前像差异，形成新候选；不得混用旧视图与新字节 |
| 源成员缺失、特殊路径或权限不满足 | 指出缺失的真实成员和消费根；不补空文件、不扫无授权目录 |
| Cargo target、类型或符号不存在/歧义 | 在实际上下文返回准确解析错误；不按名字造定义或选第一个候选 |
| private、pub(crate) 或模块路径不满足 | 可见性失败；不得自动改 pub、建立公开转发或另建跨 crate 逃逸接口 |
| 宏/build.rs/依赖/本地库输出未取得 | 保留具体 NativeReader/构建输入缺项；本轮设计继续，实际构建不能报告完成 |
| 效果、borrow、别名、Drop 或 native 控制通道未闭合 | 保留相交 unknown/资格缺项；不能按签名正确推纯度、无分配或运行安全 |
| 方法与模型在某输入不同 | 保留反例，修正相交唯一作者/模型或明确有意语义变化；不删反例、切版本标签绕过 |
| 非 Unix 配置 | 继续原 non-Unix 路线；不编译/调用 Unix helper，也不借此证明 Unix 保持 |
| 一个根成立、其他必需根缺项 | 保留已成立的独立设计；整个工程完成声明仍列出未闭合根 |

实际重建从实例当前唯一作者源和固定输入开始。未编辑的分发检查点可重建另一个新实例；它不能覆盖当前实例或证明当前实例的可重建性。成员、配置、来源、public set、方法/模型、类型或效果变化分别失效真实消费者；无变化时复用同一对象和环境的有效证据，不把本文 ID 当缓存充分键。

未来绑定须取得：两个画像的真实实现及准确修订、当前实例完整来源、Cargo/标准库/依赖与配置、十个根的实际视图、所选模型和方法保持材料、目标组合结果及按所需平台生成的独立验证。绑定由现有解析/使用点机制保存，本文不另建机器台账。**设计已明确、文件已保存、Schema 合法、原生程序曾通过测试、新混合工程已运行**是不同结论，逐项报告，不互相代签。
