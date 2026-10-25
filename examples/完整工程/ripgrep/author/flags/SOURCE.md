# LowArgs 作者源码

本目录只拥有固定上游 P 的 `crates/core/flags/lowargs.rs` 纵切片。上游 P 为 `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`；该文件 SHA-256 为 `172a9337d9579652838b42cb00a9c64b81fe9cbebb26a780bba6682431bf554f`。它是等价观察对象，不把 P 的注释升级为行为规范。其他代理拥有本工程其余目录。

实际作者真源为 [lowargs.module.json](lowargs.module.json)，模块身份 `ripgrep:core:flags:lowargs`；根 `ripgrep:core:flags` 将显式转导本模块与 HiArgs/ParseResult。转导不能复制名义类型身份。当前文件使用准确 `gift.author-module/2` 与仓库 `universal-author-module-2.schema.json` 的 `core:type.body.opaque` 修订；没有内嵌 Rust 方法、代码字符串、原 crate 转发或新的自由 DSL。全工程统一 Gift SourceProfile 尚未绑定，由根 PROFILES 负责；本目录不建立另一份 SourceProfile，也不沿用 Cargo SourceProfile 冒称这些 JSON 已经读入产品。

## 符号与来源

类型共 24 项，其中 23 项对应 P 的类型，另有一个用于准确错误消息的 `LowArgsError`；函数共 30 项。以下名称就是 JSON Definition ID，未导出的 `ContextModeLimitedDefault` 保持私有实现；其余明确导出只供工程内真实消费者选择，不宣称原 `pub(crate)` 自动变成对外 Rust API。

| P 源位置与符号 | Gift 定义及真实行为 |
|---|---|
| 33—104 `LowArgs` 与 derived Default | `LowArgs`、`LowArgsDefault`；全部 74 个字段逐项保留，初始化表达式按 P 字段次序排列。Option 默认 None，Vec 默认空，Bool 默认 false，unrestricted 为同一机器 UsizeZero；各具名默认使用对应定义 |
| 122—143 `SpecialMode` | 五个原构造器，独立于 Mode；其短路作用属于 parser/core，未挪入 LowArgs 默认 |
| 153—188 `Mode`、Default、update | `Mode`、`ModeDefault`、`ModeUpdate`；默认 Search(Standard)，更新精确保留 P 的实际 last-wins 行为 |
| 194—213 `SearchMode`；218—229 `GenerateMode` | 两个闭合变体，分别保留六个、五个构造器及原名字 |
| 233—318 Binary/Boundary/Buffer/Case/Color | `BinaryMode/BoundaryMode/BufferMode/CaseMode/ColorChoice`；有原 Default 的类型各有同名 Default 函数，BoundaryMode 没有伪造默认 |
| 324—334 `ColorChoice::to_termcolor` | `ColorChoiceToTermcolor`，Ansi 映射 AlwaysAnsi，其他三项保持一一映射 |
| 340—425 ContextMode | `ContextMode`、`ContextModeDefault`、`ContextModeSetBefore/SetAfter/SetBoth`、测试专用 `ContextModeGetLimitedForTest` |
| 440—464 ContextModeLimited | opaque 名义记录，三个独立 Option<Usize>；`ContextModeLimitedDefault` 与 `ContextModeLimitedGet`；返回真正 tuple Type，经准确 Pair 进口构造，不将 tuple 私自当 sequence |
| 472—507 ContextSeparator | opaque 名义记录；`ContextSeparatorDefault/New/Disabled/IntoBytes`；默认 Some(两个 0x2d 字节)，禁用为 None，Some(empty bytes) 与 None 保持不同 |
| 513—541 EncodingMode/EngineChoice | 原构造器和默认；EncodingMode.Some 引用未来同工程 Gift Encoding；此处不执行解码、BOM 或引擎 fallback |
| 550—577 FieldContextSeparator | opaque 名义记录；`FieldContextSeparatorDefault/New/IntoBytes`，默认 0x2d |
| 584—611 FieldMatchSeparator | opaque 名义记录；`FieldMatchSeparatorDefault/New/IntoBytes`，默认 0x3a |
| 616—638 LoggingMode/MmapMode | 原变体，MmapModeDefault 为 Auto；LoggingMode 无默认 |
| 645—650 PatternSource | Regexp(Text) 与 File(PathBuf)，不拆散 -e/-f 的原有输入顺序 |
| 654—670 SortMode/SortModeKind；674—705 supported | `SortMode`、`SortModeKind`、`SortModeSupported`；Path 不访问 OS，其余按 CurrentExe → Metadata → 指定时间查询执行，首个错误停止 |
| 714—723 TypeChange | Clear{name}/Add{def}/Select{name}/Negate{name} 的四种原载荷 |
| P 的三种 separator 错误与三个排序错误 | `LowArgsError` opaque message 记录、`LowArgsErrorMessage`；消息内容在本模块实际构造，外部 OS 只提供原错误 Display |

## 实际行为与保持边界

**Mode::update 的注释与实际代码冲突。** P 在 Search 分支直接赋 new；在非 Search 分支检查的仍是旧 `*self`，因此 `!matches!(*self, Mode::Search(_))` 恒真，也赋 new。故全部 13 个具体模式值之间的 169 次组合都采用 new。特别是 Files → Search(FilesWithMatches) 实际成为后者；不能照注释将它“修正”为 Files。本源 `ModeUpdate(current,next)=next` 是对这两个实际分支的直接合并，后续 consumer 必须将结果写回同一参数状态。

三个 Context setter 同样返回下一状态；caller 必须在下一 flag 更新或读取前采用该返回值。Passthru 被任一 setter 替换为 Limited，只有对应槽为 Some(lines)，另两个槽为 None。已有 Limited 仅替换对应槽；Get 先从 both 取得 fallback，再让 before/after 的 Some 覆盖。显式 Some(0) 会覆盖非零 both；`--before/--after` 的优先级不依赖其与 `--context` 的先后。这是值状态转换形式，不声称已经完成原 Rust &mut、借用或目标存储降低。

separator 的输入是借用原生 OsString，首先调用严格 ToUtf8。失败返回 P 的完整错误文本，而且不调用 UnescapeBytes；成功才将 Text 交成熟 bstr 的原 byte-unescape 合同。结果是任意 bytes，不转回 Text。IntoBytes 使用 move 参数；ContextSeparator 保留 Option 区别。三个名义类型仍各自独立，不能因内部都保存 bytes 而混用。

LowArgsDefault 只取得纯默认 HyperlinkFormat，不发现 hostname、执行外部程序或访问终端。EncodingMode 只保存 Auto/Some/Disabled，不能把 Auto 当默认 UTF-8 或把 Disabled 与无显式 encoding 合并。

SortModeSupported 的三种时间模式逐级保留错误来源的 Display 文本；错误前缀分别是 `sorting by last modified isn't supported: `、`sorting by last accessed isn't supported: `、`sorting by creation time isn't supported: `。reverse 不影响能力检查。此函数明确声明 io；没有把现实能力检查改成静态平台表。时间值只用于成功判定，不进入输出。测试专用 GetLimited 的 Passthru 分支调用准确 Panic 进口并携带 P unreachable 文本；它不是生产 getter 的额外正常变体。

## 精确进口与未闭合供给

所有进口当前都是明确未来模块/边界引用；仅列出名字和签名不等于已经链接。普通业务依赖是同工程 Gift 模块，不能改成原 `grep-printer` 或 `grep-searcher` 整 crate 调用。

| alias → moduleId | 本片实际需要的公开符号与合同 |
|---|---|
| machine → ripgrep:foundation:machine | 类型 `Usize/U64/Byte`；常量 `UsizeZero:Usize`。Usize 精确目标位宽、U64 64-bit 与 Byte 8-bit、合法值/codec/相等/复制资格由唯一 machine owner 绑定；本片没有用无界 Int 冒充 |
| path → ripgrep:foundation:path | `OsString/PathBuf`；`ToUtf8(borrow OsString)->Option<Text> !{}`，严格拒绝不可表示内容，不使用 lossy conversion、不执行 IO；输入所有权仍在 caller，Text 结果需真实独立值或检查过的借用寿命 |
| color → ripgrep:printer:color | `UserColorSpec` 的同一 Gift 类型。只用于有序 colors 序列，不需要在 lowargs 解析色彩 |
| hyperlink → ripgrep:printer:hyperlink | `HyperlinkFormat`；`HyperlinkFormatDefault()->HyperlinkFormat !{}`，P 的空格式纯默认 |
| encoding → ripgrep:searcher:encoding | `Encoding` 同一 Gift 类型；其后端可绑定 encoding_rs 的固定 encoding 身份，此处不复制该类型 |
| termcolor → ripgrep:external:termcolor | `ColorChoice` 与 `Never/Auto/Always/AlwaysAnsi` 四个该类型常量；固定外部 termcolor enum 的直接供给，不拥有本片选择算法 |
| bstr → ripgrep:external:bstr | `UnescapeBytes(Text)->Bytes !{}`，准确绑定 P 所用 bstr::ByteVec::unescape_bytes，包括非法 escape 的原语义；不新写宽松替代 decoder |
| tuple → ripgrep:foundation:tuple | `Pair(Usize,Usize)->Tuple<Usize,Usize> !{}`；保持两个位置和值，不复制成 List 或只凭 Type 标签假定构造已实现 |
| os → ripgrep:foundation:os | `CurrentExe()->Result<PathBuf,IoError>`；`Metadata(borrow PathBuf)->Result<Metadata,IoError>`；`Modified/Accessed/Created(borrow Metadata)->Result<Timestamp,IoError>`；前三类调用为相应 IO；`ErrorDisplay(borrow IoError)->Text !{}`。按原 std 原生调用准确绑定，不将这些调用合成一个隐藏全部排序算法的原生 supported 函数 |
| runtime → ripgrep:foundation:runtime | `Panic(Text)->Never !{external}`，保留所选 Rust runtime 的 panic hook、unwind/abort 和失败范围。仅测试 helper 需要此符号，不强制生产函数先装载测试根 |

`LowArgsError` 是本片源层错误载体，目标返回 anyhow::Error 的构造/Display 及真实消费者仍待接合；不能因 message 相同就宣称 anyhow 类型、诊断位置或所有下游错误行为已经等价。P derived Debug/Eq/PartialEq/Clone/Copy 的准确所需集合、opaque 内相等与目标实现资格也留给真实消费者和目标绑定核对，不能从 JSON 记录外形自动取得。本源没有新增这些未经接受的 qualifier。

## 核验与剩余

- 已执行：P 的 74 个字段名与作者类型、Default 的 74 个有序初始化器集合一致，无缺漏、重复或附加字段；JSON 可以严格读取。
- 已执行：受限 JSON Expr 求值检查 479 个断言，含全部 169 个 Mode 更新组合、64 种 None/Some(0/1/7) 上下文组合及三个 setter、separator 的失败短路/成功调用顺序、颜色四路映射、排序四模式及三阶段失败短路、关键默认值。外部依赖由明确固定 stub 提供；该结果只检查本片分支和数据流，**不是 Gift Reader、类型检查器、实际外部库、native OS 或 Target 的证据**。相同字节结果可复用；修改主体后该结果不再新鲜。
- Schema 全图检查由根线程统一执行；当前 Python 没有 jsonschema，未安装新依赖，不能把 JSON 可解析当 Schema PASS。
- 仍开放：上述真实进口物化、整体链接与类型/效果/借用/opaque 检查、根 flags 门面与所有 mutating consumer 接合、Default 与测试根的目标选择、Rust lowering/build/runtime、P 与完整 Gift 程序的跨平台等价以及 P→Q 连续修改。函数的 total 声明仍需语义与供给 owner 的证据，文件存在不签发终止保证。
- 本片没有实现 defs.rs、parse.rs、hiargs.rs、config.rs、help/man/completion 或上层命令装配；这些剩余不能由 LowArgs 完成度代签。没有运行 Cargo、没有联网、没有提交，也没有改本目录之外的文件。

可复用的本次提速依据是先固定 74 个字段与跨模块类型身份，再一次构造全部默认；模式和上下文的有限组合使用同一 frozen 作者字节检查，外部调用用明确 trace 核短路顺序。没有为每个相似 separator 新建独立 native adapter、原 crate fork 或额外状态源。
