# 命令选项与有效产品决定

本设计源拥有固定 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的全部 104 个逻辑旗标、取值与组合决定；Q 的本部分没有源码差异。它供[同次命令合同](COMMAND.md)与[参数来源](ARGUMENT-SOURCES.md)共同使用。作者决定公开选项及其产品含义，系统承担识别、索引、存储、更新组织和目标实现。这里不复制 `Flag` trait、104 个实现对象、`LowArgs` 私有结构、HashMap 或 OnceLock。

词表是普通数据，本页拥有其产品含义、有型关系的签名及正常结果的解释。104 项各自连接到下表的同次产品投影；参数来源在这些关系上选择真正生效的一次完整解析。这里仍是设计源：签名中的原生类型与专业定义尚未全部落实为准确 DefinitionRef，固定方法入口、目标消费及生产执行也未取得，不能称为可构建 CLI 或全工程等价。已退役阶段草稿的 `Rest` 不再是待补类型。

## 公开词表和参数识别

[flag-vocabulary.json](flag-vocabulary.json) 是本产品拼写的唯一活动数据源，按 P 的 `FLAGS` 顺序列出 104 项。每项 `name` 是不带 `--` 的主长名称；可选 `short` 是不带 `-` 的单个 ASCII 字符；`aliases` 是长别名的有序列表；`negated` 是取否定值的长拼写。可选 `value` 是参数占位名称，存在时主名称、短名称和别名恰取一个原生 OS 参数，不存在时为开关。`negated` 始终不取值，包括 encoding、pre、context-separator 的否定拼写。未列出的短名、别名和否定拼写不存在，不能按 `no-` 前缀猜造；所有长拼写唯一，所有短拼写唯一。词表顺序还参与错误建议及分类内帮助顺序，不能为展示排序改写它。

词表不包含回调、执行体、目标字段或私有 Rust 名称。`value` 不声明取值域；取值域和行为由下表决定。[帮助与补全合同](CLI-DOCUMENTATION.md)拥有 category、summary、documentation、choices/choicesFrom 和 completion 的类型及确定消费者；这些字段共享原旗标身份，不再复制一份拼写表。帮助正文和补全候选不能反向定义合法值。

输入为同次有序原生 OS 参数，不含 argv[0]。固定 P 使用 lexopt 0.3.2 的单值规则：

- 长值可写成 `--name=value` 或 `--name value`，短值可写成 `-eVALUE`、`-e=VALUE` 或 `-e VALUE`；只剥去第一个连接用等号，等号后为空也是实际空值。短开关可连写；一旦遇到取值短项，其余部分成为该项的值，如 `-qefoo` 为 quiet 加模式 foo，`-eq` 为模式 q。
- 需要值时下一个参数即是值，即使它为 `-q` 或 `--`。独立读取到 `--` 才结束选项识别，其后全是位置参数；位置参数本身不结束识别。独立 `-` 是位置参数。独立值和位置参数保持原生表示；Unix/Windows 的附着值也保留原生字节/宽字符。其他平台在非法原生串以 `-` 开头时，先将整个参数有损转为 Text 再切分，附着值也可能变化；不能把原生保全推广到该分支。所得值按各取值域验证。
- 名称按完整拼写精确识别，不允许长名前缀缩写。Unix/Windows 的非法原生编码若出现在选项名称，lexopt 按其固定平台规则转为含 U+FFFD 的名称，随后成为未识别旗标；同一字节/宽字符序列作为路径值可以合法。不能在入口先将全部 argv 有损转换成 Text。其他平台须保持该固定依赖的实际分支，不能从 Unix 外推。
- 首个错误结束本次解析。词法错误增加 `invalid CLI arguments` 上下文，缺值增加 `missing value for flag {实际拼写}`，值转换/选项决定失败增加 `error parsing flag {实际拼写}`。短未知名为 `unrecognized flag -{名称}`；长未知名为 `unrecognized flag --{名称}`，可能追加建议。保留原错误链和发生位置；不把已处理前缀当成功参数交付，也不靠忽略失败继续解析。
- 帮助/版本选择仍要求全部参数解析成功。`--help=x` 先识别 help，下一次词法读取因剩余值失败；`--help --unknown` 也失败。`-h/-V` 与长拼写分别选择短版/长版输出，`--pcre2-version` 选择 PCRE2 信息；这些请求互相后者覆盖。配置中的这些选项不因此得到第二次 Special 短路，仍服从参数来源合同。

未知长名的建议使用名称 UTF-8 **字节**的 3-gram 集合，长度不足 3 时补 `!` 到 3；集合交集大小与并集大小之比至少为 0.4 的名称入选。按词表项顺序、项内主名称→否定名称→别名顺序列出，不按相似分数排序，也不建议短名；非空时追加两个换行和 `similar flags that are available: `，名称带 `--` 并以 `, ` 连接。这里保留可见建议关系，不要求作者选择 BTreeSet 或遍历算法。

## 值的准确域

下表中的 Text 表示原生参数可无损转换为 Unicode 文本，否则为 `value is not valid UTF-8` 错误；Path 表示由原生 OS 参数形成的路径值，不预先要求存在、非空或 UTF-8。这两类不能统一。

| 域 | 接受、拒绝及边界 |
| --- | --- |
| `U64` / `Usize` | Text 经目标 Rust 无符号十进制整数转换；前导 `+` 和前导零可接受，负号、空白、空串、非数字和越界拒绝。U64 上界为 2^64−1，Usize 上界由目标指针宽度决定；失败加 `value is not a valid number`。实际标准库错误文本还须绑定工具链。 |
| `Size64` / `Size` | 非空 ASCII 数字串加可选单个大写 K/M/G，分别乘 2^10/2^20/2^30；不接受 `+`、小写、空白或其他单位。先转换数字再检查后缀及乘法溢出，保留此错误优先。Size 还要求可表示为 Usize；超限为 `size is too big`。这复用 grep-cli 的大小合同，不能与普通整数域混用。 |
| `EscapedBytes` | Text 按 bstr 1.13.0 的 `Vec::unescape_bytes` 合同得到字节；未知/不完整转义按该定义保留，不引入 shell、JSON 或 Unicode 转义的另一套解释。三个内容分隔符在原生参数不能转为文本时使用专门的 separator UTF-8 诊断。 |
| 枚举 Text | 下面列出的精确小写拼写；不自动裁空白或忽略大小写。未知值拒绝，保留相应 choice/engine 诊断。 |
| Encoding | `auto` 为 BOM 自动识别，`none` 为禁用；其他 Text 由 grep-searcher `Encoding::new` 的 encoding_rs label 合同解释，错误在低层解析发生。BOM 可覆盖显式编码。 |
| ColorSpec / HyperlinkFormat | 由 grep-printer 的真实公开格式解释，不能用字符串标签或任意 JSON 替代。ColorSpec 的具体区别和超链接的剩余接合见下文。 |

## 有型关系及解释域

这里的类型与投影是产品合同的语义签名，不是新增 JSON 字段、运行记录、更新指令或公开 rg ABI。一个投影表示该次命令必须遵守的决定；实现可以直接使用、融合或消除其存储。下表、默认表和 104 项表共同拥有这些定义，不另存一份“解释摘要”。普通构建必须取得它们的固定解释供给，不能按这些文字临时生成含义。

| 类型 | 准确值域及来源 |
| --- | --- |
| `Text`、`Bytes`、`Byte`、`Path` | 分别为无损 Unicode 文本、有限字节序列、0–255 的单字节和目标平台原生路径值。Path 的原生来源及借用资格见[参数来源](ARGUMENT-SOURCES.md#真实类型与发生点)；不从显示文本还原路径。 |
| `U64`、`Usize`、`PositiveU64`、`PositiveUsize` | 前两者为上文整数值域；后两者是排除 0 的子域。目标指针宽度是 Usize 的类型前提，不能用宿主宽度代签。`Size64/Size/EscapedBytes` 是输入接纳合同，结果分别进入 U64/Usize/Bytes，不作为另一种单位或任意字符串。 |
| `Option<T>`、`Seq<T>` | 分别为 None 或 Some(T)，以及保留次序和重数的有限值序列。None、Some(0)、Some(false)、Some(空序列) 各异；这些数学类型不指定容器、分配或可复制资源资格。 |
| `CommandMode` | Search 的载荷使用 [SearchMode](search-result.module.json) 的六个公开构造；其他情况为 Files、Types 或 Generate(man、complete-bash、complete-zsh、complete-fish、complete-powershell 之一)。这是低层成功决定；高层计数归一另见下文，不用同一名称掩盖两个时点。SearchMode 是本产品的名义类型，不假装是原生 Rust 私有 Mode 的类型别名。 |
| `Information` | HelpShort、HelpLong、VersionShort、VersionLong、VersionPCRE2。None 表示没有信息请求；不代表将来不会发生错误。 |
| `PatternSource`、`TypeRequest` | PatternSource 为 Pattern(Text) 或 File(Path)；TypeRequest 为 Select(Text)、Negate(Text)、Add(Text)、Clear(Text)。它们表示产品请求，不提前宣称模式、文件或类型定义已经有效。 |
| `CasePolicy`、`Boundary`、`Engine` | 分别为 Sensitive/Insensitive/Smart，None/Line/Word，Default/PCRE2/Auto。None 边界是该闭合域中的值，与 Option 的 None 由类型区分。 |
| `BinaryPolicy`、`MmapPolicy`、`BufferPolicy` | 分别为 Auto/SearchAndSuppress/AsText，Auto/AlwaysTryMmap/Never，Auto/Line/Block；三个 Auto 分属不同类型，不可交换。 |
| `IgnoreSource` | Dot、Exclude、Global、Parent、Vcs、Explicit 六种来源；`ignoreAllowed` 对每种来源给 Bool。它保存各来源请求；global/exclude 的最终可用关系还与 Vcs 合取，见消费边界。 |
| `SortOrder`、`ContextExtent` | SortOrder 为 Asc/Desc 方向与 Path/Modified/Accessed/Created 键的乘积；ContextExtent 为 All 或 Finite(before: Usize, after: Usize)。不保留作者可写的 both 私有状态。 |
| `ColorPolicy`、`LogLevel` | 分别为 Never/Auto/Always/Ansi，Warn/Debug/Trace。日志取最后请求，不取等级最大值。 |
| `Encoding`、`ColorSpec`、`HyperlinkFormat` | 使用上文所指 grep-searcher/grep-printer 的专业值域与解释，Encoding 包含 Auto/禁用/已识别编码的准确区别；不能把库定义改成无约束 Text。完整公开定义的作者接合仍开放。 |

令 `r` 表示[参数来源合同](ARGUMENT-SOURCES.md)中一次实际解析的发生，`A(r) : Seq<OsString>` 是该次准确输入。词表键确定 `FlagId`，不另造 104 个实现类型。一次旗标出现具有本次来源位置、真实拼写和按该项接纳域取得的载荷；开关载荷为正/否定选择，`help/version` 另外保留短/长拼写区别。有否定名称的取值项在否定出现时没有值载荷，不能伪造空 Path/Text 代替。位置参数是另一种出现，保持原生值及次序；它们形成 `positional : Seq<OsString>`，不是第 105 个旗标，也不将被选项消费的值再次纳入位置参数。

`Accepted(r, A, E)` 表示词法与值接纳全部成功，E 是这次旗标及位置参数有序出现的逻辑视图；`Decides(r, E, q)` 表示它们共同确定 positional 及下表全部有型投影 q。E/q 都不是要求生成的中间对象，也不是允许调用方填写的结果。其定义必须满足：

- 一个完整正常输入只有一份对应的接纳视图和产品投影值，前提是原生/专业解释及目标参数已经固定；不能各旗标选不同解析、不同输入或不同环境使局部关系分别成立。
- 对投影 p，令 `W(p)` 是逐项合同所规定的全部 `(出现位置, p 的有型值)`。普通覆盖的 p 等于其中最后位置的值；W(p) 为空才取默认值。一个出现可同时对多个投影贡献值，如 pretty；不会产生一个必须由后端执行的“赋值操作”。不同投影的相同文字值因类型不同不互换。
- 序列投影等于属于该产品序列的所有贡献按出现顺序形成的序列。patterns/typeRequests 各自共用次序；globs/iglobs 是不同序列；重复项保留。出现位置只是该输入中的次序，不承担源码稳定身份或跨次运行身份。
- 下列条件复位、出现序号及上下文关系使用其专门定义，不套普通覆盖。所有分支仍在相同 E 上解释，不引入隐藏的更新程序或任意回调。
- 接纳失败只允许在实际词法/取值次序中已到达的首错处退出；失败前缀没有完整 q。正常关系不能取消先前错误，也不能要求首错后继续读取、转换或运行剩余输入。Fault/终止/未完成仍保留原出口。

### 非普通覆盖关系

`--no-json` 不贡献一个无条件的 mode。取最后一个正向模式选择（没有则 Standard）；只有这个选择为 JSON，且其后存在 no-json 时，结果改为 Standard。其他情况下保留这个选择。这样直接定义最终模式，不需要条件更新函数，也保留 Files/Types 被后来的 Search 覆盖。

`unrestricted` 的第 k 个出现仅贡献本表规定的第 k 级决定：k=1 对 Dot/Exclude/Global/Parent/Vcs 各贡献 false，k=2 对 hidden 贡献 true，k=3 对 binary 贡献 SearchAndSuppress。位置仍是该项实际位置；k=4 是接纳失败。Explicit 不在第一级中，计数不是对作者暴露的产品状态，更不能按最后 k 重放已经被后续其他项覆盖的决定。

pre/searchZip、multiline/stopOnNonmatch、crlf/nulData 使用同一出现对多个投影的贡献。非空 pre 对 pre 贡献 Some(path) 并对 searchZip 贡献 false，空/否定 pre 只对 pre 贡献 None；正 search-zip 对 searchZip 贡献 true 并对 pre 贡献 None，否定只对 searchZip 贡献 false。multiline 正项另对 stopOnNonmatch 贡献 false，stop-on-nonmatch 另对 multiline 贡献 false；crlf 正项另对 nulData 贡献 false，null-data 另对 crlf 贡献 false。各投影按各自最后贡献决定。因此不得同时得到非空 pre 与启用 zip、跨行与 stop、CRLF 与 NUL-data；负项不恢复以前被清除的值。

context 的解释直接取有限范围：若最后一个 A/B/C/passthru 出现为 passthru，结果为 All；否则只取最后 passthru 之后的 A/B/C（没有 passthru 就从开始），before 取最后 B，缺 B 才取最后 C，再缺才为 0；after 对 A 同理。该结果为 Finite，不要求保存或还原前三个字段的私有状态。

各表中的“未指定/清除”必须产生相应 None 或闭合域值：threads=0 与 max-columns=0 为 None，max-count=0 为 Some(0)；encoding 的否定是 Auto，mmap 的否定是 Never；空 context-separator 是 Some(空 Bytes)，否定才是 None。该区别在接纳与决定之间固定，不能由后端任选。

## 默认决定

每一次完整解析均从相同默认语义开始，包括配置与 argv 合并后的重解析。以下是产品有效决定的分组，不要求生成同形记录。

| 产品责任 | 默认含义 |
| --- | --- |
| 模式与来源 | Search(Standard)，无 Special；位置参数和模式来源为空，`-e/-f` 尚未出现。 |
| 匹配 | 大小写敏感、默认引擎、Unicode 开启、非固定字符串、无行/词边界要求、不反选、不跨行、不 dotall、未要求首个非匹配后停止。 |
| 输入 | 二进制 Auto，编码 Auto；无 pre、无压缩搜索；follow、hidden、one-file-system 关闭。 |
| 路径与类型 | glob、iglob、显式 ignore-file、pre-glob、类型变化均为空；默认 ignore 来源及 require-git 开启。类型变化为空仍继承[默认类型数据](../library/DEFAULT-FILE-TYPES.md)，不是无类型定义。 |
| 输出 | 不 quiet、不仅匹配、不 vimgrep、不 trim、不输出字节偏移、不 include-zero、不 NUL 路径终止；无替换。颜色和缓冲 Auto，mmap Auto；附加颜色规格为空仍继承 printer 默认颜色。 |
| 上下文及行终止 | 有限前后上下文均为 0；上下文分隔符 `--`、上下文字段分隔符 `-`、匹配字段分隔符 `:`；LF 行终止，非 CRLF、非 NUL-data。 |
| 延后决定 | column、heading、line-number、with-filename 未指定；线程、排序、大小/次数/深度/列数/引擎容量上限未指定。未指定不是 false、0 或无条件无限，由相应真实消费者决定。 |
| 配置与诊断 | 允许配置，普通/ignore 消息均允许，日志 Warn；统计未请求，超链接格式为空，hostname-bin 未指定；unrestricted 的出现次数为 0。 |

## 全部旗标的产品决定

本节拥有公开 CLI 的接受域和行为区别。q、贡献及覆盖关系用于准确说明和核对这些区别，不要求顶层产品作者维护同形结果记录、选择归约算子或手写接纳实现。104 项拼写、默认和独特交互是本产品的兼容事实；选中其完整合同后应共同继承，普通使用者只改有权改变的产品差异。此前单独编写的关系数据表未获顶层作者面采用，已移出活动 Project；本页的独立接纳、错误和消费者义务保留。

本表按产品责任分组，主名只作为词表键，第二列把每一项接到上述关系中的有型投影。对有否定拼写的普通布尔决定，正项贡献 true、否定贡献 false；以 no- 命名的禁用项按该项正文取反。无否定项只贡献其规定值；Option 布尔的显式开/关分别是 Some(true)/Some(false)。除序列、上下文、累计和明确列出的条件复位外，各投影按最后贡献决定；没有提及的投影不取得贡献。下文保留“设置/追加”作为产品行为的简写，不规定 Vec、更新方法或执行顺序。

| 主名 | 有型产品投影 | 接受域和有效决定 |
| --- | --- | --- |
| `regexp` | `patterns : Seq<PatternSource>` | Text；向共同有序模式来源追加一个显式模式，空字符串也是模式。 |
| `file` | `patterns : Seq<PatternSource>` | Path；向同一模式来源序列追加模式文件请求，裸 `-` 表示实际 stdin，读取在 Search 准备时发生。 |
| `files` | `mode : CommandMode` | 选择 Files。 |
| `files-with-matches` | `mode : CommandMode` | 选择 Search(FilesWithMatches)。 |
| `files-without-match` | `mode : CommandMode` | 选择 Search(FilesWithoutMatch)。 |
| `count` | `mode : CommandMode` | 选择 Search(Count)。 |
| `count-matches` | `mode : CommandMode` | 选择 Search(CountMatches)。 |
| `json` | `mode : CommandMode` | 正项选择 Search(JSON)；否定仅在当前为 Search(JSON) 时恢复 Standard，否则保持模式。 |
| `type-list` | `mode : CommandMode` | 选择 Types。 |
| `generate` | `mode : CommandMode` | man、complete-bash、complete-zsh、complete-fish、complete-powershell；选择相应 Generate 模式。 |
| `help` | `information : Option<Information>` | 短/长拼写分别选择 HelpShort/HelpLong，完整成功解析后才按参数来源处理。 |
| `version` | `information : Option<Information>` | 短/长拼写分别选择 VersionShort/VersionLong。 |
| `pcre2-version` | `information : Option<Information>` | 选择 VersionPCRE2；不在参数解析时探测是否编译 PCRE2。 |
| `case-sensitive` | `case : CasePolicy` | 大小写策略 Sensitive。 |
| `ignore-case` | `case : CasePolicy` | 大小写策略 Insensitive。 |
| `smart-case` | `case : CasePolicy` | 大小写策略 Smart；具体模式判定归 matcher 合同，不是对原参数做简单大小写比较。 |
| `fixed-strings` | `fixed : Bool` | 固定字符串匹配开关。 |
| `line-regexp` | `boundary : Boundary` | 边界要求为整行，覆盖 Word。 |
| `word-regexp` | `boundary : Boundary` | 边界要求为 Word，覆盖 Line。 |
| `engine` | `engine : Engine` | default、pcre2、auto；设置引擎策略。 |
| `pcre2` | `engine : Engine` | 正项选择 PCRE2，否定恢复 Default。 |
| `auto-hybrid-regex` | `engine : Engine` | 正项选择 Auto，否定恢复 Default；保留弃用拼写的实际含义。 |
| `no-unicode` | `unicode : Bool` | 正项禁用 Unicode，否定启用。 |
| `no-pcre2-unicode` | `unicode : Bool` | 与 no-unicode 写同一决定，实际不局限于 PCRE2；保留弃用拼写。 |
| `invert-match` | `invert : Bool` | 匹配反选开关。 |
| `multiline` | `multiline, stopOnNonmatch : Bool` | 跨行开关；开启时取消 stop-on-nonmatch，关闭时不恢复它。 |
| `multiline-dotall` | `dotall : Bool` | dotall 开关；本身不启用 multiline。 |
| `stop-on-nonmatch` | `multiline, stopOnNonmatch : Bool` | 开启首个非匹配后停止，并关闭 multiline。 |
| `encoding` | `encoding : Encoding` | Encoding；否定恢复 Auto，不能等同 `encoding none`。 |
| `binary` | `binary : BinaryPolicy` | 正项为 SearchAndSuppress，否定恢复 Auto。 |
| `text` | `binary : BinaryPolicy` | 正项为 AsText，否定恢复 Auto；与 binary 写同一二进制策略。 |
| `crlf` | `crlf, nulData : Bool` | CRLF 开关；开启时关闭 NUL-data，关闭时不恢复 NUL-data。 |
| `null-data` | `crlf, nulData : Bool` | 开启 NUL-data 并关闭 CRLF，无否定拼写。 |
| `dfa-size-limit` | `dfaLimit : Option<Usize>` | Size；设置 DFA 缓存容量限制，0 是显式值。 |
| `regex-size-limit` | `regexLimit : Option<Usize>` | Size；设置正则编译容量限制，0 是显式值。 |
| `max-count` | `maxCount : Option<U64>` | U64；设置每输入的最大匹配计数，0 是显式值。 |
| `glob` | `globs : Seq<Text>` | Text；向普通 glob 组追加，语法检查在高层准备。 |
| `iglob` | `iglobs : Seq<Text>` | Text；向大小写不敏感 glob 组追加，语法检查在高层准备。 |
| `glob-case-insensitive` | `globInsensitive : Bool` | 普通 glob 组的大小写不敏感开关；不依赖开关在组内 glob 前后的位置。 |
| `ignore-file` | `ignoreFiles : Seq<Path>` | Path；追加显式 ignore 文件；不在参数解析时读取。 |
| `ignore-file-case-insensitive` | `discoveredIgnoreInsensitive : Bool` | 自动发现 ignore 文件的大小写不敏感开关；固定 P 的显式 ignore-file 不受其控制，见消费边界。 |
| `no-ignore` | `ignoreAllowed(Dot/Exclude/Global/Parent/Vcs) : Bool`（各项） | 正项同时禁用 dot、exclude、global、parent、vcs 五类，否定同时恢复；不修改显式 ignore-file、hidden 或消息。 |
| `no-ignore-dot` | `ignoreAllowed(Dot) : Bool` | 禁用/恢复 `.ignore` 与 `.rgignore` 来源。 |
| `no-ignore-exclude` | `ignoreAllowed(Exclude) : Bool` | 禁用/恢复 git exclude；仍受 no-ignore-vcs 限制。 |
| `no-ignore-files` | `ignoreAllowed(Explicit) : Bool` | 禁用/恢复显式 ignore-file 消费，不删去此前取得的路径序列。 |
| `no-ignore-global` | `ignoreAllowed(Global) : Bool` | 禁用/恢复全局 git ignore；仍受 no-ignore-vcs 限制。 |
| `no-ignore-parent` | `ignoreAllowed(Parent) : Bool` | 禁用/恢复父目录 ignore 来源。 |
| `no-ignore-vcs` | `ignoreAllowed(Vcs) : Bool` | 禁用/恢复 VCS ignore，同时参与 global/exclude 的有效开关。 |
| `no-require-git` | `requireGit : Bool` | 正项取消 git 仓库存在条件，否定恢复该条件。 |
| `hidden` | `hidden : Bool` | 隐藏条目纳入开关；不因此忽略其他排除规则。 |
| `follow` | `follow : Bool` | 跟随符号链接开关。 |
| `one-file-system` | `oneFileSystem : Bool` | 同一文件系统约束开关。 |
| `max-depth` | `maxDepth : Option<Usize>` | Usize；显式遍历深度限制，0 保留。 |
| `max-filesize` | `maxFileSize : Option<U64>` | Size64；显式输入大小限制，0 保留。 |
| `type` | `typeRequests : Seq<TypeRequest>` | Text；向共同类型变化序列追加 Select(name)。 |
| `type-not` | `typeRequests : Seq<TypeRequest>` | Text；向同一序列追加 Negate(name)。 |
| `type-add` | `typeRequests : Seq<TypeRequest>` | Text；向同一序列追加 Add(spec)，其类型定义语法在高层 Types 构建检查。 |
| `type-clear` | `typeRequests : Seq<TypeRequest>` | Text；向同一序列追加 Clear(name)。 |
| `unrestricted` | `ignoreAllowed, hidden, binary`（按本项出现序号） | 出现第 1 次应用 no-ignore 正项，第 2 次仅应用 hidden 正项，第 3 次仅应用 binary 正项；第 4 次失败。中间的其他选项仍可覆盖既往动作，不能按最终次数重放前三次。 |
| `pre` | `pre : Option<Path>`；`searchZip : Bool` | Path；非空设置预处理命令并关闭 search-zip；空值或否定清除 pre，但不重新开启 search-zip。 |
| `pre-glob` | `preGlobs : Seq<Text>` | Text；追加预处理筛选 glob，语法检查在高层准备。 |
| `search-zip` | `pre : Option<Path>`；`searchZip : Bool` | 正项开启压缩搜索并清除 pre；否定只关闭压缩搜索，不恢复 pre。 |
| `threads` | `threads : Option<PositiveUsize>` | Usize；0 恢复未指定，非零是请求值；排序/单文件等实际消费约束仍优先。 |
| `mmap` | `mmap : MmapPolicy` | 正项为 AlwaysTryMmap，否定为 Never；否定不恢复 Auto，尝试也不保证映射成功。 |
| `sort` | `sort : Option<SortOrder>` | none、path、modified、accessed、created；none 清除排序，其余设置升序键。 |
| `sortr` | `sort : Option<SortOrder>` | 与 sort 相同域；none 清除排序，其余设置降序键。 |
| `sort-files` | `sort : Option<SortOrder>` | 正项设置路径升序，否定清除任何当前排序；保留弃用拼写。 |
| `quiet` | `quiet : Bool` | 开启 quiet；具体输出、提前停止与错误退出仍由命令结果合同决定。 |
| `only-matching` | `onlyMatching : Bool` | 开启仅匹配部分输出。 |
| `replace` | `replacement : Option<Bytes>` | Text 的 UTF-8 字节；设置替换文本，保留空值；不按分隔符做反斜线解码，捕获替换由 printer/matcher 合同解释。 |
| `byte-offset` | `byteOffset : Bool` | 输出字节偏移开关。 |
| `column` | `column : Option<Bool>` | 显式设置列号开/关，区别于未指定。 |
| `line-number` | `lineNumber : Option<Bool>` | 显式要求行号。 |
| `no-line-number` | `lineNumber : Option<Bool>` | 显式关闭行号。 |
| `with-filename` | `filename : Option<Bool>` | 显式要求文件名。 |
| `no-filename` | `filename : Option<Bool>` | 显式关闭文件名。 |
| `heading` | `heading : Option<Bool>` | 显式设置 heading 开/关，仍受 vimgrep 约束。 |
| `vimgrep` | `vimgrep : Bool` | 开启 vimgrep 产品呈现；隐含列号/行号/文件名及 heading 决定在高层消费。 |
| `pretty` | `color : ColorPolicy`；`heading, lineNumber : Option<Bool>` | 同时设 color=Always、heading=true、line-number=true；不是粘性的独立模式，后续可分别覆盖。 |
| `include-zero` | `includeZero : Bool` | 零计数输出开关，不据此将 selected 改为 true。 |
| `max-columns` | `maxColumns : Option<PositiveU64>` | U64；0 清除列数限制，非零设置限制。 |
| `max-columns-preview` | `maxColumnsPreview : Bool` | 超列数时预览开关。 |
| `trim` | `trim : Bool` | 裁去标准结果行前导 ASCII 空白的呈现开关，但保留当前行终止字节；不裁 Unicode 空白，也不改搜索输入。 |
| `color` | `color : ColorPolicy` | never、auto、always、ansi；设置颜色/超链接资格策略，终端接合另行决定。 |
| `colors` | `colors : Seq<ColorSpec>` | ColorSpec；追加一个颜色规格，按出现顺序作用于默认颜色。 |
| `hyperlink-format` | `hyperlink : HyperlinkFormat` | HyperlinkFormat；设置超链接格式，失败增加 `invalid hyperlink format` 上下文。 |
| `hostname-bin` | `hostnameCommand : Option<Path>` | Path；空值清除命令，非空设置 hostname 取得命令；不在本次解析运行。 |
| `block-buffered` | `buffering : BufferPolicy` | 正项 Block，否定 Auto；覆盖共同缓冲策略。 |
| `line-buffered` | `buffering : BufferPolicy` | 正项 Line，否定 Auto；覆盖共同缓冲策略。 |
| `after-context` | `context : ContextExtent` | Usize；设置 after 的显式数值，具体优先和 passthru 边界见下文。 |
| `before-context` | `context : ContextExtent` | Usize；设置 before 的显式数值。 |
| `context` | `context : ContextExtent` | Usize；设置 both 的默认上下文数值，不覆盖同轮有限上下文中显式 before/after。 |
| `passthru` | `context : ContextExtent` | 选择无限上下文；此前所有有限上下文决定不再影响后续有限上下文的新一轮。 |
| `context-separator` | `contextSeparator : Option<Bytes>` | EscapedBytes；设置上下文分隔符，空字节串仍是存在的分隔符；否定才禁用。 |
| `field-context-separator` | `contextFieldSeparator : Bytes` | EscapedBytes；设置上下文元信息字段分隔符，允许空。 |
| `field-match-separator` | `matchFieldSeparator : Bytes` | EscapedBytes；设置匹配元信息字段分隔符，允许空。 |
| `path-separator` | `pathSeparator : Option<Byte>` | EscapedBytes；空串恢复默认路径分隔符，单字节设置替换分隔符，多字节拒绝并保留原诊断。 |
| `null` | `nulPath : Bool` | 开启路径 NUL 终止；不修改输入行终止，不能等同 null-data。 |
| `stats` | `stats : Bool` | 统计请求开关；JSON 强制统计等消费条件不被否定抹去。 |
| `no-config` | `configAllowed : Bool` | 禁用配置请求；仅在参数来源合同所规定的决定点生效。 |
| `no-messages` | `messagesAllowed : Bool` | 禁用/恢复普通消息；ignore 消息还必须通过此开关。 |
| `no-ignore-messages` | `ignoreMessagesAllowed : Bool` | 禁用/恢复 ignore 消息；恢复不覆盖 no-messages。 |
| `debug` | `log : LogLevel` | 设置日志 Debug。 |
| `trace` | `log : LogLevel` | 设置日志 Trace；与 debug 后出现者决定，不取最大等级。 |

## 组合与真实消费边界

上文低层 mode 的解释采用固定 P **实际代码**；原 `Mode::update` 的相反注释不能改变合同。进入高层后，从同次低层 mode、invert、onlyMatching 只作一次计数归一：若 mode 为 CountMatches 且 invert，则高层模式为 Count；否则若 mode 为 Count 且 onlyMatching，则为 CountMatches；其他情况保持。不能把高层结果重新投入该关系反复归一。上下文直接消费上文 ContextExtent，显式 0 仍覆盖 C，不恢复 passthru 以前的请求。

所有 `-e/-f` 共用一个模式来源序列；所有 type 变化共用另一个序列。普通 glob 和 iglob 却是两个保序组：高层先应用全部普通 glob，再应用全部 iglob；最终 glob-case-insensitive 影响普通组，iglob 始终不敏感。不能按两组在 argv 中的交织顺序建立一个规则列表。类型变化在默认类型定义上依次消费；错误、include 扩展及选择结果归 Types 的真实合同，不能把参数 Text 已通过等同类型规则有效。

ignore 消费同次有型投影：dot=`ignoreAllowed(Dot)`，parents=`ignoreAllowed(Parent)`，git-ignore=`ignoreAllowed(Vcs)`，global=`ignoreAllowed(Vcs) && ignoreAllowed(Global)`，exclude=`ignoreAllowed(Vcs) && ignoreAllowed(Exclude)`；require-git 取 requireGit。**只有实际进入遍历准备时**，显式 ignoreFiles 才在 `ignoreAllowed(Explicit)` 门控下按序加入；Types/Generate 或不可匹配的 Search 不因此读取它们。固定 P 在设置 ignore-file-case-insensitive 之前就由独立 GitignoreBuilder 读取显式文件，因此它们保持大小写敏感；discoveredIgnoreInsensitive 只作用于自动发现的文件。显式文件消费还会独立取得 current_dir，第一次结果被复用；失败报告相应 ignore 诊断而不加载该文件，不能因为命令前面的 cwd/PWD 后备成功就跳过这次观察。

颜色规格先按冒号分为 2 或 3 段；输出种类为 path/line/column/match/highlight，属性为 fg/bg/style/none，种类、属性、style 按实际 Unicode 小写转换识别。none 清除该种类的已有样式，固定 P 接受第三段并忽略它；其他属性必须有第三段，fg/bg 消费 termcolor 的 Color 合同，style 接受 bold/nobold/intense/nointense/underline/nounderline/italic/noitalic。默认颜色与后续合成属于 printer 公共合同；不能为兼容未闭合而在 CLI 复制 termcolor 实现。

超链接接受空格式、真实别名和合法自定义模板，不限于补全列举的别名。模板转义、变量、scheme、path/line/column 约束由 printer 定义；仍须完成该公开定义的完整第一层接合。非空 hostname-bin 在高层准备确实尝试执行，即使最后不输出超链接；运行/读取/空输出失败会走原 hostname 后备与诊断，不能提前当参数错误或因格式为空省去作用。

未指定的列号、heading、行号、文件名、线程等须与**同次**模式、路径和环境观察关联：列号默认取 vimgrep；heading 默认取 stdout 为终端且非 vimgrep，显式开启也受 vimgrep 排除；文件名默认取 vimgrep 或非单文件。未指定行号时 quiet 或非 Search 为 false，FilesWithMatches/FilesWithoutMatch/Count/CountMatches 为 false，JSON 为 true，Standard 取“stdout 为终端且非仅 stdin，或 column，或 vimgrep”。显式行号值优先。排序或单文件使线程数为 1，否则取显式非零请求，再否则取实际 available_parallelism（失败为 1）且最多 12；不能仅凭默认值表冻结环境。对应资源和执行策略保持义务仍由后续合同承担。

## 同次决定到搜索输入与公开结果

本节补全上表的消费关系。所有值均来自参数来源已选中的同一 `q`、同次准备结果和实际输入；下列名称是合同中的有型关系，不是新的作者字段、可填写的运行结果或阶段对象。有效 Search 子模式记作 `m`，它已经过上文的一次计数归一。输入的显式/发现来源、stdin 身份和公开路径来自该次路径选择，不从路径显示文本猜测。

### 输入内容、二进制与匹配

搜索一个被接受输入时，stdin 使用本次共享输入源；否则，有 pre 且预处理筛选允许该路径时搜索预处理输出；否则，在压缩搜索开启且解压定义识别该路径时搜索解压输出；其余搜索文件内容。pre 与 searchZip 的互斥由前面的参数关系保证，不能让实现自行选择优先者。pre-glob 只筛选是否使用预处理，不把未通过的文件从搜索集合排除；stdin 不运行预处理或解压。

预处理消费的路径既作为命令的一个实参，也用于打开并连接该命令的 stdin；它不是把路径拼成 shell 命令。搜索预处理/解压内容仍使用原路径作为结果路径，而匹配字节、偏移和统计来自实际被搜索内容。相关子进程或读取器结束必须处理：P 在搜索返回后仍尝试 close，搜索与 close 都失败时保留搜索错误，只有搜索成功时才把 close 错误作为本次失败。已发生输入消费、输出及诊断不回滚。这是作用和错误保持条件，不要求作者维护 Command、Reader 或清理调用序列。

二进制处理关系的结果使用 grep-searcher 的三个公开含义 `none`、`convert(NUL)`、`quit(NUL)`，不复制其扫描算法：

| 同次产品决定 | 显式输入 | 遍历发现的输入 |
| --- | --- | --- |
| binary=AsText，或 nulData=true | none | none |
| binary=SearchAndSuppress，且非 nulData | convert(NUL) | convert(NUL) |
| binary=Auto，且非 nulData | convert(NUL) | quit(NUL) |

显式身份属于实际输入来源，不能用“当前只有一个文件”替代。binary 不是简单的“全部忽略/全部读取”布尔值；检测后的结果呈现及 selected 仍须消费对应 sink 的真实合同。

| 有型决定及共同条件 | 必须进入的含义与消费边界 |
| --- | --- |
| patterns、fixed、case、boundary | 模式来源得到的准确文本序列共同定义匹配；fixed 选择字面模式语义，case 选择所选引擎的 Sensitive/Insensitive/Smart，boundary 选择整行/词边界。Smart 消费所选引擎的模式合同，不能在 CLI 对模式字符串自行作大小写启发式。 |
| engine、unicode | Default 取得 grep-regex 含义，PCRE2 取得 grep-pcre2 含义；Auto 在默认引擎构造失败后才尝试 PCRE2，保留原失败、日志及两次均失败的诊断。Unicode 在默认引擎启用/禁用 Unicode 语义，在 PCRE2 同时控制 UTF 和 UCP。无 PCRE2 feature 的失败只在真正需要该引擎时发生。 |
| multiline、dotall、crlf、nulData | 搜索器的行终止为 CRLF、NUL 或 LF；互斥关系已经排除同时 CRLF/NUL。默认正则引擎的锚点允许行内边界；非 multiline 时 dotall 不生效，所选行终止不能由模式跨越；multiline 时 dotall 才决定点是否跨换行，NUL 不再因为单行优化而禁止出现在模式中。PCRE2 的相交解释沿其公开合同，不把默认引擎的 line-terminator 设置硬套给它。 |
| binary 与 nulData | 两类输入均为 none 时，默认引擎不设置 ban_byte；否则设置 ban_byte(NUL)，但实际检查条件和快速字面路径的绕过沿[引擎合同](../library/ENGINE-CONTRACT.md#行点号与限制)，不保证所有含 NUL 模式都拒绝。单行 nulData 的终止字节限制另行成立。ban_byte 没有传给 PCRE2，不能仅因两者同为 matcher 就复制它。 |
| regexLimit、dfaLimit | 仅约束默认正则引擎的相应容量；PCRE2 分支不消费这两个限额。Auto 的默认尝试仍消费它们，因此其失败可以触发后备；不能把限额转成所有引擎共享的最大输入字节数。 |
| encoding | Auto 继承 searcher 的 BOM/编码检测合同；显式编码进入对应解码合同，仍保留 BOM 嗅探；Disabled 关闭 BOM 嗅探且不选择显式解码。输入偏移按实际搜索字节域解释，不能直接认作原文件字节偏移。 |
| invert、context、maxCount、stopOnNonmatch | 共同约束实际 searcher 的选中行/跨行结果、上下文、每输入最大匹配数及停止条件；ContextExtent.All 是透传上下文，Finite 使用准确 before/after。0 的快捷路径已经在命令合同定义，其他停止、末尾上下文和回调边界仍由 searcher 的公开合同保持。 |
| mmap | 是内存映射的请求与限制，仍受实际输入是否可映射、失败后备和资源合同约束；对 stdin、预处理或解压输出的 reader，不虚构文件映射成功。Auto 的私有选型阈值不能仅因出现在参考源码就变成新作者参数。 |

这里的引用指定实际专业含义的归属；完整 grep-regex、grep-pcre2、grep-searcher 公开定义及其准确作者引用仍须在九库交付中闭合。以上不是重新实现三库，也不以表格存在签发它们的固定解释资格。

### 结果呈现、统计与终结共享同一选择

选择的唯一作者定义为 [RequestedPresentation](search-result.module.json)。对同次、已经归一的 `m : SearchMode` 和 `q.quiet/q.stats : Bool` 取得 `p : SearchPresentation`，不把原生函数的返回或可填写的模式标签当成这个关系。定义是无作用的全函数，只有六种模式与两个 Bool 的 24 种输入；它不解析参数、不编排阶段、不读取 IO，也不产生搜索结果。下表是这份选择及其消费者的解释，不再独立拥有另一份 quiet/模式选择政策。

SearchPresentation 的七个 Bool 载荷构造中，该 Bool **只表示必须收集搜索统计**，不表示已找到匹配或写成功；JSON 和 QuietJSON 的 Unit 构造必需统计，所以不存在 JSON(false)。QuietJSON 表示安静匹配选择加 JSON 结尾统计；它与 JSON 的逐文件事件、QuietWithMatch(true) 的普通统计格式均不同。global 的选中早停资格只属于 QuietWithMatch(false) 和 QuietWithoutMatch(false)；其他构造没有这项资格。Files 不进入该 Search 定义、不建立搜索统计，其 quiet 可在已经接受路径、尚未写该路径时停止。统计存在并不取消 maxCount、二进制处理、IO 失败或其他真实停止条件。

| 同次条件 | 实际结果含义 | 选项如何参与 |
| --- | --- | --- |
| p=Standard(stats) | 标准文本结果 | byteOffset、有效 column/heading/filename、colors/hyperlink、maxColumns/maxColumnsPreview、onlyMatching、vimgrep、replacement、三个内容分隔符、pathSeparator、nulPath、trim；行号、行终止、上下文及匹配内容来自同一次 searcher。 |
| p=JSON(unit) | JSON Lines 结果 | 使用 replacement，保留原 lines、原 submatch 范围及独立 replacement 字段；compact 输出且仅有相应事件时才产生 begin/end。lineNumber、context、invert、行终止和 maxCount 经 searcher 影响事件。标准文本的 trim、maxColumns、颜色、heading、列号和分隔符不改写 JSON 字节结构。 |
| p=Count/CountMatches/PathsWithMatches/PathsWithoutMatch(stats) | 按输入汇总的计数或路径 | includeZero 只改变零计数是否输出；有效 filename、colors/hyperlink、pathSeparator/nulPath 参与适用输出。计数字段分隔符固定为 `:`，不消费 field-match-separator。replacement、trim、byteOffset 和 maxColumns 不变更这种输出。 |
| p=QuietWithoutMatch(stats) | 安静的未匹配选择 | 不输出通常路径，仍按对应未匹配 sink 的结果给 selected，并按载荷收集统计。 |
| p=QuietWithMatch(stats) 或 QuietJSON(unit) | 安静的匹配选择 | 不输出通常匹配/计数/路径/JSON 文件事件，仍取得对应 sink 的 selected 与统计。QuietJSON 的结尾统计按 JSON summary 格式输出，不能据没有 match 事件断言没有结果或没有统计。 |
| Files | 路径列表 | colors/hyperlink、pathSeparator 和 nulPath；nulPath 只把路径终止从 LF 改为 NUL，不能改变搜索行终止或 JSON 消息分隔。quiet 和 selected 按命令合同处理。 |
| Types、Generate、Special | 各自公开文本/制品 | 输出来源和成功条件归命令合同；不把 Standard 的显示选项、搜索统计或 quiet 自动施加到这些模式。Types 消费同次类型定义。 |

这里“某选项不改写该输出”不免除早先值接纳或高层准备：JSON 下非法颜色规格仍在参数接纳时报错，非空 hostname-bin 仍按准备合同产生作用；反之，不能为 JSON 添加它从未要求的 Standard 截断、字段分隔或修剪。普通 JSON 中显式关闭行号会使相应 `line_number` 为 null，不能由 JSON 默认开启行号反推“永远有数字”。JSON 字段的字节语义继续由[唯一格式合同](../library/JSON-OUTPUT.md)拥有。

标准结果的文件间分隔也由同次决定取得：有效 heading 开启时采用空分隔内容；否则仅在有限且非零上下文时使用 contextSeparator；其他情况没有文件间分隔。None 与 Some(空 Bytes) 保持不同；实际换行和有无先前输出由 printer 的合同决定。该规则不施加于 JSON 或汇总输出。串行/并行实现都须保持同一可见分隔，不能因分隔由 printer 或共享 writer 负责而复制一份作者决定。

buffering=Auto 在使用普通 stdout 接口的串行搜索、Files 和 Types 中按本次 stdout 终端观察选择行/块缓冲；显式 Line/Block 选择相应请求。并行 Search 的参考实现使用文件结果缓冲，并不因此承诺每个匹配行立即送达。后端可以更换组织，但“已写入接口”、flush、关闭及读端已经取得内容是不同观察，不能把 buffering 当全工程的即时送达保证。color=Auto 的终端资格、真实终端能力和被选颜色/超链接输出共同决定实际控制序列，不由颜色字段自行证明终端支持。

selected、统计和已写字节是三个独立观察。它们均绑定同一输入和 sink；结束时再由[命令合同](COMMAND.md#模式结果与退出决定的接合)组合实际错误累计、quiet 与现有 RequestedExit。不能用有 stdout、统计中的 matches 非零或参数 mode 之一代替 selected，也不能由计算完退出码推得所有资源已经结算。

参考实现的对应由 `HiArgs::printer`、`stats`、`quit_after_match` 与 main 的 `print_stats` **联合**提供：P 没有返回 SearchPresentation 的原生函数，不能伪造该返回槽。选中方法可以直接满足这项纯值关系而不物化 p；无论如何都须把所选结果形式、统计资格/格式和全局早停资格接到同一调用。实际搜索、命令端点绑定及 Target 未完成前，本模块只取得独立产品选择的准确源码，不取得整 CLI 的运行或固定解释资格。

## 固定解释与实现选择的保持条件

普通构建需要消费已经固定的产品定义；上表还不是可由 AI 在构建时重新解释的脚本。相交的规则解释方法必须区分以下三个对象，并在原 MeaningResult/BoundaryView 中保留它们的真实关系，不增加作者状态台账或第二份可写参数源：

| 对象 | 准确输入、结果和解释责任 |
| --- | --- |
| 一次原始参数解析 | 输入为该次有序 `OsString` 序列；以固定词表、lexopt 规则和各值域完成识别及逐项接纳。P 的 Parser::parse 返回 Result<(), anyhow::Error> 并修改内部 LowArgs；只有成功后才由准确对应关系取得产品投影，不能把 q 当成该函数的返回值。同一次错误之后没有成功决定可投影。Fault、资源耗尽及未完成不因此被折入正常 Result 返回域。原拼写与参数位置用于诊断，不能以规范长名替换实际别名。 |
| 有效决定的正常关系 | 在全部逐项接纳成功的域内，按本合同得到 mode、匹配、输入、筛选、呈现等决定。覆盖、保序追加、累计动作和上下文优先属于正常结果关系；不要求目标保存每步 LowArgs，也不强迫物化全部解析事件。 |
| 实际使用与作用 | 同次模式、路径和环境决定哪些检查、IO、matcher/worker 和终结被需要；端点在各自条件下才可用。公开消息、首错、被捕获错误、部分输出和省去作用的条件均须保持；值已接纳不等于资源存在或后续检查已通过。 |

由此，先筛掉“最终不会生效”的原参数再检查是不合法的：`--max-count bad --max-count 1 --help` 必须在第一项值转换处失败；`--encoding bad-label --no-encoding --help` 不能因恢复 Auto 而跳过先前非法 label。帮助也不能吞掉这类低层失败。相反，`-f missing --files` 不要求打开该模式文件，因为低层接纳的是 Path，而真正的模式文件读取只属于 Search 准备。二者不是可用同一个“未使用则删除”规则处理的情形。

已有[序列取优](../../../../docs/作者/组合/模块封装与复用库.md#有限可复用合同按键取极值并保留来源次序)和[有限关系](../../../../docs/领域/状态关系与流/关系查询与维护.md)可参与**下层**正常决定计算，但不能直接接收原始 argv 后按键只留最后一项。先取得相关接纳资格；保留原出现次序及重复；只对满足对应纯性、定义域、值/资源和失败条件的片段选择方法。普通覆盖使用位置决定胜出，追加序列不能被去重，unrestricted 的当级动作不能由末次次数重放，有限上下文先保留 passthru 边界再取其后的 A/B/C。下层可以融合检查与计算，但须保持同样首错及正常结果；不要求实际先存一张事件表，也不要求全部失败路径遍历剩余 argv。

以下位置由固定 P 的真实消费者决定，既不是通用阶段编号，也不是应用作者需要编排的流水线。所选目标可以改变私有调用组织，但不能改变这些相交观察：

| 实际需要的条件 | 被接纳/读取的内容与错误边界 |
| --- | --- |
| 每次低层解析到该项 | Text/整数/大小、编码标签、颜色、超链接格式和分隔符转换；即使之后被覆盖、最终不搜索或将显示帮助，也不省略已有接纳义务。 |
| 成功的非 Special 高层准备 | 先核 special 为空，再核排序支持，再取得实际环境、Search 模式来源及路径；随后按实际次序取得颜色/超链接、类型、glob、pre-glob。Types/Generate/Files 也会遇到其相交检查；无 pre 时非法 pre-glob 仍可失败。 |
| 高层准备中的 Search 模式来源 | 按 `-e/-f` 的共同来源顺序处理，必要时读文件/stdin；没有显式来源才将首个位置参数转成模式。非 Search 不读取模式文件，但低层 `-e` 的 Text 接纳仍发生。相同模式可被实现合并，不因此取消多次文件/stdin 请求的已规定观察。 |
| 高层成功后的实际 Search | 先判是否可能匹配；max-count=0 等快捷情形可直接给未选中结果，不构造 matcher、search worker 或遍历器。这不反向省去此前模式文件、类型和 glob 检查。 |
| 实际构造 matcher | 此时才检查正则与所选引擎能力，包括 PCRE2 feature；默认引擎失败、Auto 的后备及相应日志按原错误关系保留。Files/Types/Generate、Special 和不可匹配的 Search 没有这次构造义务。 |
| 实际构造 search worker | 此时才解析非空 pre 的命令位置；参数阶段只接纳路径，pre-glob 已在高层准备检查。位置解析与后来逐输入派发命令是不同发生点，不能提前运行命令证明配置合法。 |
| 实际构造遍历器 | 此时才消费显式 ignore-file；其诊断和当前目录观察服从上文。它不属于所有模式共用的高层选项准备，也不能因为最终 matcher 失败而无条件抹去先前已发生的诊断。 |

Search 的相交先后还受真实选择影响：单线程路径先完成遍历器构造及排序所需准备，再构造 matcher/searcher/worker；并行路径先构造 matcher/searcher/worker，再构造遍历器。因而同为非法正则与缺失显式 ignore 文件，单线程可以先报告 ignore 诊断，随后报告正则失败；并行在正则失败时尚未读取该 ignore 文件。单线程的路径降序和时间排序还先收集候选；无排序或路径升序不因此提前穷尽候选。这里约束由这些条件产生的 IO、错误和部分观察，不要求保留 Rust 的 iterator、Box、线程对象或调用栈。

这给出固定解释与降低方法必须保持的具体输入域、分支、首错及作用条件。它不将 `maxByKey`、词表或本 Markdown 自动登记为合格解释供给；真实 Rule/Meaning 类型绑定、方法入口和全部字段消费者仍须取得，生产方法仍未实现。

## 独立接受条件与未闭合项

以下反例直接来自不同公开行为的对照，约束后续解释和实现；它们不是本轮已经执行的 Gift 测试：

| 输入片段 | 必须区分的结果 |
| --- | --- |
| `-A 0 -C 5`；`-C 5 -A 0` | 均为 before=5、after=0。 |
| `-B 4 --passthru -A 2` | 有限 before=0、after=2，不能恢复旧 B=4。 |
| `--files -l`；`-l --files` | 前者 FilesWithMatches，后者 Files；以实际代码为准。 |
| `--count-matches -v -o`；`--count -v -o` | 高层前者 Count，后者 CountMatches；不能反复归一到同一个结果。 |
| `-u --ignore -u` | 第二个 u 仅开启 hidden，不再次禁用 ignore。 |
| `--pre cmd --no-search-zip`；`--search-zip --pre ''` | 前者仍有 pre，后者仍启用 search-zip。这里 `''` 表示已由 shell 交付的一个空参数。 |
| `--encoding none`；`--no-encoding` | 前者禁用解码，后者 Auto。 |
| `--context-separator ''`；`--no-context-separator` | 前者是存在但零字节的分隔符，后者无分隔符。 |
| `--max-count 0`；`--max-columns 0`；`--threads 0` | 分别为显式零上限、清除列数限制、线程数未指定。 |
| `-e -q`；`-q -e x`；`-e --` | 分别为模式 `-q`、quiet 与模式 x、模式 `--`，不能把取值重新解释为选项。 |
| `--colors path:none:anything` | 有效清除 path 样式，不能按帮助简述拒绝第三段。 |
| `--max-count bad --max-count 1 --help` | 被覆盖的非法值仍报低层解析错误，不能显示帮助作为成功。 |
| `--files -f missing file`；`--files --pre missing file` | 不因此读取模式文件或解析 pre 命令；file 为实际存在的普通输入时仍可列出。 |
| `--max-count 0 -e '[' file`；`--max-count 0 -e hit --glob '[' file` | 前者可绕过 matcher 而未选中，后者在高层 glob 检查先失败；不能把零计数当成跳过全部准备。 |
| `--threads 1 --ignore-file missing -e '[' dir`；同参数改为 `--threads 2` | 在两线程确实被选中且其他准备成功时，前者先有 ignore 诊断再报正则错误，后者正则先失败而不读取该 ignore 文件。 |
| `--json --no-line-number`；`--json --line-number` | 在实际产生 match/context 事件时，前者的 line_number 为 null，后者来自同次一基行号；不是由 JSON 模式强制覆盖显式关闭。 |
| `--json --quiet --no-stats`；`--quiet --stats` | 两者均无普通结果输出；正常实际搜索的结尾统计分别是 JSON summary 与普通统计文本，不能合并成同一呈现构造。 |
| `--count --field-match-separator X`；标准模式加相同参数 | 计数仍使用固定 `:` 字段分隔；标准匹配结果在适用元信息位置消费 X。 |
| `--trim`，内容先后以 ASCII 空格和 U+2003 开头 | 仅标准呈现裁去适用 ASCII 前缀；Unicode 前缀与实际搜索内容不因此改变，JSON lines 也不裁剪。 |

104 项均已在本页接到明确类型的产品投影，正常结果关系不再依赖 LowArgs/Rest 或阶段更新函数。仍未取得这些语义类型的完整作者编码与准确定义引用、生产固定解释、所有搜索/遍历/呈现消费者及目标保持；不能据类型标注或“104 项都有一行”宣称这些已闭合。帮助正文、man/补全原格式资产及其生成关系由 [CLI-DOCUMENTATION](CLI-DOCUMENTATION.md) 承担，printer/help/补全共用 [超链接别名数据](../library/hyperlink-aliases.json)；它们不代签完整命令方法或 printer 接合。printer 的颜色/超链接全部公共合同、精确平台错误显示和工具链绑定继续开放；完整原生/Gift 运行、生产 Reader/生成器、Gift 等价和独立最终审查未执行。无需为这些缺口重建 104 个 Rust 同义方法；应补实际定义、解释与真实消费者。

固定来源：`crates/core/flags/defs.rs` 的 FLAGS 与全部 Flag 实现及 convert，`flags/mod.rs` 的元数据缺省，`flags/parse.rs:221–475` 的识别/错误/建议，`flags/lowargs.rs` 的默认、Mode 与 ContextMode，`flags/hiargs.rs` 的归一、matcher、searcher、printer、stats 与 BinaryDetection 消费；`crates/core/main.rs` 的模式入口和 print_stats、`search.rs` 的输入选择与 close 处理给出共同作用条件。另有 `crates/ignore/src/walk.rs` 的显式 ignore 读取、`crates/cli/src/human.rs`、`crates/printer/src/color.rs`、`printer/src/standard.rs` 与 `util.rs` 的 trim_ascii_prefix、`crates/searcher/src/searcher/mod.rs` 和锁定 lexopt/bstr。实际来源与核验分别保存在本任务 `.tmp/cli-options-20261029/`、`.tmp/cli-meaning-20261029/`、`.tmp/cli-consumers-20261029/`，不由行号或摘要签发运行证明。
