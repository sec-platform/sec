# ripgrep CLI 控制层作者源码

本目录把 P=`4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/core/main.rs` 中命令入口和信息出口写为实际 `gift.author-module/design-converged` 定义。这里有 3 个模块、20 个函数体；分支、调用次序、错误传播和输出拼接在 JSON 中，本文不代替函数体。

**范围是 CLI 控制层。整个 ripgrep 转换仍未闭合。** 导入的业务模块必须成为同一 Gift 工程的作者源码；没有把它们登记为“保留原生 ripgrep”、native callback supply 或已安装的标准库。未实现/未接合的导入不能被形状检查 PASS 消除。当前没有生产 Reader/linker/Target 或整个程序的等价运行结果。

## 函数与原源码

| 模块 | 本地定义 | P 中函数起点 |
| --- | --- | --- |
| `ripgrep:core:command` | `Main`, `MainError`, `ScanBrokenPipe` | `main.rs:43` `main` |
| 同上 | `Run`, `RunArgs`, `RunSearch`, `RunFiles`, `FinishMatch`, `ExitForMatched`, `ExitWithoutSuccess` | `main.rs:77` `run` |
| `ripgrep:core:command:types` | `Types`, `WriteTypeDefinitions`, `WriteType`, `WriteGlobs`, `WriteTextChecked`, `WriteBytesChecked` | `main.rs:329` `types` |
| `ripgrep:core:command:information` | `Generate`, `Special`, `WriteOutputAndCode` | `main.rs:355` `generate`; `main.rs:383` `special` |
| 同上 | `EprintNothingSearched` | `main.rs:414` `eprint_nothing_searched` |

`main.rs:107` 起的 search、search_parallel、files、files_parallel，以及 `main.rs:434` 的 print_stats 不在本目录实现；它们属于完整工程仍须接合的会话/输出源码。`main.rs:38–40` 的 musl 且 64 位使用 jemalloc、其他目标使用系统分配器的构建选择也必须由工程目标保留。本目录没有通过删除这些部分宣称缩减完成。

## 入口、时序与退出

`Main` 先调用一次 `flags:Parse`，再调用 `Run`。`Run` 消费唯一 ParseResult：Err 原样移出；Special 立即进入信息出口；Ok 的 HiArgs 在本分支拥有，内部函数仅借用，最终在本分支退出时释放。Special 路由不构造 HiArgs，也不读取 cwd、线程数或 search 资源；parse 对 special 的提前识别责任仍在 flags 源码。

Search 先读取 matches_possible。false 直接形成 `Ok(false)`，不读取 threads，不建立会话。true 才读取 threads，一线程选择 Search，其余选择 SearchParallel。Files 直接按 threads 是否为一选择 Files/FilesParallel。会话 Err 不执行成功后的状态结算。Types/Generate 直接返回自己的结果，不经过 matched 或 errored 状态。

下表中的 E1、E2 是两次真实调用 `messages:Errored()`；它们不是缓存值。Quiet 仅在 matched=true 时读取。P 没有赋予把两次 Relaxed load 合为一次的许可，即使实际程序通常只把 errored 从 false 设为 true。

| matched | quiet | E1 | E2 | 状态/观察 |
| --- | --- | --- | --- | --- |
| true | true | 不读 | 不读 | 0 |
| true | false | false | 不读 | 0 |
| true | false | true | true | 2；两次 load |
| true | false | true | false | 1；保留第二次观察结果 |
| false | 不读 | 不读 | true | 2；一次 load |
| false | 不读 | 不读 | false | 1；一次 load |

`MainError` 借用唯一 Error，按 error chain 原顺序逐项检查是否可下转为 I/O Error 且 kind=BrokenPipe；任一命中立即返回 0，停止后续 cause 观察，不打印错误。完整无命中才调用 `EprintlnErrorLocked` 并返回 2。不得先物化全部 chain、只查顶层错误或只按字符串判断。自定义 cause/source 链本来可能不终止；本层不发明长度上限。

`EprintlnErrorLocked` 的消费合同来自 `messages.rs:33–67`：stdout lock 在 stderr lock 之前取得，先写 `rg: `，再按原 `{:#}` 格式写 Error 和换行。任一写入失败都调用 process exit：BrokenPipe 为 0，其余为 2；这是异常终止路径，不是返回给 Main 的普通 Result。正常退出释放所持锁。Error chain 遍历结束后才开始该格式化及锁操作。

## 类型列表与信息输出

Types 先按 HiArgs 的 buffer/color 配置取得 stdout，然后按 definitions 的既有顺序逐项处理。每项先执行 I32 count 加一，再写 name、`: `；globs 按既有顺序写出，除第一个以外先写 `, `；最后写 `\n`。空 globs 仍产生 `name: \n`。每次写的 Result 都显式 match，首个错误立即返回，不继续写分隔符、后续 glob 或下一项。

计数保留 P 未加类型标注的 Rust 整数默认 I32，不能在没有额外输入界证明时改成 Bool“是否见过”。`I32Add` 必须消费与 P 相同的 overflow-check 构建选择：checked overflow 的失败发生在该项 name 写入前；wrapping 模式仍按最终 count 是否为零返回 1/0。这里没有采用数学无界整数来悄悄消除 overflow。

Generate 五个分支分别调用一次 man/Bash/Zsh/Fish/PowerShell 内容生成函数。Special 的 HelpShort、HelpLong、VersionShort、VersionLong 取对应内容并选状态 0；VersionPCRE2 只生成一次版本结果，available 为 false 时选 1。所有信息出口先按 Rust `str::trim_end` 对应的 Unicode White_Space 集合去尾，再输出一个换行；不能改成 ASCII trim 或原字符串透传。stdout 写入失败优先返回 I/O 错误，选好的 0/1 不覆盖写错误。

`EprintNothingSearched` 只传入 P 的完整固定文本；是否调用它归会话源码。`messages:ErrorMessage` 须先设置 ERRORED，再判断 messages 开关，不能把“未显示”解释为“没有发生错误”。

## 导入接合表

下列签名是本目录真实调用要求。`&T` 在本表表示 Param.mode=borrow，`&mut T` 表示 inout，均为同步 noescape；不是新增 Gift 文法。R 的 Result/Option 与 Text/Bool/Unit 使用现行共同类型。标记 OPEN 表示必须由真实工程定义及其消费者取得依据，不是可永久保留的占位供应器。

| 导入模块 | 本目录所需导出与签名 | 接合责任/状态 |
| --- | --- | --- |
| `ripgrep:foundation:machine` | Byte、Usize、I32；普通常量 ByteZero/ByteOne/ByteTwo、UsizeOne、I32Zero/I32One；UsizeEqual(Usize,Usize)→Bool；I32Equal(I32,I32)→Bool；I32Add(I32,I32)→I32 | 统一 machine 定义与 Target overflow/数值表示接合；不能注册成 `std:*`。由工程 owner 集成 |
| `ripgrep:core:flags` | HiArgs、ParseResultHiArgs、Mode、SearchMode、SpecialMode、GenerateMode；Parse()→ParseResultHiArgs；HiArgsMode(&HiArgs)→Mode；MatchesPossible(&HiArgs)→Bool；Threads(&HiArgs)→Usize；Quiet(&HiArgs)→Bool | facade 必须真实转导 `ripgrep:core:flags:lowargs` 的枚举；Parse/HiArgs 及相关 getter 仍 OPEN。ParseResultHiArgs=Err(Error) / Special(SpecialMode) / Ok(HiArgs) |
| 同上 | StdoutConfiguration(&HiArgs)→StdoutConfiguration；TypeListingEntries(&HiArgs)→ordered Sequence<{name:Text,globs:ordered Sequence<Text>}> | StdoutConfiguration 类型由 output 唯一定义；保持 `hiargs.rs:831` 的 Auto/Line/Block、终端检测和 color 规则。listing 是只读逻辑序列，须接合原 Types 的稳定定义与顺序；不能强制先 clone/分配/遍历整个列表改变首个写入前的失败边界。真实表示和共享资格 OPEN |
| `ripgrep:core:sessions` | Search(&HiArgs,SearchMode)→Result<Bool,Error>；SearchParallel 同型；Files(&HiArgs)→Result<Bool,Error>；FilesParallel 同型 | 必须是真实 Gift 会话源码，具有原遍历/matcher/searcher/printer/resource/并行结算语义；OPEN，不是一个 NativeSearch 包装 |
| `ripgrep:core:errors` | Error、IoError、ChainCursor<Region>、CauseBorrow<Region>；FromIoError(move IoError)→Error；NextCause(&mut ChainCursor<r>)→Option<CauseBorrow<r>>；CauseIsIoBrokenPipe(&CauseBorrow<r>)→Bool | Error 保存原 error/source 类型身份与 chain 次序；Cause 借用根 Error，不借用会被下一次更新覆写的 cursor 临时槽。下转及 kind 判定不得按文本代替；OPEN |
| 同上 | WithChain<A>(&Error, forall r. (&mut ChainCursor<r>)→A)→A | 同步一次调用，callback 及其捕获 noescape，r 不得出现在 A 或留在外部；按需取得 next cause。此小范围借用 API 自身也须有 Gift 实现和真实 Region/Method 依据；OPEN |
| `ripgrep:core:messages` | Errored()→Bool；EprintlnErrorLocked(&Error)→Unit；ErrorMessage(&Text)→Unit | Errored 为原 Relaxed load；两种消息函数拥有上述标记、锁次序、格式化与异常 process exit 规则。不是普通“打印供应”声明；完整 Gift 源及底层进程/锁接合 OPEN |
| `ripgrep:core:information` | GenerateManPage、GenerateCompleteBash/Zsh/Fish/PowerShell、GenerateHelpShort/Long、GenerateVersionShort/Long：()→Text；GenerateVersionPcre2()→Pcre2Version；Pcre2Available(&Pcre2Version)→Bool；Pcre2Text(&Pcre2Version)→Text | 对应 flags 中的生成算法、feature/version 信息及静态内容必须由实际 Gift 作者源提供。Pcre2 getter 都借用同一个结果，不消费后再复用。OPEN |
| `ripgrep:foundation:text` | TrimEndUnicodeWhitespace(&Text)→Text | 须实现与 P Rust Unicode White_Space 版本相同的尾部判定及共享文本语义；不能当作未知宿主函数即告完成。OPEN |
| `ripgrep:core:output` | StdoutConfiguration、WriterBorrow<Region>；WithConfiguredStdout<A>(StdoutConfiguration, forall r. (&mut WriterBorrow<r>)→A)→A | 先取得原配置 stdout，再同步一次执行 callback，callback/capture noescape，A 不含 r。取得、写、Drop/close 的真实语义及失败边界由该模块承担；OPEN |
| 同上 | WriteText(&mut WriterBorrow<r>,&Text)→Result<Unit,IoError>；WriteBytes(&mut WriterBorrow<r>,&Bytes[utf8])→Result<Unit,IoError>；WriteRawStdoutLine(&Text)→Result<Unit,IoError> | Text 按原 UTF-8，write_all 保留 short write/Interrupted/错误处理；raw line 在原 std stdout 上输出内容和一个换行。buffering、颜色、format/write_all 算法须在 Gift 源码，不委托整个原生 ripgrep 输出函数。OPEN |

`WithConfiguredStdout`/`WithChain` 只有受限寿命控制的回调；没有把 Args、Error、命令分派、每个分支和全部 Effect 打包为调用者提供的大回调表。当前这些 API 仍是**待实现的工程依赖**，不能因为本文规定了契约就宣称链接闭合。

## 借用、字段和错误资源

JSON 不从 HiArgs、Error、writer 或未知泛型 record 取 field 再复用被移动的对象。HiArgs/错误使用真实带 borrow mode 的 getter；写流是 Region 索引的 inout 参数；错误 Result payload 只移出一次。`Expr.field` 只用于明确的不可变 Text/Sequence 记录和 `SeqUncons` 的具体 head/tail，且其共享读取资格仍须由返回类型及选定 Method 证明。这消费现行 [record 读取合同](../../../../../docs/领域/计算基础/通用计算与任务语义.md#record-presence-place-row)，不是把“readonly”当 Copy 或把任何宿主对象当普通 record。

声明和 lambda 给出相应 noescape；其实际意义沿 [共同调用边界](../../../../../docs/作者/组合/结构编辑与身份保持.md#shared-callable-boundary)。noescape 不等于只执行一次，因此上表另外明确 scoped provider 的次数及同步责任。writer/cursor 的 r 由 provider 的每次调用引入，不能返回、捕获后保留、装箱藏匿或交给无 noescape 依据的调用。

types 的 callback 返回原 Result，输出资源在正常、业务错误、Fault/取消时按原选定运行规则结算。不得直接替换成会把清理错误改装为 ScopeFailure 的通用 resource.scoped 而更改公开错误型；P buffered stream Drop 不等于额外一次可见的成功 flush，也不把 Drop 错误提升成先前不存在的 Result。process::exit 路径不运行普通 Rust 栈析构，Gift process exit 接合也不得改成正常 return。特殊故障/取消运行规则和 allocator 选择由整个目标闭合。

各导入调用的 Effect 字段省略是请求推导，不是空 Effect 声明。未接合主体会留下具体 NeedsEffectBound/类型/Method 义务；不能用 `effects:[]`、伪 profileRef 或 `std:NativeSearch` 消掉它们。

## 原生底层边界、后续编辑与验证边界

真正不能由纯作者算法替代的是实际进程退出、OS 标准句柄与写入、终端事实、同步/原子原语以及选择目标的分配/运行时能力；它们取得外部事实或影响真实 OS/并发状态。对应窄 ABI/运行时 Method 仍要在工程目标中准确绑定。命令分支、format/trim、生成文档、buffer 选择、错误链遍历、错误标记规则不属于这个豁免。

ScanBrokenPipe、WriteTypeDefinitions、WriteGlobs 使用尾部递归表达原循环；最终 Target 必须把这些尾调用保持为有限调用栈的循环，不得把任意长度输入变成新增 stack overflow 失败。当前没有声称这一 Target obligation 已运行验证。后续若直接采用 ExecBlock 循环，须保持相同逐次观察、count 加法位置和首错出口。

第二次修改以三个 JSON 为作者真源：改 exit 规则时同步本页观察表，改字段表示时重新核 shared read/borrow，改 import/export 时在对应真实模块和工程清单完成单一导出身份，改 output scope 时重核 acquire/body/drop 和异常 process exit。不能在 Rust 影子文件补行为来绕过未闭合的 Gift 依赖。若接口集成失败，保留精确未解类型/Effect/region，不将供给伪装成已完成 native implementation。

本次已做 strict JSON（拒绝重复键）、现行纯 Expansion 全分支恒等检查、完整 candidate Schema 校验及本地引用/导出存在性检查：3 个模块、20 个函数均通过。仅使用既有 `std:SeqUncons`，machine 常量均是项目 symbol。该结果不包含 linker、类型/ownership/Effect/Method 资格、整个工程消费、Rust 生成、CLI 行为或跨 P/Q 等价验证。没有运行 Cargo、联网或提交。后续必须使用独立从 P 提取的预期和真实整体消费者；不得把被测模块的输出再当自己的 oracle。
