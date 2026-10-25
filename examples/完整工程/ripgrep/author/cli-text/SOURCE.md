# CLI 转义与模式输入作者源码

本目录独占写入范围为 `examples/完整工程/ripgrep/author/cli-text/`。固定比较对象是 ripgrep **4c2362d359d9913c7a5e391ccd79cb4da22bc89b**（P）的 `crates/cli/src/escape.rs` 与 `pattern.rs`，实际目录不是 grep-cli。这里提供两份 `gift.author-module/2` 作者模块，所有项目函数都有实际 Expr/ExecBlock 主体；没有将 grep_cli 自有函数登记成 native supplier。本片仍是部分工程源码检查点，SourceProfile、库进口、trait、目标与生产验证未闭合。

- [escape.module.json](escape.module.json)，ModuleId `ripgrep:cli:escape`。
- [pattern.module.json](pattern.module.json)，ModuleId `ripgrep:cli:pattern`。
- [expected.json](expected.json)，55 个独立有限期望；数据中的整数/字节数组是 fixture 值，不是作者 Expr 的字面量 codec。
- 固定输入的 SHA-256：escape.rs（159 行）为 `54dbf0dffcb819631895add3dc76249909584cf27ddf50a200c751881bd3b130`；pattern.rs（181 行）为 `44490e7b70281b48ab0dc702a08896d71eb71e3fa7fdb3563f984d415ed68edb`。

## 逐项源码映射

| P 符号与行 | 实际作者定义 | 已表达的算法与签名 |
| --- | --- | --- |
| escape.rs:26 `escape(&[u8])->String` | Escape | 显式调用 bstr EscapeBytes，再调用其 Display/ToString；输入为 `Borrow<ByteSlice,r>`，输出为拥有内容的 Text |
| escape.rs:33 `escape_os(&OsStr)->String` | EscapeOs | 先 bstr OsStrBytesLossy，借出 Cow 的 byte slice，再调用本模块 Escape；不是先把 Unix 原始 OS bytes 统一 lossily 转成 Text |
| escape.rs:67 `unescape(&str)->Vec<u8>` | Unescape | 输入 `Borrow<Str,r>`，调用 bstr 的准确 unescape；返回任意 bytes，允许非 UTF-8 |
| escape.rs:77 `unescape_os(&OsStr)->Vec<u8>` | UnescapeOs | 先 OsStr::to_string_lossy，再借出 Cow str 并调用本模块 Unescape；与 EscapeOs 的 Unix bytes 路径有意不同 |
| pattern.rs:12 InvalidPatternError；derive Clone/Debug/Eq/PartialEq | InvalidPatternError、InvalidPatternErrorClone/Equal/Debug | opaque record，原始转义 Text 与 Usize 偏移；Clone 真正复制 String 内容，Eq 比较两字段；Debug 按原类型名与字段次序 original、valid_up_to 调用成熟 formatter builder |
| pattern.rs:20 valid_up_to | InvalidPatternErrorValidUpTo | 返回已保存偏移，没有重新扫描或换单位 |
| pattern.rs:25 Error 的默认 source | InvalidPatternErrorSource | 返回 None；返回型保留对 dyn Error + 'static 的借用区域，未把引用本身变成 'static |
| pattern.rs:28 Display::fmt | InvalidPatternErrorDisplay、InvalidPatternErrorDisplayText | 完整原消息；Display 依次写 prefix、偏移、冒号空格、original、suffix，每次格式错误立刻返回；DisplayText 为 format! 消费产生相同拥有文本 |
| pattern.rs:40 From<InvalidPatternError> for io::Error | InvalidPatternErrorIntoIoError | 移交实际错误对象给 ErrorKind::Other，保留 boxed payload 类型；没有先强制变成消息 String |
| pattern.rs:51 pattern_from_os | PatternFromOs | 严格 OsStr::to_str；失败时在 lossy str 查找第一个 U+FFFD，None 保留原 expect panic，错误 original 使用 EscapeOs |
| pattern.rs:67 pattern_from_bytes | PatternFromBytes | std::str::from_utf8；失败用该 Utf8Error::valid_up_to，original 使用 Escape；成功返回同输入区域的 str 借用 |
| pattern.rs:82 patterns_from_path<P:AsRef<Path>> | PatternsFromPath | 原泛型约束；一次 AsRef，File::open，随后调用 PatternsFromReader；开文件与读取失败的不同前缀及 Other 转换均在 Gift 主体 |
| pattern.rs:104 patterns_from_stdin | PatternsFromStdin | 获取 stdin、持锁读到 PatternsFromReader 返回后释放；失败拼接准确 <stdin>: 前缀 |
| pattern.rs:141 patterns_from_reader<R:Read> | PatternsFromReader、私有 ReversePatternsInto | 原泛型 Read 输入；BufReader::new；同步 exclusive lambda 保持行号与已收集模式；成功即复制借用 str，坏模式立即 Err；底层读取 Err 原样传播 |

所有九个 free product functions、显式错误 getter/Display/From，以及派生值行为均有实际主体。上述名义定义/普通函数没有自行签发 Rust impl 的资格；公开 API façade 与原 trait impl 仍须由统一 trait/Target owner 采用这些主体。原测试模块不是产品函数：本片的有限独立期望覆盖代表性原向量和额外反例，未声称逐个原测试已在 Gift/Rust runtime 执行。

## 必须保持的真实行为

**OS 错误偏移不能“修正”。** P 对 invalid OsStr 使用 `to_string_lossy().find(U+FFFD)`。Unix 输入合法 U+FFFD 的 UTF-8 bytes 后接 FF 时，PatternFromBytes 的首错偏移为 3，PatternFromOs 保存偏移 **0**。Windows 的合法 U+FFFD 后接孤立 surrogate 也有同类结果。这里保持 P 的程序分支，不用注释中“invalid byte offset”的直觉替换算法。该偏移是所查 str 的 UTF-8 byte offset，不是字符数或 UTF-16 unit 下标。

**bytes 与 OS lossy 入口不同。** bstr 在 Unix 的 from_os_str_lossy 直接保留 OsStr 原始 bytes；非 Unix 先沿 OsStr 的 lossy str。故 EscapeOs 对 Unix FF 输出反斜线 xFF，对 Windows 孤立 surrogate 输出 U+FFFD。UnescapeOs 在所有目标先调用 OsStr::to_string_lossy。UTF-8/OS 转换不在本目录用通用 Text 偷换原生表示。

**原临时值的作用域不能被扩大。** PatternFromOs 在独立内层 let 求出 offset，lossy Cow 随该词法作用域结束释放，随后才调用 EscapeOs。PatternsFromReader 的 BufReader 位于立即消费 lambda 的内层 ExecBlock；返回 readResult 时先释放该临时 BufReader 与任意 R，再进行外层 match 和最终序列翻转。前者保持转义前的临时内存释放，后者保持原 for_byte_line 语句结束的 Drop 次序。Schema 的 let.value 是 Expr，因此此处没有把 ExecBlock 冒充表达式；lambda 的真实捕获、生命周期与消费资格仍需生产检查。

**行号是原 Rust 默认推断的 i32。** P 的 `let mut line_number = 0; line_number += 1;` 只进入 Display，没有 usize 约束，因此 fallback 类型是 i32。它和 InvalidPatternError.valid_up_to 的 usize 不同。这里调用 I32Zero/I32One/I32Add/I32Decimal；越界时必须消费原编译 profile 的 overflow-checks 行为，不能改成无限 Int、usize、饱和或一律 checked。55 个期望均位于无溢出的正常域；没有执行机器极限/overflow 证明。

**首次错误和输出格式保持。** 行号在验证当前行前递增，坏模式包装为 Other 消息 `line: error` 并停止；底层 reader Error 不加行号、不改 kind。path open 失败用 `path: error`，读取失败用 `path:error`；stdin 用 `<stdin>:error`。通过 path/stdin 的包装变为 Other；直接读取的原始错误仍原样返回。错误对象到 io::Error 的直接 From 转换与把显示文本装进 Other 的区别保留。

**流与借用没有提前物化整个文件。** ForByteLine 仍是原 bstr 同步 FnMut 遍历；每条 borrowed line 只在该次回调内进入 PatternFromBytes，成功后复制成拥有 Text。回调不得被保留、并发执行或在返回后访问 buffer。逐行模式暂以反向有限序列累积，结束后翻转；它表达同一顺序与重复，不证明原 Vec push 的容量、分配次数或复杂度。目标应恢复合格的同一 Vec 顺序追加，不能把复制型 sequence 或递归宿主栈的额外失败当成原行为。

## 精确普通进口与成熟能力边界

这些是实际源码引用所要求的签名，不是已经安装、链接或验证过的供给。T 为拥有内容的 scalar:text，Bytes 为 scalar:bytes；BS/Str 分别为共享 machine:ByteSlice / machine:Str，r 为真实借用区域。Borrow<T,r>/BorrowMut<T,r> 参数次序与 matcher 源一致。scalar:text 不能代替原生 str 的借用/view 身份；Text/Bytes 对原 String/Vec<u8> 的拥有值映射也不签发相同分配成本。

| ModuleId / 名字 | 准确需求 |
| --- | --- |
| ripgrep:foundation:machine — Borrow、BorrowMut、ByteSlice、Str | 与 matcher 共用的真实共享/独占借用和原生 unsized view；不可复制或延长独占资格，不因 Param.mode 再造引用身份 |
| machine — Usize、UsizeEqual、UsizeDecimal | 原目标 usize；Equal(Usize,Usize)->Bool；Decimal(Usize)->T 使用原十进制 Display，不能取本机默认宽度 |
| machine — I32、I32Zero/I32One、I32Add、I32Decimal | i32 与值常量；Add(I32,I32)->I32 的越界行为由所选原 Cargo/Rust profile 绑定；Decimal(I32)->T 必须支持回绕后的负数显示 |
| machine — Formatter<data>、FormatResult、IOError | 与 matcher 同一 std::fmt::Formatter<'data>、fmt::Result、std::io::Error 身份；formatter 外层独占区域 f 与内部 data 不合并 |
| ripgrep:foundation:path — OsStr、Path | 原 std::ffi::OsStr 与 std::path::Path 的 native view；不是 OsString/PathBuf 拥有值，也不能经非 UTF-8 丢失转换创建 |
| path — OsStrToStr | <r>(borrow Borrow<OsStr,r>)->Option<Borrow<Str,r>>；保持原严格接受域与源区域 |
| path — OsStrToStringLossy | <r>(borrow Borrow<OsStr,r>)->text:CowStr<r>；按所选平台原 std 实现，保持 borrowed/owned Cow 状态及 Unicode replacement 行为 |
| path — AsRefPathConstraint、AsRefPath、Display | P 的原 AsRef<Path> 实现资格；AsRefPath(borrow P) 借出依附实际 P 的 Path，调用点推导真实局部区域；Display(borrow Borrow<Path,r>)->T 使用原 Path::display |
| ripgrep:foundation:text — CowStrAsStr、StrToText、Clone | 前者从仍活着的 CowStr<owner> 借出 Str，返回区域不得超出 Cow 借用或其借入数据；StrToText(Borrow<Str,r>)->T 为 to_string；Clone(borrow T)->T 为原 String::clone |
| text — FromUtf8、Utf8ErrorValidUpTo | <r>(Borrow<BS,r>)->Result<Borrow<Str,r>,Utf8Error>；严格 std::str::from_utf8；ValidUpTo(Utf8Error)->Usize，不做 lossy 解码 |
| text — StrFind | <r>(Borrow<Str,r>,T)->Option<Usize>；本片 needle 恰为一个 U+FFFD，保持 std str::find 的首个 UTF-8 byte offset |
| ripgrep:external:bstr — EscapeBytes、EscapeBytesToText | <r>(Borrow<BS,r>)->EscapeBytes<r>；随后 borrow EscapeBytes<r>->T，保持该成熟 iterator 的 Display/ToString |
| bstr — OsStrBytesLossy、CowBytesAsSlice | <r>(Borrow<OsStr,r>)->CowBytes<r>；随后仅在 Cow 仍活着时借出 BS。Unix 保存原 bytes，非 Unix 使用原 lossy str；拥有分支不能返回悬空 slice |
| bstr — UnescapeStr | <r>(Borrow<Str,r>)->Bytes，对应 Vec::unescape_bytes；与现有 lowargs 需要的 owned-Text UnescapeBytes 是同一外部规则的不同准确入口，不是两个项目算法 |
| bstr — ForByteLine | <B:BufRead>(inout B, exclusive for<line> FnMut(Borrow<BS,line>)->Result<Bool,IOError>)->Result<Unit,IOError>；回调参数 noescape、回调本身不保留；短路/读取顺序/错误原样传播都沿实际 bstr |
| ripgrep:foundation:io — Read、BufReader<R>、BufReaderNew | 原 std::io::Read 约束；BufReaderNew(move R)->BufReader<R>，对应默认 BufReader::new；Drop/借用与底层 R 一起正确结算 |
| io — FileOpen、Stdin、StdinLock | FileOpen(Borrow<Path,r>)->Result<File,IOError>；Stdin()->Stdin；StdinLock(borrow Stdin)->StdinLock<borrow region>。文件所有权移入 reader；stdin handle 必须活到 lock/reader 返回 |
| io — OtherError、OtherMessage、ErrorDisplay、StaticError | OtherError<T:Error+Send+Sync+'static>(move T)->IOError 保留 boxed T；OtherMessage(T)->IOError 保存 format! 的消息；ErrorDisplay(borrow IOError)->T；StaticError 是 dyn Error+'static 对象类型，借用仍带独立 r |
| ripgrep:foundation:format — WriteText、WriteUsize | <data,f>(inout BorrowMut<Formatter<data>,f>,T/Usize)->FormatResult；WriteText 是 Formatter::write_str 的原样写入；WriteUsize 是相当于 write!(formatter,"{}",value) 的默认十进制子参数格式，不能直接把外层 formatter 交给 Usize::fmt 而继承 width/precision/align/sign/alternate；按次序同步写，错误立刻停止，只 reborrow formatter，不泄漏独占借用 |
| format — DebugStruct、DebugFieldText、DebugFieldUsize、DebugFinish | 原 Formatter::debug_struct / DebugStruct::field / finish 的最窄调用；builder 保存两个 formatter 区域，fields 按 original、valid_up_to 次序进入原 Debug；保持 pretty/alternate 和原错误累积，不自写引号/转义格式 |
| ripgrep:foundation:runtime — Panic | (T)->Never !{external}；保留原 expect 文本与所选 panic hook/unwind/abort 行为 |
| ripgrep:cli:escape — Escape/EscapeOs | 本目录真实作者模块，不是外部或 native 函数；pattern 直接导入并调用 |

bstr 是可保留的成熟外部库：P 跟踪 Cargo.lock 中为 **1.13.0**（checksum `1f7dc094d718f2e1c1559ad110e27eeaae14a5465d3d56dd6dbd793079fbd530`）。已只读核对任务 cargo-home 中对应缓存源的 ext_slice.rs、ext_vec.rs、io.rs；没有安装或联网。它支持 NUL、反斜线、tab/CR/LF、hex 与不识别转义原样保留；有效非 ASCII Unicode 不做额外 escaping。项目四个 escape 函数本来只组合这些库方法，保留其窄外部方法不是保留整个 ripgrep 自有算法。

memchr 位于 bstr 的逐行扫描实现，P lock 为 2.8.3；本片不另造 memchr 项目函数或将它冒称 parser。此处 **没有 regex 编译或匹配调用**：pattern 只验证 UTF-8 并返回原 str（反斜线、括号、无效 regex 语法均可通过）。bstr 的 regex-automata 依赖属于其成熟库闭包，不能据此声称本片完成 ripgrep matcher、regex 语法或执行。

## 效果、资源与未闭合接合

纯字节/文本/错误值主体没有读取外部世界。PatternFromOs 的不可达 expect 保护声明 external panic 效果。formatter 写入与 reader 回调的 mutable 局部状态分别保留明确 state-write/state-read。持有 Cow、BufReader、File、StdinLock 的作用域与借用限定必须由真实 consumer 检查，有限值解释不会检查 Drop 或非局部退出清理。

**泛型效果仍 OPEN。** 任意 R:Read 与 P:AsRef<Path> 可有它们实际的方法效果，不能因为名称像 IO/转换就把所有实现压成 io 或纯。PatternsFromReader 与 PatternsFromPath 因此省略 effects，让当前协议的准确主体/callee 推导处理；缺真实 trait 与实现效果绑定时必须返回 NeedsEffectBound。这里没有引入一个未关联到 R/P 的伪 ReaderFx 参数。PatternsFromStdin 固定到原 std 具体实现，但它的最终调用闭包也仍依赖同一合格供给。省略效果字段不签发纯度或运行权。

仍需由工程唯一 owner 关闭：

1. 两个 ModuleId 的 SourceProfile、内容身份、导出与真实消费者接合。
2. 上表每个 imported type/function/constraint 的实际公开供给、共享身份、借用区域、Cow 生存期、callback noescape/exclusive 与 trait/ABI 采用。
3. InvalidPatternError 的原 trait 集合（Clone/Debug/Eq/PartialEq/Error/Display 与 From）和私有字段资格。普通函数存在不等于已生成 Rust impl；Error 的其余标准默认行为沿所选标准库，不在此重定义。
4. 泛型 Read/AsRef 的精确效果与调用资格；具体 File/StdinLock 的关闭与失败清理；machine i32/usize、overflow profile 与实际目标。
5. text/bytes 拥有值到原 String/Vec 的表示与成本，反向序列到原 Vec push 的合格降低；没有承诺无额外分配或同等栈深。
6. 真正的 Gift Reader/Linker、类型/效果/所有权检查、Target、Rust/native bstr 与 fmt/IO 执行，以及 CLI 真实终端行为。没有这些资格不能宣布两个原文件已端到端等价或 grep-cli 已完成。

## 已执行与未执行的验证

已执行 strict JSON（拒绝重复键）、本地 symbol/type 引用、exports 检查；55 个独立期望直接解释真实作者文件的 Expr、ExecBlock、lambda 和局部 var/set，全部 PASS，18 个函数均被有限用例执行。另核对了 source 中的准确符号、边界分支和私有状态。

独立审查随后发现并修复“将原临时值提升成更长局部绑定”的两处同根差额，即 lossy Cow 与 BufReader。修后重跑全部受影响的 16 个 OS/reader/path/stdin 期望，均 PASS；其余 39 个不经过变化主体的期望复用原证据。另检查了两个词法作用域的实际 AST 结构；此项不冒充生产 Drop/borrow 证明。

解释过程仅为本次任务经 stdin 执行的短时核验，不保存为永久 compiler、不进入作者源。bstr、UTF-8、OS、IO、formatter 和机器操作由明确测试替身供给；它们不能证明真实依赖的实现。fixture 的 reader.events 已是 bstr 交给回调的 line slices，expectedLinesVisited 只证明作者回调停止；nativeBoundaryExamples 单独保留 CRLF、末尾 LF、lone CR 与空输入的真实库预期，未冒充 native 执行。fixture io-error 的 source 字段仅标记保存的 payload 来源；它不是 Rust Error::source() 的返回值，后者的 InvalidPatternError 默认 None 另有独立期望。

未执行完整 Schema（由根线程对最终冻结 wave 统一检查）、生产类型/borrow/effect/trait 证明、真实 IO/formatter/bstr、Cargo、目标代码生成或端到端等价测试。未联网、安装、提交或修改本目录之外的文件。有限 PASS 不推出所有输入等价、异常/分配成本、物理栈安全或整个 crate 完成。
