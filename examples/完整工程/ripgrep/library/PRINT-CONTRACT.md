# 公开呈现与输出目标的产品合同

本源拥有固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 Standard、Summary、PathPrinter、颜色、hyperlink 和统计的共享含义。JSON 结构与 Writer 例外归 [JSON-OUTPUT](JSON-OUTPUT.md)，插值和匹配上下文归 [MATCHER-CONTRACT](MATCHER-CONTRACT.md)，搜索事件与停止归 [SEARCH-CONTRACT](SEARCH-CONTRACT.md)。它们通过[联合产品](../intent/WHOLE-PRODUCT.md)共同约束 CLI 和开放库。当前是实际设计源，完整机器声明、固定解释与目标接合仍待形成。

## 呈现与搜索的分工

搜索器决定交付的匹配行块与上下文；打印器为颜色、列号、逐匹配输出、替换或统计，可以再次调用绑定 Matcher。这个调用有自己的错误、作用和资源要求，不能从最终文本反推而消除。公开类型本身不证明 Searcher 和 Sink 绑定了同一 Matcher 或相容配置。

Standard 输出内容，Summary 输出计数、路径或安静选择，PathPrinter 直接接受路径。库允许合格 Write/WriteColor、无路径 Sink、自选分隔字节和同一 Sink 的复用；CLI 的当前组合不是库输入范围。JSON 类型只在 serde feature 下公开，默认启用；关闭 JSON 不同时取消其他呈现。

Builder 后续修改只影响新构造的 printer，同一选项重复设置取后值；颜色列表内部的按序合并是另一规则。printer 拥有目标、配置和跨搜索写入计数；sink/sink_with_path 建立本 Sink 的 Matcher、状态和可选统计。复用 printer、复用 Sink 与 Clone printer 不是同一生命周期。

## Standard

默认显示已有路径；heading、only_matching、per_match、per_match_one_line、替换、最大列数、列号、字节偏移、ASCII 裁剪和统计关闭。默认没有颜色/hyperlink、没有搜索间分隔；上下文分隔为 `--`，匹配字段为 `:`，上下文字段为 `-`，路径分隔和终止字节无覆盖。行号和内容终止符由实际 Searcher/Sink 事件提供。

sink() 无路径；sink_with_path 在 path 关闭时也形成无路径 Sink。heading 仅把实际路径放到本次输出前的独立行，不为无路径输入虚构名称。一般前缀依次为路径、行号、列号、字节偏移、内容，只为实际字段输出分隔。自选路径终止字节替代对应路径后的字段分隔，heading 后则替代普通行终止符。

搜索间分隔消费 printer 先前已接受输出、本次尚无计数输出及 separator_search 的共同条件。context_break 输出 separator_context 及搜索器终止符；None 不输出，空字节串仍可输出终止符。库不会只因第二个 heading 就无条件补空行。

普通呈现按报告行输出；实际多行块拆成参与行。重新取得非空匹配列表时，only_matching 输出片段，per_match 为各匹配重复输出参与的完整行，前者优先。per_match_one_line 在实际多行 per_match 分支中，于一次未超限的参与行输出后结束该匹配；超出 max_columns 的参与行写出省略或预览结果后直接继续，可能仍输出同一匹配的后续参与行。这是固定 P 的兼容行为，例如跨行匹配 `ab\nc`、max_columns=1 时，第一行省略后第二行仍可输出。**重新查找列表为空时退回整行路径**，反选行等输入不能被简化成 only_matching 一定没有整行输出。

列与偏移是字节坐标，不是字符数或终端显示宽度。固定 P 的分支分别保持：普通多行慢路径给各行使用第一个匹配的块内起点加一；多行 only_matching 使用该匹配的块内起点加一及匹配的绝对偏移；多行 per_match 使用相对于当前行的饱和减法加一；单行 per_match 即使显示整行，字节偏移仍为匹配起点。不能用一个理想的“所有列号都相对于显示行”覆盖它们。

替换按实际需要建立捕获空间。原匹配列表和替换后的字节/范围分别保留；后续颜色、长度、片段、拆行和列号可消费替换后的内容，匹配统计仍消费原事件/原列表。替换可以改变长度和引入终止符，展示坐标不保证可逆映射原文件。反选 context 可重新匹配和替换，普通非反选 context 不走这一额外处理。

ASCII 裁剪只去掉 TAB、LF、VT、FF、CR、空格组成的前缀，并在配置终止符包含的字节处停止；不改写原匹配位置。max_columns 的门槛是相应片段字节长度严格超限：有的分支含终止符、有的先移除；无色普通路径先裁剪，有色单行路径则按原 bytes 测量。preview 取前 N 个 bstr grapheme clusters，而超限判断仍按字节；它不保证终端恰好 N 列。省略信息及剩余匹配数按实际范围和匹配起点计算，不由截断输出重新匹配。

## Summary

| Kind | 输出与选择 |
| --- | --- |
| Count | 输出本次 match_count，可带路径 |
| CountMatches | 强制统计，输出该 Sink 的 stats.matches，可带路径 |
| PathWithMatch / PathWithoutMatch | 分别在本次计数大于零/等于零时输出路径 |
| QuietWithMatch / QuietWithoutMatch | 不输出；has_match 分别按本次计数大于零/等于零判断 |

exclude_zero 默认开启，只控制两种 count 输出。Path 两类必须有真实路径，缺失时 begin 返回 io 错误，不静默降为 quiet。PathWithoutMatch 的实际分支按计数为零，原注释的相反说法不改变此次兼容。

无统计的 PathWithMatch/QuietWithMatch 可在首次 matched 后返回 false，启用统计则继续；Without 两类没有这条首次 matched 早停。返回 false 的最终效果继续受搜索器实际停止关系约束，不等于已经封闭所有后继作用。

非实际多行时 match_count 每次 matched 增一；实际多行时按重新发现的匹配数量增加。统计或实际多行需要重新匹配；即使没有重新找到匹配，也至少按一记录。stats.matched_lines 则按事件包含的行数。Summary 继承 context/context_break 的无输出默认行为。

binary_data 不立即更新公开查询的二进制偏移，finish 从 SinkFinish 取得它。Quit 且已观察二进制时，先累计统计，再把本次 match_count 清零并跳过摘要输出；Without 的 has_match 因而可为 true 而没有路径输出。Convert 不走这一清零。早停 With 路径未必发现后方二进制，不能由其结果证明整个输入没有二进制字节。

## 路径、颜色与 hyperlink

显示路径与链接目标分别解释。普通路径在 Unix 保留 OS 字节，其他平台按实际 lossy 转换；separator 替换 `/`，Windows 还替换反斜杠。PathPrinter 默认每次路径后输出 LF，可单独设置 terminator，不需要 Matcher 或搜索会话。

ColorSpecs::default 没有样式，default_with_color 才使用平台默认：Unix 紫红路径、Windows 青色路径、绿色行号、红色粗体匹配。列表按部位和顺序合并，后属性覆盖，none 清空该部位；Builder.color_specs 整体替换集合。path/line/column/matched/highlight 是五个独立公开部位。

UserColorSpec 的部位、属性和样式按源码小写化，支持 fg/bg/style/none，数值色彩沿 termcolor。to_color_spec 只留下属性应用到空样式的结果，丢弃部位信息。P 的 none 分支接受并忽略第三段，不能照注释将这种输入改成错误。ColorError 的结构和呈现保持。

颜色是否可见依赖真实 WriteColor。Standard 重查匹配受 supports_color 与匹配样式等条件影响，仅设置 highlight 不保证所有路径重查或 context 整行着色。PathPrinter 在不支持颜色时跳过样式和 hyperlink；Standard/Summary 的部分路径仍会调用 set_color/reset，不能统一三类 writer 回调行为。

HyperlinkFormat 接受空格式、内置别名或变量格式；变量为 path/line/column/host/wslprefix，双花括号表示字面花括号。非空格式须有 path，column 要求 line；scheme 在首段静态文本中，由一个以上 ASCII 字母、数字或 `+-.` 接冒号，P 不另要求首字符为字母。配对/变量错误保持对应错误；Display 的展开结果不承诺所有字面花括号都能原样往返解析。

host/wsl_prefix 缺席时插值为空，line/column 缺席时为一。只有格式非空且目标支持颜色和 hyperlink 时才发链接控制。heading 可以单独链接；格式不依赖行号时可不再给每个行前缀重复链接，依赖行号时仍按行链接。Summary/PathPrinter 使用缺省位置。

| 链接路径 | 固定 P 的关系 |
| --- | --- |
| Unix | canonicalize 可访问文件系统、解析链接；失败记录日志并放弃 hyperlink，不使显示路径失败 |
| Windows | std::path::absolute，处理 verbatim/UNC；无法无损转换字符串时放弃链接 |
| 其他平台 | 不产生链接路径 |
| 编码 | 保留 ASCII 字母数字、`/`、`:`、`-`、`.`、`_`、`~` 及非 ASCII 字节，其他 ASCII 用大写十六进制百分号；Windows 额外转反斜杠为 `/` |

上述保留集合精确为字母、数字、`/`、`:`、`-`、`.`、`_`、`~` 和非 ASCII 字节，空格必须编码。不能统一将全部非 ASCII UTF-8 字节百分号化。显示 separator 在 Unix 也影响重建的链接输入，非 Unix 保留原 Path。路径求值可在 Interpolator 判断链接格式/目标支持前发生并缓存，不能由未开启链接断言没有绝对化或 canonicalize。

公开 hyperlink_aliases 返回按名字排序的真实元数据；Alias 只公开 name/description/display_priority，priority 不保证跨版本不变。当前 11 个别名及真实模板由既有 [别名数据](hyperlink-aliases.json)与原来源拥有，default 的平台差别保持，不在本源再复制一套模板。

## 复用、部分写入与统计

Standard/Summary 的 begin 重置本次计数、时间和二进制状态，不清空该 Sink 的 Stats。复用同一 Sink 时统计累加；从同一 printer 新建 Sink 则新建统计。CountMatches 可以输出累计 matches，而 exclude_zero 仍按本次 match_count 判断。

Standard 的 match_count/has_match 在 matched 事件发生时改变，早于二次匹配、替换或输出失败；stats.matches 按原始匹配列表，二者不同。Convert 已通知二进制时仍先重新匹配/替换并更新相交统计，再返回 false 抑制该次正文。finish 的二进制文字保持其自己的 LF，不统一替换为配置终止符。

普通内容/路径/分隔/数字消费实际 write_all 或格式写入，不沿用 JSON 单次 LF write 的例外。数据、样式、reset 或 hyperlink 控制的失败均可能留下部分结果；没有回滚或必先关闭样式/链接的保证，也没有每次 finish/into_inner/每行强制 flush 的共同保证。

has_written 只表示计数器记录的数据写入接受量非零，不证明本次有匹配、持久化或显示。get_mut 直接写目标会绕过计数，样式/hyperlink 转发也绕过数据计数。into_inner 返还目标；Clone 复制 W 及已有计数/配置，W 是否共享外部目标由它的真实 Clone 决定。

Stats 的七个量为 elapsed、searches、searches_with_match、bytes_searched、bytes_printed、matched_lines、matches。new/default 为零，add_* 和 Add/AddAssign 按相应分量相加，不改成去重、平均或饱和。序列化沿 JSON-OUTPUT。

Standard 在二进制消息成功输出后采样 finish 统计；Summary 在输出 count/path 摘要之前采样 bytes_printed，通常不包含本次 finish 的摘要。摘要随后失败不撤销已修改统计；匹配/行数可能在之前错误前已增加，searches 只在相应 finish 路径增加。统计不是全部成功操作的事务集合。

## CLI 使用与开放库

CLI 每个输入新建 sink_with_path，搜索成功后才读取 has_match/stats；库合法的同 Sink 累计不自动成为 CLI 每文件行为。quiet 选择 SummaryQuiet，quiet+JSON 仍由 Summary 承担安静搜索与相交统计，JSON summary 的命令输出另沿既有合同。反选 CountMatches→Count、only_matching 的 Count→CountMatches 是 CLI 归一化，不限制直接库输入。

CLI 给 Standard 设置 per_match_one_line=true，但只在 vimgrep 开 per_match；库默认不同。CLI 色彩从默认有色规格追加用户差异，库 Builder 默认无样式。单线程文件分隔由 Standard 承担，并行由共享 BufferWriter 承担。并行先写 worker Buffer，搜索成功后才交付 stdout；缓冲内已计字节不证明 stdout 已接纳，搜索错误可留下未打印的 Buffer。命令级 BrokenPipe、继续及最终人类统计均沿 COMMAND，不从 printer 成功签发。

## 公开面与来源

| 公开族 | 固定 P 定位及覆盖 |
| --- | --- |
| StandardBuilder、Standard、StandardSink | `crates/printer/src/standard.rs:59–865` 的构造、全部设置、目标访问/返还、sink 及查询；输出分支 `928–1735` |
| SummaryBuilder、Summary、SummarySink、六种 SummaryKind | `summary.rs:41–787`；无公开 match_count getter，不补造接口 |
| PathPrinterBuilder、PathPrinter | `path.rs:20–174`；构造、颜色/链接/分隔/终止与 write，无 Standard 式 get_mut/into_inner |
| ColorSpecs、UserColorSpec、ColorError | `color.rs:3–395`；构造、五部位查询、解析/转换、错误与公开派生 |
| HyperlinkConfig/Format/Environment/Alias/FormatError | `hyperlink/mod.rs:24–504,535–947`；公开构造、解析/Display、环境设置和别名查询；私有 getter 不升为 API |
| Stats、计数包装与复用 | `stats.rs:8–171`；`counter.rs:20–95`；Serde 条件保留 |
| 路径、上下文、裁剪、捕获与替换 | `util.rs:18–224,295–363,452–587` |
| CLI 接合 | `crates/core/search.rs:378–448`；`flags/hiargs.rs:125–136,557–665,1260–1267`；`main.rs:124–226,433–481` |

源码已静态核对，没有执行短写、颜色、sink 复用、平台路径或统计反例。termcolor、bstr 字素切分、系统路径及 BufferWriter 的完整内部实现仍按真实外部能力导入；完整 Rust 签名机器源、固定解释、目标和全工程等价均未由本源取得。
