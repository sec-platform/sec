# ripgrep 完整混合作者工程的逐项等价审查

本例交付完整混合作者源码设计、准确来源、明确的实现供给和逐项保持审查。它不实施生产 Gift Reader、类型检查器、Rust 降低或生成链，不把设计样本装配称为 Gift 编译。完整范围是上游整个 Cargo 工作区及其配置、构建、资产、测试、发布、fuzz 与 benchmark 成员，不是一个调用外部 rg 的薄壳，也不是以路径函数代表整个工程。

## 1. 固定对象与允许变化

| 对象 | 精确身份 | 审查用途 |
|---|---|---|
| 上游 P | commit `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`；tree `e41450e1cd2b5b7a3fef684b5c38cf5d504fc030` | 修改前的完整原生基准 |
| 上游 Q | commit `7155f6408d370e699795dc75e954635abfaf08a6`；tree `4325a55a66d44bfa3bb25303bfcc30336cfd491d` | 修复最终分量判定后的独立上游基准 |
| 混合作者 P | P 的完整原生成员，加 P 的 Gift 模型、所选字节切片方法和局部接合 | 对照 Native(P) 审查保持 |
| 混合作者 Q | Q 的完整原生成员，加 Q 的 Gift 模型、所选字节切片方法和局部接合 | 对照 Native(Q) 审查保持 |

四对象关系是 `Native(P) ≈ Mixed(P)`、`Native(Q) ≈ Mixed(Q)`；P→Q是有意的业务修复，不要求 Native(P) 与 Native(Q) 相等。这里的 Mixed 是已选源码及供给组成的设计实例，不表示 Gift 编译器已经执行。

上游两个版本各有224个跟踪成员；这个数包含源码和其他工程成员，不称为224个Rust文件，也不作为语义完成率。完整输入仍以准确跟踪成员清单、原字节及原生解析上下文为依据。实例的 `native/` 保留选定版本的完整独立Git checkout，`design/path-policy.module.json` 是唯一当前策略版本，根部为 `gift.project.json`。P、Q模型与方法并列保存在本例包中供比较；一个实例只选其中一组，不在运行时按版本字符串选择业务算法。

唯一迁出的作者区域是 `crates/ignore/src/pathutil.rs` 中 Unix `file_name` 的 `imp` 算法。其余原生作者区保留原职责，尤其 `crates/core/main.rs`、`flags/parse.rs`、`flags/defs.rs` 不再镜像为另一套可独立修改的JSON函数。旗标名称、别名、默认、更新与文档次序属于ripgrep产品决定，仍由这些Rust作者源真实拥有，不能因为实现成熟便改称供应方黑盒。

实例内的局部接合准确为：

1. `crates/ignore/src/lib.rs` 增加 `#[cfg(unix)] mod gift_path_policy;`；模块保持private。
2. `crates/ignore/src/gift_path_policy.rs` 提供所选普通Rust方法，接口为 `pub(super) fn file_name(path: &[u8]) -> Option<&[u8]>`。
3. 原Unix wrapper保留 `Path/OsStr` 边界，取得原字节后调用 `crate::gift_path_policy::file_name(path).map(OsStr::from_bytes)`。原算法正文从wrapper删除，不保留第二位业务Writer。

`pub(super)` 是新增的crate内部可见函数，必须在差额中明示；它不是外部公开API，也不能被额外重导出。除上述两个原文件接合和一个新增方法文件外，上游成员应逐项保持对应版本字节。完整方法正文、模型与接合patch均需共同进入最终候选检查，不能只比较wrapper函数名。

`materialize.ps1`装配准确上游源、当前模型、既选方法与接合patch；它不读取Gift AST生成Rust。方法相对模型的适用性由下述结构证明和准确内容绑定承担。任意后续模型修改会使原保持结论失效，不能仅重跑装配脚本就继续声称方法符合新模型。

## 2. 等价的观察边界与前提

本例审查公开库调用、CLI参数与配置解释、搜索/列举/输出内容、错误与退出、外部作用、资源所有权及明确的平台行为。对应比较必须使用相同输入文件系统、argv、stdin、环境、依赖与工具、Cargo配置、feature/cfg、目标、构建profile和外部程序。对并发与外部开放环境比较允许的行为与因果关系，不要求两次运行恰好采用同一线程调度或同一墙钟时间。

相同原生字节和相同编译/运行上下文，能够支持未改区域沿用原语义的保持推理；不代表已经穷尽原软件的全部缺陷，也不证明一次测试覆盖了全部输入。局部方法的替换必须另证其返回值、借用与效果，并检查所有消费者；不能以其他文件字节相同掩盖可达行为变化。

本次不承诺二进制字节、代码地址、私有符号、调试源位置、调用栈外观或精确耗时完全一致。增加私有方法可能改变这些实现观察。零分配与借用保持见第5节，具体性能、优化和内联仍须独立证据；如果某消费者确实把这些实现细节作为硬合同，则其相交资格在取得证据前保持未验证，不能通过删掉该观察强行通过。

## 3. 全工程逐项审查

下表中的“保留”指最终候选需要满足的准确字节与上下文关系。“设计审查成立”与“已运行通过”分别记录，未给运行证据的项目不得视为实测PASS。

| 范围及实际所有者 | 必须保持的内容与相交差额 | 审查结论及实际证据边界 |
|---|---|---|
| CLI完整旗标面：`crates/core/flags/defs.rs`、`lowargs.rs`、`parse.rs` | 长/短名、否定、别名、重复参数、参数边界、默认、错误文本与状态更新；`FLAGS`顺序决定帮助/man分组次序 | 保留真实原生作者源；不手填第二份旗标表或泛型回调镜像。全部旗标组合未穷举 |
| 配置与启动：`flags/config.rs`、`flags/parse.rs`、logger/messages | Logger初始化失败短路；先解析CLI并设置日志，再处理help/version；special与no-config不读配置；配置参数前置、CLI后置；有配置时以新的LowArgs重解析并重设日志 | 原源保持。配置路径是OsString；逐行字节处理、空行/注释和错误行为不能改成shell分词。原测试助手默认清除配置环境，不能据此代签真实配置会话 |
| 命令模式与信息出口：`crates/core/main.rs` | Search/Files/Types/Generate、help与各种version出口、matches_possible短路、线程数选择；不是只有默认文本搜索 | 原源保持；各模式及所有平台组合未逐一运行 |
| 参数提升：`flags/hiargs.rs`及其依赖 | 路径、模式、类型、引擎、编码、颜色、超链接、排序、统计等真实配置构造及失败顺序 | 原源保持，不能以低层解析通过代签高层构造成功；宿主/TTY/环境输入继续属于真实上下文 |
| 搜索工作者：`crates/core/search.rs`、`haystack.rs` | 显式路径/递归路径/stdin差异、文件/reader路线、二进制检测、统计、搜索器与打印器组合 | 原源保持；路径筛选可因P→Q修复改变输入集合，后续输出/统计/退出的相应变化属于允许差额 |
| 外部前处理与解压：`search.rs`、`crates/cli` | 真实程序解析与启动、argv边界、stdin/stdout/stderr、退出和清理；前处理器与压缩读取的原选择关系 | 原源保持仍需相同外部程序与PATH。普通源相同不能补出缺失或不兼容的xz等工具；本轮已观察到这一边界，见第7节 |
| 文件发现、ignore与类型选择：`crates/ignore` | ignore优先级、override/whitelist、文件类型、hidden开关、显式根、父目录规则、symlink/错误、递归剪枝及公开IncrementalIgnore的缓存/查询 | 除Unix最终分量方法外保持原源。Types、Walk及IncrementalIgnore两处hidden调用详见第4节；不得只测叶文件或仅测CLI而遗漏公开增量API及目录后代 |
| 正则/匹配：`crates/regex`、`matcher`、`grep`、可选`pcre2` | 引擎选择、正则语义、Unicode/字节、捕获、行终止、match位置、大小写及错误 | 原源和准确依赖保持；PCRE2/native库、feature与平台资格独立，不从默认构建外推 |
| 编码、reader与存储：`crates/searcher`及encoding依赖 | BOM/所选编码、解码失败、二进制/NUL、换行、多行、缓冲/mmap和资源释放 | 原源保持。文件路径非UTF-8与文件内容编码是两个边界，不能因路径模型使用字节而声称内容无需解码 |
| 文本、JSON与颜色输出：`crates/printer`、core输出流程 | 文件名与分隔符、匹配/上下文、替换、JSON事件、字节/行位置、颜色/TTY、统计、stderr与stdout分工 | 原源保持；不可为通过比较而统一删颜色、路径、版本、统计或错误字段 |
| 并行遍历与输出：`main.rs`、`ignore/walk.rs`、printer | worker私有缓冲、共享matched/searched、统计结算、Quit/Continue、文件块输出和终止关系；排序模式的实际串并行选择 | 原源保持。无排序并行比较需保留每文件块内次序、重复与归属；不能把所有输出行全局排序后假称等价。精确调度与竞态探测未验证 |
| 错误与退出：core `main/run/search/files` | 匹配/未匹配/错误的0/1/2规则，quiet优先、逐文件错误继续、BrokenPipe约定、错误链和stderr锁 | 原源保持；不能套用其他Command范本的退出策略。P→Q改变实际搜索集合时，允许其原逻辑导出的匹配、错误、统计与退出变化 |
| 资源、取消与故障 | fd、reader、映射、子进程、缓冲、线程、锁、借用与清理；故障后不伪报完整输出 | 保留原资源管理，不新增事务/取消保证。局部方法为纯借用切片；全工程故障注入、极限资源和取消时序未执行 |
| 平台与系统输入 | Unix路径原字节；非Unix `Path::file_name`；Windows HIDDEN metadata、长路径；环境、cwd、TTY、locale、外部程序等实际读取 | 修改仅在Unix cfg内。Windows普通基准不执行该Unix路径分支；GNU Windows不代签MSVC、Linux、macOS或musl |
| 构建、依赖与生成源 | Cargo.lock、manifest、`.cargo`配置、rustc/Cargo、edition、target/features/cfg、宏/build.rs、链接库及生成输入 | 保持实际Cargo owner，不另造依赖求解器。P声明edition2024/minimum Rust1.96；本次原版Windows环境使用Rust1.97.1。上下文相同是保持前提，不是已满足所有目标 |
| 发行与非源码资产 | LICENSE/COPYING、说明、包元数据、Windows Manifest、man与shell补全模板、CI/打包脚本及文件模式 | 全量保留P/Q成员；构建目录不替代源。deb、brew、跨平台release等未发布，未证明发行包可安装或字节复现 |
| fuzz与benchmark | `fuzz/`及其独立manifest/lock/目标，`benchsuite/`与实际benchmark成员 | 即使不属于默认workspace测试闭包或被package exclude，也属于完整作者工程。源保全不等于fuzz运行、性能回归或样本外安全证明 |
| 测试与第二次修改 | 上游tests/fixture、crate测试、doc tests、Q新增回归、P/Q作者源及方法的准确对应 | 测试源保持并可指向各对象；原P测试结果不认证Mixed或Q。四对象与失效规则见第6、7节 |

### 九个公开库根不能被CLI遮蔽

| Cargo包／根 | 准确原生公开面及相交保持 |
|---|---|
| `globset` | glob构造/匹配、错误、公开类型和feature行为；保留原API及其重导出 |
| `grep` | 各grep子库的门面与重导出；`pcre2` feature接入原可选依赖 |
| `grep-cli` | reader、进程/解压、路径/终端等公开工具接口及原效果 |
| `grep-matcher` | Matcher及其相关公开trait、关联类型、生命周期与匹配合同 |
| `grep-pcre2` | 原PCRE2绑定及错误/资源；native依赖与feature不能由同名类型推定 |
| `grep-printer` | 原打印器及配置、统计、JSON/serde相关公开面；保留默认feature含义 |
| `grep-regex` | 原正则构造、配置、matcher及错误接口 |
| `grep-searcher` | 原搜索器、sink、reader/编码/多行与buffer合同；保留原feature解释 |
| `ignore` | Walk/WalkParallel、Types、IncrementalIgnore/IncrementalMatch、规则匹配与公开错误；仅最终分量的相交行为按P/Q改变 |

所有公共类型、泛型、trait、方法、re-export、可见性和条件编译仍由原生源码与准确Rust上下文拥有，不能用九个包名证明API全量匹配，也不需要手写九份签名镜像。最终核对需同时检查相同原文件、Cargo输入、模块接合和没有新增外部导出。历史兼容用的feature即使实际为空，也保留原名字与定义，不擅自当作可删除或新加速保证。

## 4. P→Q允许差额及消费者闭包

P的Unix实现对任意非空路径，只要整个字节序列最后一项是`.`便返回None。其前置“单个点”与后置“末两字节双点”检查被这一条件蕴含。Q先取最后斜杠后的分量，只拒绝分量恰为`.`或`..`。`.foo.`、`.foo..`、`...`、`a/.foo.`等因此从None变为Some真实名称；`a/.`、`a/..`仍为None。

差额不止隐藏叶文件：

- `Types::matched`（`crates/ignore/src/types.rs`）用 `file_name` 的结果进入glob集合；None且已选类型时产生unmatched Ignore，None且无选择时为None。Q新增的真实名称必须让原glob规则处理，不能为维持旧测试而继续当None。
- `is_hidden_path_only`取得名称后按原字节前缀`.`判断。`Ignore::matched_dir_entry`（`dir.rs`）只在已有匹配为None且hidden开关启用时应用hidden fallback；先前whitelist仍优先。
- 串行Walk与并行Walk共用 `should_skip_entry`（`walk.rs`）消费这一结果。被修正的隐藏目录可被剪枝，其所有后代随之改变；`hidden(false)`、显式入口及override等仍按各自原规则解释。
- `lib.rs`真实公开重导出 `incremental::{IncrementalIgnore, IncrementalMatch}`。它是必须保留的库消费者，不能以内部类型名Ignore替代或声称不存在。`IncrementalIgnore::matched/matched_with_errors`经原深度/路径条件进入 `matched_with_errors_ignore`；其父目录遍历先调用内部 `Ignore::matched`，再在hidden启用且结果为None时直接调用 `is_hidden_path`。被拒绝的父目录写入 `CachedDir::Ignored`，后代继续被拒绝；已允许的缓存项及快路径进入 `match_path`。`match_path`也先调用 `Ignore::matched`，再直接执行低优先级的hidden fallback。这两条直接调用并不经 `Ignore::matched_dir_entry`，都必须覆盖。保持root-relative前提、显式root/空路径行为、可选normalize、缓存寿命、部分错误及白名单优先级；Q允许尾点目录的缓存结果及其后代随正确hidden判定改变，不允许顺便修改缓存失效规则。
- 搜索输入集合、文件列举、匹配数、输出、统计及最终退出码可以随上述真实筛选变化。它们是修复的因果闭包，不是允许任意无关输出改变的许可。

非Unix实现、Windows HIDDEN metadata、配置、旗标、正则语义、输出格式与无关输入不属于允许差额。Q中的上游回归测试保持原内容；本例另设独立字节向量时，期望不能由待验Gift算法或同一Rust方法反向生成。

## 5. Gift算法到借用字节切片方法的结构证明

令输入原字节切片为 `b`，长度为 `n`。Gift模型使用保序、保重复的有限数学整数序列表示字节，每项必须恰在0..255；这项边界由真实Unix `OsStrExt::as_bytes`解释取得，不由类型名字自动保证。模型中Option沿现有固定语言解释，不能把另造的同名Some/None当作相同名义类型。

### 5.1 最后斜杠与完整后缀

若没有字节47，定义 `s=0`；否则令最后一次出现47的位置为 `i`，定义 `s=i+1`。目标方法使用 `memchr::memrchr(b'/', b)`得到同一i，返回候选后缀 `&b[s..]`。

Gift的 `ScanFinalComponent(remaining,candidate)` 初始为 `(b,b)`。每次读取remaining首项并前进一项；首项为47时把candidate置为当前tail，否则保留candidate。归纳不变量是：candidate恰为已扫描前缀中最后斜杠之后的完整原后缀，没有斜杠时仍为b。remaining空时，candidate恰等于 `b[s..]` 的字节值。扫描不重排、不去重、不解码，也不移除末斜杠。

### 5.2 两版拒绝条件

P：`n=0`时None；非空且最后字节46时None；否则Some后缀。原P单点、末字节点、双点后缀三个拒绝分支的析取等价于非空末字节点。选定方法若合并这几个判定，普通返回值保持；不得由这一逻辑归约顺带声称逐指令或性能相同。

Q：`n=0`时None；否则先计算后缀，再在后缀字节恰为 `[46]` 或 `[46,46]` 时None，其余Some后缀。`IsDotOrDotDot`对第一、第二项及是否还有余尾的检查与这两个准确有限序列相等条件一致。

`n=0`与`Some(empty)`必须区分：空输入是None；`/`、`a/`等非空且末尾为斜杠的输入得到 `s=n`，两版均为Some空后缀。不能依赖函数注释、宿主Path正规化或truthiness把后者变为None。

### 5.3 非UTF-8、NUL与平台

Unix `OsStrExt::as_bytes/from_bytes`保持原字节，没有UTF-8校验、替换、大小写折叠或Unicode正规化。非UTF-8名称、字节反斜杠及多次斜杠都按原字节算法处理。反斜杠不是Unix分隔符。

NUL可进入这个纯OsStr字节值域，算法仅比较46、47，不擅自拒绝或截断它；这不表示操作系统允许用该名称打开文件。后续系统调用对NUL的原错误仍由未改原生边界处理。Windows路径编码和metadata资格不能由本Unix证明推得。

### 5.4 指针、寿命与边界安全

`memrchr`返回位置时满足 `0≤i<n`，故 `1≤i+1≤n`；无匹配时 `s=0≤n`。安全切片 `&b[s..]`因此在闭合合法范围内，即使 `s=n`也只是合法空后缀，不越界读取。P访问last之前检查非空；Q的切片相等比较也不访问不存在的元素。

方法只有一个借用输入，省略寿命的 `fn file_name(path: &[u8]) -> Option<&[u8]>`将输出借用关联到同一输入寿命。方法不保存引用、不构造拥有容器、不返回临时buffer，也不使用unsafe延长寿命。Some持有原输入从s开始的子片段，长度为 `n-s`；其地址/偏移关系与上游直接取同一子片段一致。`map(OsStr::from_bytes)`将该原借用片段解释回OsStr，不分配、不复制、不改变字节和寿命，wrapper原来的 `Option<&'a OsStr>`关系得到保持。

这项论证以最终方法确实只使用上述安全借用操作为前提。若后续方法插入Vec/String、缓存、intern、FFI或unsafe转换，原证明立即失效，需要重新检查相交观察与资源。

### 5.5 终止、效果与成本

Gift扫描每次严格缩短有限remaining，末字节递归同样减少有限长度；其他判定只看有限前缀。它给出抽象终止论证，`termination:total`本身不是已运行证明，也不消除栈、分配或取消失败。

所选Rust方法对有限切片进行有界查找和有限比较，无递归、无IO、无状态写、无分配；结果只借用输入。源码检查可支持该方法的无分配结构结论，但不能由此推出整个ripgrep无分配或已实测性能等价。

Seq模型的目标表示可能物化O(n)元素、使用O(n)栈；若每次Uncons复制尾数组，累计成本还可能达O(n²)。这些不是所选Rust方法的实现方式。选择借用切片方法是在相同普通值语义下保持原生存储责任，不能声称任何通用Seq lowering天然具备零拷贝性质。精确机器码、调用开销、SIMD选择和极端性能没有在本证明中测量。

## 6. 构建身份、第二次修改与失败恢复

`build.rs`执行 `git rev-parse --short=10 HEAD`并嵌入 `RIPGREP_BUILD_GIT_HASH`。实例保留原生独立checkout的 `.git`，使Mixed(P)/Mixed(Q)分别读取与对应上游相同的P/Q元数据；不能把原源拷进SEC子目录后让build.rs误读SEC HEAD。这个版本字段也不证明实例仍是未改上游：混合作者差额与整个候选内容身份必须另行保留。

本例SourceProfile设计请求的准确身份为 `id="example:ripgrep-cargo-source"`、`revision="1"`，由准备上下文及原解析绑定选择；`PROFILES.md`的Target消费该读取结果。项目字段`targets.all.profileRef`选择的是另一个Target身份`example:ripgrep-cargo-rust`，不新增不存在的SourceProfile项目字段。这些设计身份不自签生产Reader或目标资格。其他Cargo输入仍需保持：P/Q的lock、target triple、Rust/Cargo/标准库、features/cfg、linker/native库、build.rs/proc-macro外部输入、profile与环境。Windows MSVC分支还读取 `pkg/windows/Manifest.xml`并注入linker选项；Windows GNU普通构建没有执行该分支。release-lto的panic=abort、overflow-checks=false、LTO等不能从debug测试外推。

第二次修改的作者差额是P→Q的 `FileName`函数体；模型的moduleId、其他定义及公开出口保持。与它配对的普通Rust方法同时从P语义换为Q语义，继而重做同一wrapper/consumer闭包审查。不能修改目标Rust来掩盖未更新的作者模型，也不能把两份算法并留在wrapper和方法中。

失败或中断时，保留未完成实例与准确前像，不把局部输出标为完整工程。模型、所选方法、原生基准或接合patch任一变化都会使相交保持证据失效；不相关且输入/环境未变的证据可复用。Q的失败不得用P的正常结果替代；原生方法编译成功也不得代签Gift Reader已经接受源码。未实现生产生成链不阻止本轮设计与审查交付，但它明确限制自动编译、任意后继修改和受管回源的运行声明。

## 7. 已取得证据与未执行出口

### 本轮已有的原版P Windows基准

| 证据 | 绑定对象与结果 | 不能证明的范围 |
|---|---|---|
| 原版P构建 | P原生checkout，Rust1.97.1、Windows GNU环境；构建成功 | 不是Mixed(P)/Mixed(Q)构建，不是Gift编译或Unix分支证明 |
| 普通测试 | 原版P累计1182个不同普通测试通过；原运行还有1个ignored。主运行1181通过且`misc::compressed_lzma`失败，随后该用例聚焦重跑通过；额外xz重跑不重复计入1182 | 不是一次全绿的同环境全集；不覆盖所有平台、feature、真实配置会话、性能与所有输入 |
| doc tests | 原版P累计23通过、2 ignored | 不是全部文档场景已运行，也不证明新方法或作者模型 |

已读原始日志中，lzma首次失败原因是PATH选择到的BusyBox xz不支持 `--format=lzma`，不是路径算法反例。后续聚焦通过只证明当次外部工具环境中的该用例；做四对象比较时仍需固定同一准确解压供给，不能把不同PATH环境下的结果当成同一证据。

上游 `tests/util.rs` 支持以 `CARGO_BIN_EXE_rg`选择被测binary；这使同一冻结harness可分别指向四对象，保持期望独立。但它的常规命令助手会清除 `RIPGREP_CONFIG_PATH`并设置 `--path-separator /`，因此必须另核真实配置环境和默认平台路径呈现。不能为了比较修改上游期望。

### 本文不宣称已经执行的验证

- Gift生产Reader、语义链接、类型/效果检查、Rust生成与受管回源。
- Mixed(P)、Mixed(Q)相对对应Native的完整四对象运行比较；后续root取得的证据须按下面独立出口登记。
- 真实Unix文件系统上的尾点隐藏文件/目录、非UTF-8路径、类型过滤、串行与并行遍历，以及公开IncrementalIgnore的父目录缓存与直接查询回归。
- PCRE2及其他不同feature组合、Linux/macOS/musl、Windows MSVC与其Manifest/长路径行为。
- 外部前处理器/解压供给全矩阵、TTY/颜色、真实配置环境、错误注入、取消、资源极限与并发调度检查。
- fuzz执行、benchmark实测、性能回归、所有发布包构建/安装、跨平台发行与bit-for-bit重现。

没有为本例安装或启动Unix宿主、Docker/WSL服务、外部CI或发布设施。未执行项目保留准确边界，不把它们写成设计完成的障碍，也不升级成已通过。

### 本轮新增的有界证据

| 检查 | 准确范围与结果 | 边界 |
| --- | --- | --- |
| 实际装配P/Q | 两个独立实例均读取各自固定上游commit；各224个跟踪成员中222个逐字匹配，另外2个仅为约定接合，新增1个方法文件与分发方法逐字相同；保留各自Git版本上下文 | 是源装配与字节核验，没有运行Gift生成或完整Cargo构建 |
| 源范围归属 | 使用仓库既有SourceScope匹配规则检查每个实例全部成员：native 102、design 17、asset 108、semantic 1；每个成员恰有一个归属，项目清单作为入口另计 | 不是生产SourceProfile解析、Rust公开面或依赖读取闭包的运行资格 |
| 原生文件模式 | P/Q Git对象均为218个100644、5个100755、1个120000；`HomebrewFormula → pkg/brew`身份与目标保留 | Windows现场为普通链接目标文本，实际symlink未物化；Unix执行位和发行物化未验证 |
| 模型与项目结构 | 两份模型经现行canonical Expansion后通过完整候选Schema；项目模板通过project-converged Schema。JsonSchema.Net 7.0，3个对象全部通过；严格JSON读取拒绝重复键 | 只是结构和展开，不是生产Reader、类型、效果、终止或方法资格 |
| 借用方法 | 分发包的`verification/path_policy.rs`独立向量在Rust1.97.1、Windows GNU下，以原版P已锁定memchr构建产物编译并执行；P/Q两项测试通过，每项22组输入，同时核返回值和借用后缀指针，包括Some(empty)、非UTF-8与纯值NUL | 编译的是本例两份真实方法，不是模型；没有执行Unix OsStr wrapper、文件系统、Types/Walk/IncrementalIgnore或四对象全程序比较 |
| 装配脚本 | PowerShell语法检查、P/Q成功装配、已有目标目录在任何变更前拒绝，均通过；Git换行设置固定在新实例本地，避免checkout与apply使用不同CRLF规则 | 不更改全局Git配置；未模拟全部网络/磁盘/权限故障 |

模型与方法准确SHA-256见[绑定设计](PROFILES.md#本例准确的模型方法使用点选择)。本轮详细工作证据保存在维护工作区的`report/ripgrep-whole-engineering-20261025.md`及`.tmp/whole-engineering-20261025/`；它们是本地审查材料，不是生产系统的权威回执。可从分发源重新装配实例并独立复核，不能依赖本地临时目录存在才理解设计。两位Astra审查者分别覆盖画像/完整工程与独立绑定/实际消费者；最终冻结候选的审查和提交身份由仓库交付记录绑定，不冒充本文内运行证明。
