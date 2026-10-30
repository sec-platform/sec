# 帮助、man 与补全的同源合同

本设计源拥有固定 P 的公开文字、分类、提示及其生成关系，供 [COMMAND](COMMAND.md) 的 HelpShort、HelpLong 与 Generate 使用。参数识别、取值域和产品行为仍由 [CLI-OPTIONS](CLI-OPTIONS.md) 拥有。帮助文字是需要保留的产品输出；其中的简述不能改变实际参数合同，例如补全候选不限制合法值，颜色帮助的简述不取消已接受的第三段。

作者维护公开词表、独有文字和原格式模板；系统承担分组、引用解析、展开与排版，不要求作者维护 104 个 Flag 对象或 Rust 生成函数。此处给出可落实的输入与生成合同；数据进入 Project 的 design/asset 范围，不因此取得 semantic 模块身份或生产解释资格。完整命令根、方法绑定、Target 与发行装配仍待接合。

## 唯一数据来源与类型

[flag-vocabulary.json](flag-vocabulary.json) 保持 FLAGS 顺序。识别字段归 CLI-OPTIONS；新增显示字段的含义如下。

| 字段 | 类型、缺省及消费者 |
| --- | --- |
| category | 必填，且仅取 input、search、filter、output、output-modes、logging、other-behaviors。短/长帮助和 man 在该分类内保持词表顺序；分类位置由原模板决定。 |
| summary | 必填 UTF-8 文字，不从长说明推导；短帮助、Fish 和 PowerShell 消费。 |
| documentation | 必填，以词表所在目录为基准的资产路径；对应唯一长说明，供长帮助和 man 使用。普通 .roff 内容直接读取，hyperlink-format.roff.in 按下文展开别名。 |
| choices | 可选有序文字列表；缺省为空。它是 Bash/Fish 的提示候选，不是取值域。 |
| choicesFrom | 可选路径，以词表所在目录为基准；当前只用于超链接别名表。它与 choices 互斥，其提示值为该表按显示优先级稳定排序后的 name。不是任意数据源执行入口。 |
| completion | 可选，取 filename、executable、filetype、encoding；缺省为 Other。只参与本合同规定的 Fish 生成，不给 Bash/PowerShell 增加未有的行为。 |

路径必须在本工程声明的源范围内解析；正文及模板按 UTF-8 读取，禁止依赖机器 locale、当前目录或联网内容。缺文件、错误字段、重复拼写、无效引用是源输入错误；不能生成部分帮助并当成功。原始 LF、空格和模板内部空行保留，只在下述明确位置裁剪。这里的 trim/trim_start/trim_end 采用固定 P 工具链的 Rust str Unicode White_Space 语义，不是任意宿主的 strip 或排版器。

[hyperlink-aliases.json](../library/hyperlink-aliases.json) 唯一维护 11 个公开别名。记录顺序为名称字典序；name、description 是文字，format 是文字或 default 专有的 windows/nonWindows 两个文字分支，displayPriority 为可空 i16。平台分支取目标平台，不取编辑机器平台；null 的显示优先级为 i16::MAX，按优先级稳定排序时保留原同级顺序。该排序供帮助及提示候选，Zsh 的描述列表仍使用原记录顺序。优先级是此版本数据，不承诺未来版本数值不变。

别名表同时是 printer 的名字到格式含义的来源；空格式 none 表示禁用，default 依平台解析。完整格式文法、环境选择、路径转义与 printer 接合仍由其公开合同承担，本表不代签它们已闭合。帮助模板中的唯一 `!!HYPERLINK_ALIASES!!` 替换为按显示优先级排列的 `\fBname\fP`，项间 `, `、末尾 `.`；前后文字保留。Bash/Fish 同样从该表取得候选，不另抄一份别名清单。

## 共同引用与版本输入

长说明支持上游已有的两种标记：`\flag{name}` 与 `\flag-negate{name}`。从左到右寻找该标记的开头与其后的第一个 `}`；先处理 flag，再处理 flag-negate。name 必须为可精确识别的长拼写（主名、长别名或否定名），解析回同一逻辑旗标。后者还必须确有 negated。缺闭括号、未知名或不存在的否定均是源错误，不能留给每次构建由 AI 猜测；短拼写不在此引用域内。

普通帮助引用展开为可选的 `-short/` 加 `--主长名`；否定引用展开为 `--否定名`。man 的普通引用外围为 `\fB...\fP`，短名的减号、长名前的两个减号及主长名内部减号均写为 `\-`；否定引用为 `\fB\-\-否定名\fP`，保持 P 对否定名内部减号的原处理。显示主名不改变参数错误中必须保留的实际输入拼写。

三个文档模板中的 `!!VERSION!!` 来自同次构建元数据：CARGO_PKG_VERSION 存在时取其值，否则为 N/A；RIPGREP_BUILD_GIT_HASH 存在时追加 ` (rev 值)`，否则不追加。先替换版本，再按上述分类顺序替换对应 `!!category!!`。版本不能写死成当前核验二进制的值。长版本的 CPU/PCRE2 说明不是这三个模板的派生物，继续保留其独立公开合同及未闭合项。

## 短帮助与长帮助

短帮助使用 [short.help](../assets/cli/templates/short.help)。每项左栏为可选 `-short, `、`--主名`、有 value 时的 `=占位名`；占位名依次将 SEPARATOR 换为 SEP、REPLACEMENT 换为 TEXT、NUM+SUFFIX? 换为 NUM。右栏为 summary。全部 104 项左栏的最大 UTF-8 字节长度为共同宽度，不能按分类或终端显示宽度各算一次。每行两个前导空格，两栏之间补至共同宽度再加两个空格；分类内以 LF 连接，不额外添加分类末尾 LF。别名和否定名不新增短帮助行。

长帮助使用 [long.help](../assets/cli/templates/long.help)。每项标题以四个空格开始，依次为可选的 `-short`、有 value 时的 ` 占位名`、`, `，再是 `--主名`、有 value 时的 `=占位名`、LF。这里使用原占位名，不作短帮助缩写。正文先 trim、展开共同引用，再按下列固定 roff 子集转为文字：

- 每行以点开始时：`.IP ` 取按单个 ASCII 空格分割的第二段，将 `\(bu` 转为 •、去掉 `\fB`、将 `\fP` 转为冒号；`.IB ` 或 `.BI ` 按空白分词并直接连接命令之后各段；以 `.sp`、`.PP`、`.TP` 开头的行产生段间空行；其他点命令忽略。
- 非命令行若整体由 `\fB...\fP` 包围，去掉这对标记并追加冒号；其他行保留。相邻段间空行合并；去掉剩余 `\fB`、`\fI`、`\fP`，将 `\-` 转为减号、双反斜线转为单反斜线。原说明的内部空行违反 P 的这项输入约束，应在源核验中拒绝，不能借用其他 roff 解释器改变输出。
- 仅当旗标无 value 且有 negated 时，追加独立段落 `This flag can be disabled with --否定名.`。有 value 的否定语义由原正文说明，不自动追加此句。
- 按双 LF 分段。每行都以四空格开始的段落保持行界；其他段先将 LF 换为空格，按 P 的 textwrap 0.16.2、宽度 71、WordSplitter::NoHyphenation 及其其余有效默认项重新排版。各段每行增加八空格缩进，去掉该段尾空白；段间两个 LF，分类内各旗标之间两个 LF。

相同宽度的其他排版器并不自动等价。生成方法必须取得上述依赖/选项的资格或证明替换保持实际输出；当前数据迁移没有实现生产排版器。

## man 输出

[rg.1](../assets/cli/templates/rg.1) 是原 roff 模板，不再转写成 JSON。每个分类内保持旗标顺序，后续旗标前插入 `.sp\n`。每项标题依次为可选 `\fB\-short\fP`、有 value 时的 ` \fI占位名\fP`、`, `，然后 `\fB\-\-主长名\fP`（主名内部减号转义），有 value 时追加 `=\fI占位名\fP`，再写 LF、`.RS 4\n`。

长说明 trim 后按共同引用的 man 规则展开，追加 LF。无 value 且有 negated 的项再追加 `.sp\n` 和 `This flag can be disabled with \fB\-\-否定名\fP.\n`，最后为 `.RE\n`。这里不进行长帮助的去 roff 或文字折行。分类及版本替换使用共同规则。

## 四种补全输出

补全脚本保持原生 shell 语言；它们是交付给外部 shell 的产品资产，不是要求 Gift 应用作者用 Rust 实现生成器。生成只替换下列既定位置，不执行脚本。名字、描述及其转义按当前词表域处理，扩大该域须重新核各 shell 的引用规则。

| 输出 | 唯一资产与确定生成关系 |
| --- | --- |
| Bash | bash.sh.in 的 !OPTS! 按词表逐项连接主名、短名、否定名，各带对应减号和一个尾空格，末尾加 `<PATTERN> <PATH>...`；不包含 aliases。每项 choices 非空时使用 bash-choice-case.sh.in，否则使用 bash-file-case.sh.in，先 trim_end，再替换 !CHOICES! 为单空格连接的候选、!FLAG! 为相应拼写。按主名、短名、否定名顺序连接全部 case，替换 !OPTS! 后替换 !CASES!，结果 trim_start。P 在此不区分开关或 completion 提示，不能自行改成 Fish 行为。 |
| Fish | 原 prelude.fish 后追加一个 LF；每项用 fish-flag.fish.in，!SHORT! 为 `-s x` 或空，!LONG! 为主名，!DOC! 为 summary 中单引号前加反斜线后的文字。再按下一表附加参数并加 LF。存在否定时使用 fish-negated.fish.in，!LONG! 主名、!NEGATED! 否定名、!SHORT! 为不带减号的短字符或空，!DOC! 同前；该模板已有 LF，不再另加。aliases 不另生成。 |
| PowerShell | powershell-flag.ps1.in 按词表中每项的主名、短名、否定名顺序生成；!DASH_NAME! 含减号，!NAME! 无减号，!DOC! 中每个单引号加倍。每条前六个空格，条间 LF；powershell.ps1.in 先 trim_start，再替换 !FLAGS!。该输出不消费 choices/completion，也不另列 aliases。 |
| Zsh | 保留原手工维护的 rg.zsh，包括相交选项约束；先以 encodings.sh 的 trim_end 内容替换 !ENCODINGS!，再以别名表原顺序的 `    name:"description"`（条间 LF）替换 !HYPERLINK_ALIASES!。不将整段脚本改造成新规则语言，不根据三个其他 shell 的输出推导它。 |

| Fish 提示条件（按顺序适用） | 附加原文 |
| --- | --- |
| filename | ` -r -F` |
| executable | ` -r -f -a '(__fish_complete_command)'` |
| filetype | ` -r -f -a '(rg --type-list \| string replace : \t)'`，其中 `\t` 保持反斜线及 t 两个字符；运行时查询实际 rg 的类型列表，不烘焙默认类型表。 |
| encoding | ` -r -f -a '` 加 encodings.sh 原文再加单引号，不 trim 其中内容。 |
| Other 且 choices 非空 | ` -r -f -a '` 加单空格连接的候选再加单引号。 |
| Other 且有 value | ` -r -f` |
| 其余开关 | 不追加。 |

encodings.sh 在这里是编码标签文本数据，不因扩展名而执行。Zsh 是独立维护的产品资产，变更词表后须核其相交选项语义，不能仅凭其他三个生成器重跑便宣称它已更新。

## 消费、失败与再次修改

调用仍由 [参数来源](ARGUMENT-SOURCES.md) 和 COMMAND 选择：短/长帮助只有相应 Special 分支取得资格后消费本关系；Generate 仍经过其相交准备，不能因内容是静态数据而绕过输入错误和作用。成功取得相应文字后，公共写出行为为 trim_end 并追加一个 LF，写调用失败沿命令原错误关系传播；已写出的前缀不回滚。内存耗尽、panic、进程终止或未完成不冒充 Generation/HelpOrVersion 成功。

选中词表项的 summary 改动影响短帮助、Fish、PowerShell；documentation 改动影响长帮助和 man；分类、主名、短名、value 和 negated 影响各自实际消费者。超链接别名的名字/格式/说明/优先级变化分别传到 printer、相应长说明/提示及 Zsh 描述；不能只修改帮助中的一份列表。手工 Zsh 的变化直接回其原格式资产。普通构建从这些固定输入派生输出，不回写词表或原模板；生成文件被编辑时须按工程既有回源合同定位，无法唯一逆向的修改保持待决。

来源为 P 的 crates/core/flags/{defs.rs,mod.rs,parse.rs,doc/*,complete/*}、crates/core/main.rs 和 crates/printer/src/hyperlink/aliases.rs。本设计保留它们的公共数据与输出关系，不要求保留其私有函数划分、字符串缓冲或对象存储方式。资产保全、同源关系设计、生成字节核验、真实 shell 行为、Gift 方法资格和全工程等价是不同结论；生产 Reader/生成器、各 shell 实际运行、完整版本输出、printer 格式/作用及最终发行装配尚未由此完成。
