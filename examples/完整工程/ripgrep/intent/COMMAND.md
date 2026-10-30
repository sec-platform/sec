# rg 一次调用的产品合同

本设计源拥有 `rg` 命令产品的一次调用边界、模式结果及其与现有局部决定的同次关系。参考对象固定为 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`；P→Q 的路径变化由[路径决定](PATH-SELECTION.md)拥有。下文给出准确的产品约束，不指定匹配算法、Parser 类、循环、容器、队列或线程实现。它目前是 Project 捕获的设计源：完整旗标/搜索/呈现定义、固定机器解释与 Target 尚未闭合，不把正文或引用当成可构建的最终第一层源。

## 选择的抽象：同一产品的开放调用关系

一个命令产品可以有多次调用。每次调用有自己的输入发生、有效决定、环境交互、已产生输出及终结；不同调用的观察不能拼成一个结果。这里的“同次”是语义上的关联，不要求作者生成运行 ID、维护阶段对象或填写事件台账。命令主体也不等于每次启动的进程实例。

| 必须保留的含义 | 本产品中的实际内容 | 系统可以选择的实现 |
| --- | --- | --- |
| 输入及可用时点 | 有序 OS 参数、配置来源、工作目录/环境、终端与构建能力；stdin 和路径输入可持续与环境交互 | 参数容器、缓存和数据布局；不能假定已经读完未来 stdin 或冻结全部文件系统 |
| 产品决定及同次关系 | 参数/配置决定模式与选项；搜索或文件选择结果、错误累计及输出失败共同决定该次结果 | 分解、调度和内部状态；不能让作者另填可由输入确定的 mode、quiet 或错误状态 |
| 公开观察 | stdout/stderr 的内容及已发生部分、相交输入消费、错误与终结、合同要求的先后关系 | 不影响这些观察的缓冲、合并与组织；接口另有回调/短写要求时仍须保持 |
| 允许的变化 | 约定范围内可变的文件/终端/IO 环境、并行文件结果次序、失败及取消 | 同一合格策略必须在线遵守可得信息；不能事后从不同实现各取一个结果 |
| 正常功能和结束 | 合法输入下应提供所选模式的功能，错误/直接退出保留各自条件与清理区别 | 取得实现及目标接合；不能用全部失败或永不返回满足只有安全约束的空合同 |

这复用[已有要求的观察与实现语义](../../../../docs/作者/第一层语言.md#first-layer-denotation-and-realizability)及[需求与实现分工](../../../../docs/作者/需求含义与实现责任.md#intent-primary-correction)。源码中的相同类型、相同字段名和合取条款次序都不创造这些关系。`req:composite` 可以把已解释要求绑定同一主体，但其静态 `when/forEach` 不能执行未来 argv 或 IO 的运行分支；不为本产品另设一个按 Rust 构造扩大的普通语言。

## 输入决定与可观察准备边界

[参数来源](ARGUMENT-SOURCES.md)拥有原始参数、配置前置与再次解析的局部决定；[命令选项](CLI-OPTIONS.md)拥有 104 旗标的公开词表、值域、默认和组合决定。本合同将它们限定在这次调用的真实输入和诊断上，不能从任意调用拼出其阶段结果。

1. 第一次 argv 必须完整解析成功，随后设置消息和日志资格，才处理该次最终 Special。帮助/版本不掩盖非法参数；成功进入 Special 时不读配置，也不做普通高层准备。
2. 其他情况按原参数来源决定取得配置。配置非空时，其参数在再次取得的 argv 之前；结果由同一参数语义重新决定。配置中出现 Special 不再次进入信息短路，P 的后续高层准备要求 Special 为空；违背时走实际 assertion Fault，不能擅改为普通帮助、忽略或退出 2。
3. 普通模式、否定和覆盖遵循命令选项的同一决定；尤其不能从通用 last-wins 推断上下文、累计选项、分组 glob 或其他相互作用。完整决定 q 只能由同次实际输入按该合同取得，不能让调用者另填投影值，也不能逐字段混合两次决定。产品作者维护公开能力和必要的兼容差异；q 的存储形状、归约方法和执行阶段由系统承担。真实类型、固定解释及产品根仍待接合。
4. 非 Special 模式共享高层准备的相交检查：排序支持、工作目录/终端、路径、超链接、类型、glob 与 pre-glob 等。因此 Types/Generate 虽不搜索文件内容，也可能在这些检查处失败。非 Search 模式不收集 `-e/-f` 指定的搜索模式。
5. Search 的模式来源与搜索输入共享实际 stdin：第一次 `-f -` 成功消费 stdin 后，再一个 `-f -` 或显式搜索路径 `-` 都报对应错误，不能因实现缓存了字节就允许复用。此时没有显式搜索路径则选择当前目录；`./-` 是文件路径，不能按裸 `-` 处理。真正读取时点、失败与资源责任归对应来源关系，不能用“两处都有 stdin 字段”证明可同时消费。

选项的正常决定不替代验证和实际使用；具体接合遵循[解释与实现选择的保持条件](CLI-OPTIONS.md#固定解释与实现选择的保持条件)。[同次消费关系](CLI-OPTIONS.md#同次决定到搜索输入与公开结果)进一步将预处理/解压、二进制区别、引擎与编码、输出适用字段连接到本次真实输入和结果。尤其不能先删除被覆盖的非法值、为所有模式提前打开模式文件/ignore 文件，或把 matcher、pre 命令位置解析及遍历准备排列成一条无条件流水线。单线程和并行 Search 的相交诊断顺序、排序是否已经取得候选，以及不可匹配快捷分支，都属于同次调用的真实观察关系。

参数与观察的类型接合沿[真实类型与发生点](ARGUMENT-SOURCES.md#真实类型与发生点)，并保持以下产品区别：

- 平台 OS 参数、路径、模式文本和最终字节值不能混为一种 Text。Unix 的 `-f` 路径可含非 UTF-8 字节，同样的非法 UTF-8 参数作为 `-e` 模式会失败；`-f` 的路径虽为原生路径，文件/stdin 内的模式行仍须为有效 UTF-8。分隔符参数必须先是有效文本，其中的转义可产生非 UTF-8 字节；不能把“文本形式的 `\xFF`”与直接输入 `0xFF` 当成同一输入。一般 Windows OS 字符串也不保证都是 Unicode 标量序列，所选绑定须保留原生合同，不能默用有损转码。[Rust OS 字符串合同](https://doc.rust-lang.org/std/ffi/struct.OsString.html)、[Windows 的无损宽字符视图](https://doc.rust-lang.org/std/os/windows/ffi/trait.OsStrExt.html)说明这一差别；实际采用仍须绑定所选工具链，而非在线 latest。
- 高层准备需要 cwd 时，先取实际 `current_dir`；失败后才接受非空 `PWD` 作为路径后备。这不把 cwd 读取提前到 special 断言或排序支持检查之前。P 不在此处验证后备路径等于真实 cwd、是否绝对或是否存在；也不能让环境字符串覆盖一次成功的 cwd 读取。
- 没有显式路径时，P 先进行 stdin 可读性探测及其相交诊断，再结合本次 stdin 消费状态与是否 Search 选择默认输入；已消费 stdin 或非 Search 模式不自动省去这次探测，启用的 debug 写失败仍可能直接退出。可读候选在 Unix 为文件、FIFO 或 socket，在 Windows 为 disk 或 pipe，并且 stdin 不能是终端；探测失败按不可读处理，其他平台默认不可读。这不证明输入就绪、不会阻塞或未来读取成功。裸 `-` 的显式请求不受这一启发式拒绝；最终选择仍按上述模式来源的消费约束处理。实现可改变探测组织，但须保持所需结果与相交可观察诊断/失败，不能只按布尔公式短路掉它们。
- 同一 stdin 的多个句柄或锁不产生新的输入源。模式读取和搜索必须保留同次来源、已消费前缀及失败；不能直接套用两次 open 就产生两次源运行的冷流默认。具体锁、复制和缓冲交下层保持，不成为作者接口。标准库的 [Stdin 合同](https://doc.rust-lang.org/std/io/struct.Stdin.html)也明确多个句柄共享进程输入缓冲；其 Windows 控制台条件与普通文件/管道不同，字节流抽象不保证任意通道都能成功传输任意字节。

这些要求只保留外界可区分的条件、发生和次序。实现无需保留 LowArgs、HiArgs 或原调用栈；改变组织时仍须证明正常功能、错误优先及已发生观察保持。固定源定位见文末。

## 模式、结果与退出决定的接合

Search 子模式、Files、Types、Generate 和 Special 是产品含义，不是五个必须按顺序运行的阶段。下表中的结果均属于同一次调用；Search 的通常结果输出还受 quiet、二进制筛选及对应输出选项约束，下节单独规定统计和快捷结果。“写成功”仅指所要求的写调用返回，不代签终端显示、磁盘持久化或最终接收者已经取得字节。

| 有效模式 | 必须提供的正常行为 | 本次退出决定的真实输入 |
| --- | --- | --- |
| Search / Standard | 搜索指定内容并按选项给出匹配、上下文、替换及路径等呈现；完整选项语义由搜索/呈现定义承担 | 成功搜索的实际 sink 结果贡献 selected，再结合本次 quiet/errorRecorded |
| Search / JSON | 按[公开 JSON 格式](../library/JSON-OUTPUT.md)提供 match/context 等事件；文件有相应事件时才产生其 begin/end；正常搜索结尾另尝试 summary | 同上；不能把存在 summary 等同于 selected |
| Search / FilesWithMatches | 对经过相应二进制筛选后仍有匹配的输入输出路径，允许符合统计/结果合同的提前结束；后续 binary quit 可清除此前计数并抑制路径输出 | 对应 sink 的选中结果 |
| Search / FilesWithoutMatch | 对没有匹配的输入输出路径 | 对应 sink 以匹配计数为零判 selected；二进制 quit 可清计数、不输出路径而仍为 selected |
| Search / Count | 普通行搜索计匹配行；真正跨行的 multiline 情况计匹配数 | include-zero 可使 stdout 有零计数，但 selected 仍为 false |
| Search / CountMatches | 输出匹配数 | 对应 sink 的选中结果；准备阶段 CountMatches+invert 改为 Count，Count+only-matching 改为 CountMatches，按单次分支处理而非级联 |
| Files | 发现和筛选路径，不搜索文件内容，不建立搜索 matcher | 至少取得一个合格条目即 selected；quiet 可在写该路径之前停止 |
| Types | 输出已配置的类型；名称和各类型的 glob 均排序，每项为 `name: glob, ...` 加 LF | 全部相关写入成功后，实际类型集合空/非空进入 Types(hadTypes) |
| Generate | 输出选定 man 或 Bash/Zsh/Fish/PowerShell 补全，其输入与生成关系归 [CLI-DOCUMENTATION](CLI-DOCUMENTATION.md)；尾空白按 P 的 trim_end 语义去除后写一个 LF | 写调用成功后进入 Generation |
| Special | 短/长帮助消费同一 [文档词表与原格式资产](CLI-DOCUMENTATION.md)；短/长版本及 PCRE2 版本保留各自合同；不消费普通搜索输入 | 普通帮助/版本进入 HelpOrVersion；PCRE2 信息进入 Pcre2Version，参数取本次构建的 pcre2 feature，JIT 能力只影响其文字 |

Search 的公开结果形式由 [RequestedPresentation](search-result.module.json) 唯一选择：输入来自该次已经归一的 SearchMode 及有效 quiet/stats 请求，得到同次 SearchPresentation。其构造的真实输出、统计、早停及选项消费见[结果呈现关系](CLI-OPTIONS.md#结果呈现统计与终结共享同一选择)。这不要求在原实现中虚构一个同名调用或返回对象；目标须共同满足这些消费关系。仅有本纯值定义不使参数或实际搜索已经完成；不可匹配快捷分支仍不得为了产生 presentation 的观察而构造 printer 或输出统计。

退出请求的值与构造仍由现有 [RequestedExit](cli-exit.module.json) 唯一拥有，来源细目见[退出决定说明](README.md#命令退出的产品决定)。本合同拥有上述输入来自何处，而不再复制一份十五行退出政策或让运行期调用方随意填写原因。

Search/Files 取得正常完成结果后，按该定义的 SearchOrFiles 分支从同次观察取得所需值：未选中只需 errorRecorded；选中时先按 quiet 区分，quiet 分支不需要错误累计，否则才取得 errorRecorded。其余模式直接使用各自原因。传播至顶层的错误和实际诊断写失败使用相应错误原因。正常返回与直接退出的清理/部分输出区别继续由目标保持，不能都实现为“最后返回一个相同整数”。

准确关系是：固定同一候选实现/策略，对允许环境中每次被接纳调用的同一历史，在它实际到达该调用的正常完成、共同顶层传播错误或诊断写失败直接退出点时，按该条件形成唯一 `reason`，该次终结请求等于 `RequestedExit(reason)`。`reason` 是关系内部由真实输入与结果派生的值，不是调用者另填的参数；mode/quiet 也由同次参数定义决定。若先发生诊断写失败，它已直接终结，不再取得后来的正常结果。不得对每次调用分别离线挑一个结果，再宣称存在同一在线策略；该条件关系也不免除正常功能和进展。

这里 errorRecorded 表示该次调用截至适用观察点已经发生会影响退出的非致命错误，不要求作者维护 AtomicBool。遍历返回的错误（不含成功条目附带的 ignore 规则错误）、相应文件搜索错误、并行共享 stdout 的非 BrokenPipe 错误，以及实际搜索中隐式路径没有任何输入被接受时的错误，都沿真实分支贡献；配置读取/行错误的普通 message 与 ignore 消息本身不贡献。它们的诊断写失败仍可直接退出。完整参数、结果生产及输出端点未绑定前，这份关系只是已确定的产品设计，不能因函数体存在或静态主体相同便宣称机器接合完成。

## 正常行为不能被简化掉的区别

- **不可匹配快捷结果。** 高层准备成功后，Search 的空模式集且未反选，或 max-count=0，令 selected=false；不建立搜索 matcher、不遍历，也不输出统计或 JSON summary。准备期已经发生的配置、模式来源读取或诊断不会倒退成未发生。
- **quiet 与统计。** quiet 选择安静的搜索结果呈现；统计存在时不采用全局首个结果早停，仍可能输出统计。JSON 自带统计，实际执行搜索后 quiet+JSON 仍可能输出 summary。Files 不建立 search stats；Types、Generate、Special 自身输出也不由 quiet 禁止。
- **选择与输出是两个观察。** Files quiet、FilesWithoutMatch 的二进制 quit 可 selected=true 而无相应路径输出；Count include-zero 可有输出而 selected=false。仅观察 stdout 是否为空不能重建退出原因。
- **错误累计与诊断显示是两个观察。** `err_message!` 先设置同次累计，再按消息开关决定显示；`--no-messages` 不清除累计。ignore 消息不设置这个累计。顶层传播错误的诊断不受该消息开关抑制。
- **不强加文件间全序。** 并行结果保留产品实际要求的文件块与内容顺序；没有独立要求的跨文件总顺序不能由一次样本或列表存储形状升级而来。stdout 与 stderr 各自的内容和相交因果要保留，不发明一个总排序来代替真实交互。

## 失败位置、部分结果与终结

错误种类相同不表示作用相同；解释须保留它是在本地处理，还是传播至共同边界，以及该时刻已有的输出/selected/errorRecorded。这里的发生点是可区分行为的条件，不要求生成源码复制原私有函数。

| 真实发生条件 | 保持的观察及后续关系 |
| --- | --- |
| 传播到 main 的错误链含 io::ErrorKind::BrokenPipe | 不发顶层错误诊断，进入 PropagatedBrokenPipe；不能据此重写已在本地处理的 BrokenPipe |
| 其他错误传播到 main | 先尝试顶层诊断；诊断写成功才进入 PropagatedErrorReported |
| 任意 eprintln_locked 的诊断前缀或正文写失败 | 在该失败位置使用 DiagnosticWriteFailure，按实际 io kind 区分 BrokenPipe；保持直接退出跳过相应清理和后续作用的可观察结果，不要求复制原私有调用栈 |
| 串行 Search 的一次文件搜索返回 BrokenPipe | 本地停止，尚未把该文件结果计入 selected；保留之前结果与部分 stdout，随后正常结果仍按 SearchOrFiles 判断 |
| 并行 Search 的一次文件搜索返回错误，包括 BrokenPipe | 使用 err_message! 累计并继续该运行允许的后续工作；这不是共享 stdout 写失败的路径 |
| 并行 Search 的结果写至共享 stdout 时 BrokenPipe | 本地停止遍历；该次文件 selected 已计入。其他相交错误按实际传播/累计关系处理 |
| Files 输出路径时 BrokenPipe | 在本地停止相应输出/遍历，保留已选结果；其他路径写错误传播 |
| Search 结束处的统计/JSON summary 写失败 | P 忽略该处写入错误；不能把这条特殊规则推广到普通结果或诊断写入 |

错误分类必须在实际消费点读取传播后的错误链。模式文件打开/读取和模式 stdin 读取会把原错误格式化进新的 `io::ErrorKind::Other`；因此底层原因曾是 BrokenPipe，也不必然进入顶层 PropagatedBrokenPipe。配置打开失败、配置读取失败与配置行错误的不同包装由参数来源合同拥有，不能根据最初原因或诊断文字重新制造已丢失的错误链。

任何失败都不回滚已经发生的 stdout/stderr 或 stdin 消费。文件输入、外部进程、缓冲、句柄和其他资源的关闭/取消由所选实现及目标负责保持；本合同不把一次逻辑 Return 当成全部物理作用成功。panic/abort、信号、OS 终止和未结束保持各自出口，不能凑成正常 ExitReason 的一个合法值。

排序与错误先后还有一个真实约束：P 的串行倒序路径或时间排序在构造 matcher 前已消费路径及相交观察；正序路径排序可能延迟遍历。并行 Search 则先建立 matcher 等搜索能力，再开始遍历。因而“模式非法时绝不访问路径或产生路径诊断”不是此产品的通用保证；替换实现必须保持所选路径中已承诺的错误优先与部分观察，不必保留具体 Vec 或排序算法。

## 组合与实现责任落点

| 现有定义或责任 | 真实接合条件 | 尚未由局部源完成的内容 |
| --- | --- | --- |
| 参数来源与命令选项 | 该次实际 argv、配置及解析/诊断接到输入；全部成功后的决定与同次实际使用相连，保留逐项首错及有条件的后续验证 | 实际类型化解释与完整输入/作用接合；词表、逐项决定和相交验证时点已有合同 |
| 路径选择 | 同次实际候选及其已取得规则/环境观察；名称只消费[唯一政策](PATH-SELECTION.md#path-name-policy)，P→Q 修改及 Types/hidden/Walk/IncrementalIgnore 的相交条件见[再次修改](../changes/README.md) | 固定解释与实际 API/目标绑定仍未完成；进入搜索的集合变化须由原搜索、输出与退出关系继续消费 |
| globset 合同 | 通过真实的库使用与路径筛选关系接到同一候选；库的公开 API 根独立保留 | 机器解释、完整公开边界和实际使用映射；仅 import 库根不完成接合 |
| JSON 消息格式 | JSON 模式和库 printer 选择各自的准确 Schema 入口，消息的路径、字节、偏移与统计来自同次真实搜索 | Schema 可检查单条值；消息可达性、流及部分写入、完整搜索和目标观察仍由真实关系闭合 |
| RequestedExit | 上述同次模式结果、错误累计或实际失败位置产生唯一相符原因 | 结果生产与实际进程终结、目标清理/输出行为 |
| 共同要求编译 | 真实字段和主体绑定形成 BoundRuleApplication，按[原观察绑定算法](../../../../docs/编译/内核/领域方法与整体根.md#meaning-observation-binding)贡献同一 MeaningResult/BoundaryView | 本产品的准确输入/观察定义及真实固定解释内容；共同算法不替产品补出端点，不能预填 methodRef |
| 实现与 Target | 消费同一接受关系、输出根和相交保持义务，取得合格实现并生成实际命令 | 完整搜索/呈现供给、Rust 命令根与工程装配；生产实现不在本次实施范围 |

“同一次调用的开放行为关系”可以复用于其他 CLI、服务请求和库会话；它不是把它们强制变成相同退出码或同一消息协议。`rg` 的具体模式、错误和统计政策仍属于这里及其被引用定义。现有区间示例的 Command 限定单个 UTF-8 stdin 数组、不读取 cwd 文件，不能成为本产品的默认合同；`product:system`、额外 Goal 或 workflow 包装也不能补出缺失含义。

具体到现有名义定义：同一命令调用κ的有效Search/Files正常完成，若其参数关系给出quiet=true、模式结果关系给出selected=true，就形成 `ExitReason.SearchOrFiles(SelectedQuiet(unit))`，由现有RequestedExit定义取得 `ExitRequest.Return(0)`；此分支无需读取errorRecorded。这些值来自该次已解释关系，不是作者新增字段或实现必须暴露的变量。max-count=0可直接产生未选中结果，不能为了统一接线强迫它产生一次实际搜索或搜索回执。

RequestedExit的纯值关系不等于命令终结；即使目标确实调用该函数，该子调用的input/return也不是rg的argv/进程退出。它与命令κ的关系仍由实际模式结果和终结合同提供，目标保持同一终结原因、清理和已发生的输出；只有源引用相同不能建立这种关联。这里无需强制目标物理调用RequestedExit，只须满足其准确关系。

准确解释应保持输入接纳、输出/错误/进展关系、实际选择权和观察时点，并使两次调用的替换观察被拒绝。定义只确定一族合格实现，不必强制唯一算法。对全部允许输入/环境的关系、存在合格实现、取得具体实现、目标保持和实际验证分别判断；本次静态核对不跨过这些边界。

## 区分见证与固定源定位

在正常 IO、无其他相交环境影响时，`rg --no-config --fixed-strings --no-line-number --no-filename --color=never -e needle -- ./file` 对字节 `hay\nneedle\n` 的文件给 stdout `needle\n`、空 stderr，正常选中且未累计错误，进入相应 Return(0)。改成无匹配的文件进入 Return(1)。这是待执行的产品区分见证，不是全域规范或运行 PASS。

同次反例：调用甲 quiet 且 selected；调用乙 non-quiet、selected 且 errorRecorded。甲请求 0、乙请求 2；把甲的 quiet 用到乙上会错误地请求 0。另一组必要区别是 max-count=0+JSON 没有 summary，与实际搜索的 quiet+JSON 仍可有 summary；它们阻止“quiet 等于无 stdout”或“JSON 总有 summary”的错误抽象。

以下均为固定 P 内的静态来源；路径用于审查，不要求构建依赖参考 Rust。引用范围不代替本页尚缺的完整产品定义。

| 关系 | P 内定位 |
| --- | --- |
| 第一次解析、Special、配置与重解析 | crates/core/flags/parse.rs:64–112；flags/lowargs.rs:153 起 |
| 高层准备、子模式与 stdin 消费 | crates/core/flags/hiargs.rs:113–167；模式来源 980–1043；路径 1081–1133 |
| 不可匹配、printer 与统计 | crates/core/flags/hiargs.rs:521–603、1248–1257 |
| 模式分支、正常与传播错误退出 | crates/core/main.rs:43–103、329–408 |
| 串行/并行搜索及局部失败 | crates/core/main.rs:107–227；统计 441–459 |
| Files 选择与输出失败 | crates/core/main.rs:235–325 |
| 消息累计与诊断直接退出 | crates/core/messages.rs:33–99；logger.rs:31–54 |
| sink 结果与二进制区别 | crates/core/search.rs:385–408；crates/printer/src/summary.rs:501–507、638–672、725–785 |
| 排序与 matcher 的可观察先后 | crates/core/flags/hiargs.rs:761–800、907–915；main.rs:107–175 |
| 类型排序与 PCRE2 信息 | crates/ignore/src/types.rs:250–254；crates/core/flags/doc/version.rs:53–78 |
| 原生路径、Unicode 模式及转义字节的区别 | crates/core/flags/defs.rs:2086–2128、5890–5912；flags/lowargs.rs:483–490；crates/cli/src/pattern.rs:34–73 |
| cwd 后备、stdin 探测与模式读取错误包装 | crates/core/flags/hiargs.rs:1106–1133、1298–1311；crates/cli/src/lib.rs:170–249；crates/cli/src/pattern.rs:82–108 |

当前已确定的是命令边界、模式结果、同次退出映射及这些反例。完整旗标、字节匹配/编码、输入发现、呈现和资源/平台合同仍需分别闭合；尚未取得固定机器解释与全部真实观察连接、九库完整根、Target、全工程 P/Q 等价及再次修改结论。未运行上述命令或故障场景；生产 Reader/生成、编译和平台/并发/性能/发行验证未执行。
