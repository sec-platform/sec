# Globset 的第一层公开合同

<a id="globset-contract"></a>
## 范围、来源与解释资格

本正文是 [Globset 规则](globset-contract.module.json) 的唯一规范来源，由 [产品要求根](../intent/globset.module.json) 绑定到一个公开库主体，并由工程 `kind:design` 范围保留。正文定义产品所需的关系，JSON 只保存规则、主体和组合，不重复保存一棵解析器或匹配器实现树。

合同以有限 Unicode 标量串、有限字节串、有序序列、归纳语法、关系与状态变化描述含义。它们是普通数学记法，不是新的 Gift 方言、核心节点或目标数据布局。表中每个公开操作都属于同一库；此主体不因保存或导出而变成运行对象、Rust ABI 或目标输出根。

参考对象为 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 globset 0.4.20。依据是 P 的 `crates/globset/src/{glob,lib,pathutil,serde_impl}.rs`、`crates/globset/Cargo.toml` 与 `Cargo.lock`；源码用于静态对照，不被本合同作为业务实现整体保留。锁内相关成熟能力是 regex-syntax 0.8.11、regex-automata 0.4.18、aho-corasick 1.1.5、bstr 1.13.0、log 0.4.33。依赖锁的内容仍由实际锁拥有，不在这里复制一套可写锁。

`implementation:unbound` 表示没有绑定产品实现；当前也没有 `semantics.interpretation.methodRef`。正文可被保存和人工精确审查，机器不得把读到 Markdown 当作已解释。下述算法足以判断所列纯值关系，但完整 Rule→公共类型/观察→方法→Target 接合及文末开放义务仍未闭合，不能据此声明整个库可生成或等价验收完成。

## 对象、选项与公开操作

令 `Text` 为有限 Unicode 标量序列，`Bytes` 为 0 至 255 的有限序列；不对原文正规化。平台给定准确的 `is_separator` 关系，Unix 只有 `/`，Windows 包含 `/` 和 `\`。其他目标必须绑定自己的路径合同。

模式的逻辑内容为原文、五个选项、下述解析结果和精确正则文本。正常构造使四者满足本合同；`arbitrary` 入口不具有这项一致性保证，见后文。这些逻辑观察不要求四份独立作者内容，解析树和正则文本可由原文与选项确定。

| 选项 | 缺省 | 准确影响 |
|---|---|---|
| case_insensitive | false | 字节正则中的 ASCII 大小写折叠；改变集合分类资格 |
| literal_separator | false | 普通 `?` 与 `*` 不得跨 `/`；不对字符类增加同样限制 |
| backslash_escape | `!is_separator('\\')` | 决定反斜杠是否消费并转义后继标量 |
| empty_alternates | false | 是否保留渲染结果为空的备选分支 |
| allow_unclosed_class | false | EOF 时未闭合字符类的回退规则 |

`GlobBuilder::new` 保存输入借用及缺省选项；五个 setter 只修改对应布尔项，返回同一 builder 的可变借用。`build(&self)` 不消费或修改 builder，每次按同一输入构造独立结果。`Glob::new` 和 `FromStr` 使用缺省选项。

| 公开面 | 所需结果及状态关系 |
|---|---|
| `Glob::glob`、Display | 原始输入字符串；Display 使用字符串的原生 Display 语义 |
| `Glob::regex` | 本文规定的精确文本，不能用任意等价正则替换 |
| `Glob::compile_matcher` | 先执行规定的单正则编译；成功形成匹配器，失败 panic，不伪装为 false 或解析 Err |
| `GlobMatcher::{is_match,is_match_candidate}` | 在已构造匹配器上对候选的完整归一字节串判断；路径入口先构造候选 |
| `GlobMatcher::glob` | 此匹配器所持模式的共享引用；保持原文及全部模式观察 |
| `Candidate::{new,from_bytes}` | 下述候选字节关系；借用不得逃逸输入寿命，内部是否复制不是作者选择 |
| `GlobSet::{empty,default,builder}` | 空集合或空 builder；空集合长度零，any 为 false，all 为 true |
| `GlobSetBuilder::{new,add,build}` | add 按调用顺序消费并保存模式、返回同一 builder 的可变借用；build 不清空或消费 builder |
| `GlobSet::new` | 按输入迭代器顺序取得 `AsRef<Glob>` 结果并构造有序集合；输入位置为模式索引 |
| `GlobSet::{len,is_empty}` | 保存的模式项数及其是否为零，重复模式分别计数 |
| `GlobSet::{is_match,matches_all,matches}` 及 `_candidate` 变体 | 下述三个独立结果关系；路径入口只通过同一候选转换进入 |
| `GlobSet::{matches_into,matches_candidate_into}` | 路径入口先调用 AsRef 并完成候选构造，再进入 candidate 入口；candidate 入口先清空调用方结果，正常完成时写本次升序命中索引，空集合也清空。候选准备在进入前 panic 时，不能声称原结果已清空 |
| `escape` | 对每个 `? * [ ] { }` 输出 `[字符]`，其他标量原样保留，包括反斜杠与 `!` |

自定义迭代器、`AsRef`、格式器、Hasher、serializer 和 logger 可以产生作用或失败，不能因正常值关系为纯就任意复制、重排其调用。精确目标签名及这些开放调用的完整作用接合仍在文末义务中。

## 模式语言：解析关系

逻辑语法项为 `Literal(c)`、`Any`、`Star`、`RecursivePrefix`、`RecursiveSuffix`、`RecursiveMiddle`、`Class(negated,ranges)`、`Alternates(branches)`。`ranges` 和 `branches` 保序并保留重数；每个分支是语法项序列。它们用于定义关系，不要求目标保留这些名称、Vec、栈或游标对象。

从左至右解释输入，返回首个错误；末尾没有更早错误时再检查未闭合备选组。一般字符形成 Literal，`?` 形成 Any。`{` 开始一个允许嵌套的组，组内 `,` 结束当前分支并开始下一分支，`}` 结束最近的组；组外 `,` 是字面量，组外 `}` 立即为 UnopenedAlternates。空组有一个空分支；EOF 仍有组为 UnclosedAlternates。

反斜杠转义启用时，`\` 与后继任意标量形成一个 Literal；没有后继为 DanglingEscape。关闭时，若平台把 `\` 视为分隔符，则形成 `Literal('/')`，否则形成 `Literal('\\')`。这不改变星号规则中的平台分隔符判断。

单星形成 Star。双星一次消费两个星号；以当前分支已经形成的项、双星前一个实际消费的原字符、后继字符和是否在组内，按下列顺序判定：

1. 当前分支为空：后继为 EOF 或平台分隔符时形成 RecursivePrefix，并消费后继分隔符；否则形成两个 Star。组内的 `,` 或 `}` 在这一条不当成 EOF。
2. 分支非空且前字符既非平台分隔符，也非组内的 `,` 或 `{`：形成两个 Star。
3. 其余情况下，后继为 EOF 或组内 `,`/`}` 时选择 RecursiveSuffix；为平台分隔符时选择 RecursiveMiddle 并消费它；其他后继形成两个 Star。
4. 第 3 条选出递归项时替换分支中前一项；若被替换项为 RecursivePrefix 或 RecursiveSuffix，则保留该项。此规则定义连续递归段折叠，不能简单把所有 `**` 当成同一运算。

`[` 开始字符类，除非此前已发生本次解析的未闭合类回退。类开头一个 `!` 或 `^` 设否定位，其后按以下规则取得有序闭区间：

- 首个成员 `]` 或 `-` 均是单点；后续 `]` 结束类。
- 一般成员形成单点。已有成员后的 `-` 将最后一项置为待补右端；下一普通成员补右端并清除待补位。待补时又遇 `-`，用 `-` 补右端并清除待补位。
- 每次补右端都按 Unicode 标量值比较，左端大于右端立即报 InvalidRange；这一步不因允许未闭合类而撤销。
- 在待补位为真时遇结束 `]`，把尾部 `-` 作为额外单点。类内 `\` 不具有转义功能。
- EOF 未找到结束 `]`：选项为 false 时为 UnclosedClass；为 true 时，该 `[` 形成 Literal，并从它的后一个原字符重新按主规则解释。此后本次解析的所有 `[` 都是 Literal。回退不撤去更早已发现的错误。

因此不能用简单 EBNF 的无上下文 `**`、只接受非嵌套组、Unicode 字符范围匹配或“未闭合就全段字面化”代替该关系。

## 精确正则文本与字节匹配

`Escape(c)` 先取 UTF-8 字节。非 ASCII 字节逐个写成 `\x` 加两位小写十六进制。ASCII 中 `\ . + * ? ( ) | [ ] { } ^ $ # & - ~` 前加一个反斜杠，其余原样；这固定 regex-syntax 0.8.11 的 escape 行为。

`Render(sequence)` 为逐项文本串接，具体为：

| 语法项 | Render 文本 |
|---|---|
| Literal(c) | Escape(c) |
| Any | literal_separator 为 false 时 `.`，为 true 时 `[^/]` |
| Star | literal_separator 为 false 时 `.*`，为 true 时 `[^/]*` |
| RecursivePrefix | `(?:/?|.*/)` |
| RecursiveSuffix | `/.*` |
| RecursiveMiddle | `(?:/|/.*/)` |
| Class(n,rs) | `[`，可选 `^`，按顺序写各区间，`]`；相等端点只写 Escape(c)，否则写 Escape(a)、`-`、Escape(b) |
| Alternates(bs) | 逐支 Render；empty_alternates 为 false 时删除文本为空的分支；保留项以 `(?:`、`|`、`)` 连接，无保留项则为空文本 |

完整 `regex()` 为 `(?-u)`、可选 `(?i)`、`^`、主体、`$` 的串接。主体通常为 Render；**只有整个顶层序列恰为单个 RecursivePrefix** 时，主体改为 `.*`。嵌套分支不应用该特例。空源产生 `(?-u)^$`，空分支过滤依据渲染文本，不依据是否有语法项。

令 `B={0..255}`、`S=B*`，`/` 为字节 47。单模式成功编译后的结果是完整候选字节串属于该模式语言：Literal 在 case_insensitive=false 时是其唯一 UTF-8 字节串，为 true 时将其中每个 ASCII 字母字节替换为其大小写二元集合并逐位串接，非 ASCII 字节仍精确保留；Any 是 B 或 B 去掉 `/`；Star 是对应单字节语言的 Kleene 闭包；RecursivePrefix 是 `{ε} ∪ S·/`；RecursiveSuffix 是 `/·S`；RecursiveMiddle 是 `{/} ∪ /·S·/`。序列取语言串接，备选取保留分支并集，没有保留分支时为 `{ε}`；顶层单 RecursivePrefix 的语言另为 S。

字符类解释生成的**字节类**，不是 Unicode 标量集合。相等非 ASCII 端点贡献其 UTF-8 各字节；非相等端点的转义文本按 byte-regex 范围语法解释，可能在正则阶段失败。启用 case_insensitive 时使用 ASCII 大小写闭包，否定类随后在 B 中取补。具体正则解析、可表示性和失败沿固定成熟 regex-syntax/regex-automata 合同；不得另写一个近似 Unicode matcher 代签它。

单正则编译采用 regex-automata 0.4.18 的语法 `utf8(false)`、`dot_matches_new_line(true)`，meta 配置 `utf8_empty(false)`、NFA 限制 `10 * 2^20` 字节、hybrid cache capacity `10 * 2^20` 字节，其他设置继承固定版本缺省。集合 fallback 批编译另设 `MatchKind::All`。这些容量设置不等于整个库总内存的硬上界。单模式编译错误在 compile_matcher 变为 panic；解析构造成功不保证编译成功。精确资源失败及目标 panic 接合不得当作已验证。

## 候选路径关系

字节入口保留给定字节；路径入口使用 bstr 1.13.0 的路径转换：Unix 原始 OsStr 字节，非 Unix 对 `to_string_lossy()` 的结果编码 UTF-8。随后逐字节将平台认作分隔符的字符改为 `/`。不查询文件系统，不解析 `.`/`..`，不折叠重复或尾随分隔符。

归一结果记作 p。basename 是最后一个 `/` 后的字节；空 p 或该末段为 `..` 时记为空。`.` 不属于这里的空 basename 特例；这与 ignore 库的其他路径政策不是同一规则。extension 为非空 basename 最后一个 `.` 起的后缀，包含点；没有点时为空。因此 `.rs` 的 extension 是 `.rs`，`a.` 的 extension 是 `.`。

`from_bytes` 允许非法 UTF-8；对非 ASCII 兼容编码未给出公开匹配保证，不能借此删除其他字节输入。路径和字节入口各自保持真实输入及寿命；显示用的替换字符不反向更改字节入口。

## 有序集合：分类和命中关系

给定模式序列，每个输入位置具有独立索引 i。大小写不敏感的模式一律进入 Regex 类；其他模式按下表先后取**第一个**满足条件的类别。表中的字面串均为语法项 Literal 的原字符串再编码 UTF-8，不从 regex() 逆推。

| 次序／类别 | 准确条件与导出键 |
|---|---|
| 1 Basename | RecursivePrefix 后跟非空、全部为 Literal 且不含 `/` 的序列；键为后续字面串 |
| 2 Literal | 非空且全部为 Literal；键为完整字面串 |
| 3 Extension | 可选一个 RecursivePrefix，然后 Star、Literal('.')、零或多个非 `.`/`/` 的 Literal；无 RecursivePrefix 时要求 literal_separator=false；键为该点及后缀 |
| 4 Prefix | 尾项为 Star 时要求 literal_separator=false，移去它；尾项为 RecursiveSuffix 时移去它并在结果末尾补 `/`；其余不移。剩余全部为 Literal，补完后非空；键为结果 |
| 5 Suffix | 开头是 RecursivePrefix 时移去；它的后继若是 Literal，先在结果补 `/` 并置 component=true，否则 component=false。然后可移去一个 Star，但此时要求 literal_separator=false。剩余全部为 Literal；补完的键不得为空或仅 `/` |
| 6 RequiredExtension | 从末尾向前只允许 Literal，遇 `/` 或非 Literal 即不合格，找到最近的 Literal('.') 后停止；键为该点及后缀 |
| 7 Regex | 以上均不合格，保留精确 regex() 文本 |

分类用于定义 P 的公开批匹配结果；目标不必保留名为 Strategy 的对象、哈希表、Aho 自动机或对象池。分类顺序有观察差异，不能通过理想化 glob 语言替换。

由分类形成有限逻辑条目组，保留输入索引：Literal、Basename、Extension 按相同键汇合索引；Prefix、Suffix 保留每个条目；RequiredExtension 按扩展名汇合 `(索引,精确正则)`；Regex 保留每个正则位置。component=true 的 Suffix **同时**向 Literal 组加入去掉首个 `/` 的键，两个条目都指向同一输入索引。

给定候选 p/basename/extension，各组命中为：

- Literal：键等于 p；Basename：basename 非空且等于键；Extension：extension 非空且等于键。
- Prefix：p 以键开始；Suffix：p 以键结束。比较完整字节串，不作路径组件补充推断。
- RequiredExtension：只查候选 extension 的组；该 extension 非空且存在时，其中每项以完整 p 做其单正则匹配。
- Regex：逐模式的固定字节正则语言成员关系，返回对应输入索引；批方法必须保留全部模式位置。

`is_match` 为任一组有命中；`matches` 为各组命中索引的升序集合。只去掉同一个索引重复出现，不能合并重复模式的不同索引。`matches_into` 以该结果替换原结果，不追加到旧内容。

`matches_all` 为每个**非空条目组**的下列判断之合取，不等于 `matches.len == len`：

| 组 | all 判断 |
|---|---|
| Literal / Basename / Extension | 只有一个不同键，且该键按该组规则命中 |
| Prefix / Suffix | 每个条目均在对应首端／末端命中；重复条目分别计入 |
| RequiredExtension | 候选 extension 非空且该键存在，且**仅此键**下的所有正则都命中；其他扩展名键不参与本组判断 |
| Regex | 每个正则位置均命中 |

没有任何组时合取为 true。component Suffix 对 Literal 与 Suffix 的双重贡献继续分别参与合取。

三个必须保留的区别是：`**/..` 对 `a/..` 的单模式为 true、集合 any 为 false；`[a*.rs,a*.txt]` 对 `a.rs` 的索引为 `[0]`、all 为 true；`[**/foo/bar]` 对 `foo/bar` 的索引为 `[0]`、all 为 false。这些由一般规则推出，不实现为三项例外开关。

## 构造、错误与其他公开观察

集合构造先按源顺序取得模式和分类。空迭代器直接成功为空集合。取得期间每个 Regex 类有对应 debug 调用点；分类全部完成后有各组计数的汇总调用点。它们受 log 特性、编译期和运行期日志级别限制，实际记录与输出还取决于接收方，不能声称无条件产生日志。随后按 Extension、Basename、Literal、Suffix、Prefix、RequiredExtension、Regex 的次序建立非空组；前缀/后缀的成熟 Aho 构造失败是 panic；RequiredExtension 逐扩展名组内按插入顺序编译单正则，首个失败返回 Err；最后批编译 Regex 组。跨扩展名组的编译／首错次序依赖当前 FNV map 迭代，是明确未闭合的开放观察，不能擅自改成输入序或排序序。

正常文本解析可能返回 UnclosedClass、InvalidRange(a,b)、UnopenedAlternates、UnclosedAlternates、DanglingEscape，并保存 `Some(original)`。公开 ErrorKind 还保留已废弃的 InvalidRecursive、NestedAlternates 以及 Regex(message)；前两项不由当前正常解析产生。非穷尽标记继续保留。

| kind | description／普通 Display 文本 |
|---|---|
| InvalidRecursive | `invalid use of **; must be one path component` |
| UnclosedClass | `unclosed character class; missing ']'` |
| InvalidRange | description 为 `invalid character range`；Display 为 `invalid range; 'a' > 'b'`，a/b 替换为实际端点 |
| UnopenedAlternates | `unopened alternate group; missing '{' (maybe escape '}' with '[}]'?)` |
| UnclosedAlternates | `unclosed alternate group; missing '}' (maybe escape '{' with '[{]'?)` |
| NestedAlternates | `nested alternate groups are not allowed` |
| DanglingEscape | `dangling '\\'`（其中实际消息只含一个反斜杠） |
| Regex(message) | 成熟正则编译器返回的实际 message |

Error 的 Display 在有 glob 时为 `error parsing glob '原文': kind`，否则为 kind；Error::description 直接取 kind 的 description。单正则编译 Error 的 glob 是生成的正则文本；批正则错误没有 glob。错误文案来自具体固定依赖的情况不能替换成任意概括。

Glob 的相等仅比较原文与五选项；Hash 依次向调用方 Hasher 输入原文及五选项的原生 Hash，不哈希 token 或 re。AsRef 返回自身。Clone 保持全部逻辑内容及公开观察，不把它解释为重新按当前缺省解析。普通 Debug 为原生 debug_tuple("Glob") 包含原文；alternate Debug 的字段次序为 glob、re、opts、tokens。Candidate Debug 的字段次序为 path、basename、ext，使用 bstr 字节 Debug。完整 formatter flags、写入失败、派生 Debug 和 Hash 的原生接合仍须满足文末义务。

`serde1` 下，Glob 序列化只调用 `serializer.serialize_str(original)` 并直接返回其结果；反序列化请求字符串、期待说明为 `a glob pattern`，用当前平台缺省 Glob::new 构造，解析错误通过 `serde::de::Error::custom` 转为反序列化错误。它不保留非缺省选项，可能无法往返。GlobSet 仅提供 Deserialize：请求序列、期待说明为 `an array of glob patterns`，依序调用 `next_element` 取得 Glob 并加入 builder；读取错误直接传播，取得 None 后才 build，构造错误再通过反序列化错误的 custom 转换。没有 GlobSet Serialize。

`arbitrary` 可直接生成 Glob 的原文、re、opts 和 tokens，并不经 Glob::new；因此相等的两个值可能有不同 regex 或匹配行为，不能对所有公开可达 Glob 假定解析一致性。其精确字节消费、失败、size_hint、树深度及非一致值行为是单独保留的未闭合义务。

默认启用 log；关闭只取消 globset 自身受此特性控制的日志，不承诺依赖特性合并后整个进程无日志。`serde1` 与 `arbitrary` 按各自特性启用；可选依赖产生的隐式 `serde` 特性仅启用依赖，单独启用它不产生由 `serde1` 条件编译的 trait 实现。`simd-accel` 是已弃用的空特性，不能据它新增执行模式。库本身不进行文件遍历或磁盘读取，匹配对象是传入的路径表示。

## 真实消费者、变更与实现自由

Types 以命中索引中的后项选择类型定义，gitignore 逆序检查并处理 only-dir，overrides 对结果作 ignore/whitelist 反转，解压选择以最后命中索引选命令。这些消费者必须复用同一索引身份、重数、候选和结果关系，不能各自维护另一份 glob 定义。它们的规则、状态和错误仍由各自作者定义承担；引用本合同不表示消费者已经接通。

修改一个选项或模式时，解析、regex 文本、分类、构造资格、三种集合查询和真实消费者按依赖重算；原文数据和公开名不被“统一”重命名。更换符合合同的匹配方法无需改产品主体，但须重核正则错误、开放调用、特性、资源和格式观察。此 globset 候选的 basename 与 ignore 的 P→Q Unix 路径修订分别拥有，不将它们合成一个通用“最后文件名”函数而改变含义。

普通应用作者不选择哈希桶、Aho 状态、正则缓存池、临时 Vec、拷贝路径或循环。若内部选择已经影响公开 Debug、构造首错或可观察调用，它就形成兼容义务，应由下层方法／目标接合承担；不能以“私有”名义删掉，也不要求每个调用者手写其实现。

## 未闭合义务与验证边界

本合同尚未完成整库设计闭合，以下义务不被 `implementation:unbound` 隐藏为单纯“未运行”：

1. 为同一公开主体建立真实 Rust 公共类型、所有签名、trait/auto-trait/借用、feature/cfg、构建和包出口接合；当前 req 主体不是这些接口的替身。
2. 固定 RuleMeaningMethod 的真实输入、输出、逐字段消费者及下层实现选择；没有 interpretation 时，保存／人工审查以外的机器用途应报告相交 Need，不能自动理解本 Markdown。
3. 完成派生 Debug、具体 formatter 和 Hasher 调用、arbitrary 非一致值、log 文本与外部回调的逐项观察合同；补齐 FNV 迭代造成的构造首错顺序。不能默认为无观察差别。
4. 将已给关系与成熟外部能力的准确类型、内容、编译配置、失败和资源边界绑定；解析／匹配、并发共享与故障路径各自取得所需保持依据。
5. 连接 Types、gitignore、overrides、解压及 CLI；完成全工程 P→Q 变化及再次修改，建立实际目标输出根。当前导出的 Globset 只是具有真实规范来源的产品要求根。

当前依据为固定源码静态推演与结构／引用审查；没有生产 Reader、RuleMeaningMethod、Rust 生成、实际差分、Unix／Windows、并发、资源故障、性能或发行运行证据。正常有限例证只能检查其选定输入，不能签发上述开放义务。
