# globset 作者源码与逐项对应

本目录当前交付的是固定 ripgrep 修订中 **完整 glob 解析状态机的 Gift 作者源码**。它不是整个 globset crate、整个 ripgrep 或已经运行的 Gift 产品。活动源码是 [parser.module.json](parser.module.json)，采用同一 gift.author-module/design-converged 的短 Definition 外壳与完整计算 Expr；函数体是实际 if/match/let/call/record/variant/sequence，不包含 Rust 源码字符串、不委托原生 glob parser，也不使用未定义的 std 名称。

唯一上游比较对象为 **4c2362d359d9913c7a5e391ccd79cb4da22bc89b** 的 crates/globset/src/glob.rs。下列行号属于该固定对象，而不是任意未来版本。上游实现是本迁移的行为输入，不反向决定 Gift 语言规范。

## 入口、值域与效果

ripgrep:globset:parser 导出 Scalars / Range / Token / Tokens / Options / ErrorKind / ParseError / ParseResult / DefaultOptions / ParseScalars。

- DefaultOptions(backslashIsSeparator: Bool) → Options 保持上游五个默认开关。平台分隔符事实由已选择目标提供：Unix 为 false，Windows 为 true；这不是调用方可随意声称已经核实的宿主事实。
- ParseScalars(input: Sequence<Int>, options: Options) → ParseResult 接受 Unicode 标量码值序列。进入解析前逐项检查 0 ≤ c ≤ 0x10ffff 且不在代理区 0xd800..0xdfff。没有 UTF-16 码元、字素、大小写或规范化替换。
- Ok 携带完整、有序、可嵌套的 Token 序列。Literal 的载荷是标量码值；Class 保留 negated 与原次序的闭区间；Alternates 保留原次序及空分支。emptyAlternates 在解析时不删分支，它属于后续正则渲染。
- Err 保留原始完整标量输入和准确错误种类；InvalidRange 保留实际起点、终点。原解析器没有错误位置字段，本源也不伪造位置。
- InvalidScalar 是此显式标量接口的输入准入错误，位于 Rust &str 已合法解码域以外；它不被算成上游新增错误。Text-facing 适配闭合后，合法 Rust 输入的对应路径永远不能产生该错误。
- 所有函数 effects 为空。解析只计算输入、状态、token 和错误值，没有文件、进程、时钟、网络、原生解析、正则引擎或宿主环境读取。物理内存、递归栈与目标资源耗尽仍由目标求值合同承担，不被纯度或 termination: total 消除。

保留符号恰为 std:IntEq / IntCompare / BoolNot / SeqPrepend / SeqUncons，其含义来自[有限纯基底](../../../../../docs/领域/计算基础/文法类型与求值.md#successor-structured-std-int-add)。空序列使用已有 Expr.sequence，由准确预期型给出元素类型。本目录没有新增标准原语或自称已经存在的库供给。

## 上游符号到实际源码

| 固定上游符号与行 | 本目录的实际定义 | 对应范围 |
|---|---|---|
| GlobOptions 220、default 240 | Options、DefaultOptions | 五个开关原义与默认；新增显式目标分隔符输入承接原 std::path::is_separator 条件 |
| Tokens 253、Token 270 | Tokens、递归 Token、Range | 八种 token、标量、范围、嵌套分支；Vec/Deref 的可变容器细节由不可变序列承担 |
| Parser 791 | ParserState、Frame | remaining/previous/current、当前 token、分组与已完成分支、foundUnclosedClass、options |
| error 819 | ErrorKind、ParseError、ParseScalars 的 Err 分支 | 固定错误种类与原 glob 保全；输入标量准入额外隔离 |
| parse 823 | ParseLoop、ParseStep | 所有字符分派、首次错误立即终止、到 EOF 的真实终结 |
| push_alternate 839 | OpenAlternate | 保存当前父分支、新建组及空分支 |
| pop_alternate 845 | CloseAlternate | 未开启即报错；组合全部分支、还原父分支、插入 Alternates |
| push_token 855 | PushToken | 加入当前分支；根分支在入口构造中始终存在 |
| pop_token 862、have_tokens 869 | ParseStar 的 SeqUncons、ReplaceRecursive | 非空判别、只取当前最后 token、递归 token 合并；不可达的空尾保护不改变合法入口行为 |
| parse_comma 876 | ParseComma | 组外是字面逗号；组内保存当前分支并开始新空分支 |
| parse_backslash 887 | ParseBackslash | 逃逸下一标量、DanglingEscape、目标相关的反斜线→斜线规范化 |
| parse_star 901 | ParseStar、ParseStarTail、PushTwoStars、ReplaceRecursive | 单星、双星、普通双星、prefix/suffix/interior、分支边界、连续递归段合并及准确游标消耗 |
| parse_class 962、内嵌 add_to_last_range 968 | ParseClass、ClassLoop、ClassRangeEnd | negation、首个 ]/-、区间尾、尾部 -、顺序比较、错误优先级、未闭合回滚 |
| bump 1054、peek 1060 | Bump、Peek | 每次 bump 都移动 previous/current；EOF bump 仍把 current 设 None；peek 不改变状态 |
| GlobBuilder::build 579 的初始化、parse、未闭合组判断 | ParseScalars、ParseLoop | 仅解析部分已闭合；Glob 构造与 to_regex_with 尚未在入口接合 |

Less / IsUnicodeScalar / FirstInvalidScalar / OptionEquals / OptionSeparator / IsSeparator / HasFrames 是此表示下的实际纯 helper。三个 Reverse* / Reverse*Into 家族把当前分支、分支组和区间的反向累积恢复成原次序；它们不是未实现的宿主操作。

## 状态对应与必须保持的边界

当前分支以 tokensReversed 保存；一帧保存 parentTokensReversed 和 completedBranchesReversed。从外到内展开帧并翻转已完成分支，得到上游 branches 的同一有序内容；帧边界对应 alternates_stack 的起始下标。这个表示直接保留分组语义，不依赖输入中的逗号数或左花括号文本计数猜嵌套。

remaining / previous / current 对应上游迭代器、prev、cur。星号和逃逸分支必须使用实际 bump 后的状态；字符类成功保存扫描后的游标，只有遇到 EOF 且允许未闭合类时恢复到左方括号刚被消费后的保存状态，并设置 foundUnclosedClass=true。后续左方括号作为字面量，不重扫后缀。已经发生的 InvalidRange 立即返回，不能因后面没有闭合括号而退回字面量。

以下差异均有独立期望向量：

- `**`、`**/` 是 RecursivePrefix；`a**b` 与 `***` 保持普通重复星。
- 斜线参与 RecursiveSuffix/RecursiveZeroOrMore 替换；`a/**/**/b` 合并成一个 RecursiveZeroOrMore。
- 空分支里的双星紧接逗号/右花括号时不会走“空分支后接分隔符或 EOF”的 RecursivePrefix 分支；例如 `{**,**/a}` 的第一个分支是两个 ZeroOrMore。
- Windows 的反斜线分隔符判断影响双星后分隔符判断，即使 backslashEscape=true；普通反斜线的逃逸开关与星号的分隔符判断没有被混为一个条件。
- `[]]`、`[-]`、`[--z]`、`[ --]`、`[a-]` 保留原字符类规则；类中反斜线不是独立逃逸语法。
- 未闭合类回滚后，问号、星号、花括号、逗号等后继字符仍由主解析器处理；不是把整个后缀都强制转成 Literal。

终止声明的可检查理由是有限输入与有限输出结构：FirstInvalidScalar 和 Reverse 家族严格缩短输入；普通 ParseLoop 至少消费一个输入标量；星号/反斜线只额外消费输入；ClassLoop 每步消费标量，允许回滚时只发生一次后缀重扫，之后 foundUnclosedClass 永久为 true。组开关只在已消费的字符上改变有限帧栈。此理由是源码层的终止论证，不是生产 checker 已签发的证明。实现若用复制型序列或递归宿主栈，其物理复杂度与深度限制必须另核，不能从抽象状态机推断线性运行时间。

## 独立期望与证据范围

[parser.expected.json](parser.expected.json) 保存明确的输入、选项与完整期望 Token/错误值。source 区分固定上游 syntax! 向量和独立边界预期；期望不由待验证 parser 输出生成。

当前本地任务核验直接读取真实模块的函数 Expr，在有限纯基底下解释；逐函数遍历实参/返回型、局部绑定、record 字段、穷尽 match、构造载荷与保留符号签名。它不是生产 Gift SourceReader/Linker/Compiler。临时解释器位于任务 .tmp/whole-engineering-20261025/globset-author-verify.py，不进入作者源集合，也不成为长期第二个语言实现。严格 JSON、canonical expansion 和完整 Schema 的集成证据由工程集成拥有者产生。

已取得的纯值证据覆盖文件中的所有期望用例及默认选项两种平台输入。有限用例和逐分支人工对应不证明所有模式的形式等价，不证明分配成本、目标栈安全、Rust ABI、regex 编译、路径匹配、globset 索引或 ripgrep 终端行为。新增反例回改真正函数与原期望来源，不将失败隐藏到兼容层。

## 尚未关闭的完整工程义务

下表保留本上游文件的其余符号；这些不是“已经保留原生，所以已经完成”。

| 尚未关闭对象 | 准确剩余工作 |
|---|---|
| Glob 76，AsRef/Eq/Hash/Debug/Display/FromStr 83—129 | 原 glob 与 options 的身份/比较、格式与错误显示、Text-facing API；Eq/Hash 不能偷偷加入派生 regex/tokens |
| Glob::new / compile_matcher / compile_strategic_matcher / glob / regex 283—328 | 组合 parser、实际 regex 产生、成熟引擎编译、借用/返回与公开结构 |
| MatchStrategy 16、new 51 | 精确优先级：basename literal→literal→extension→prefix→suffix→required extension→regex |
| literal / ext / required_ext / prefix / suffix / basename_tokens / basename_literal 334—569 | 所有必要与充分条件、case-insensitive 禁用、separator 约束、组件起点语义、逆向扫描；不能仅按样例扩展名猜策略 |
| GlobBuilder::new 574、build 非解析段、五个 setter 615—665 | Text→Scalar 接合、原 builder 公开组合/可变语义及完整 Glob 构造；本源 Options 值不能代签现有 API 已迁移 |
| Tokens::to_regex_with / tokens_to_regex 673—763 | (?-u)、case flag、全局锚定、独立双星特例、byte regex、literal separator、class、空 alternates 筛除与顺序 |
| char_to_escaped_literal / bytes_to_escaped_literal 768—789 | Unicode scalar→准确 UTF-8 bytes、ASCII regex 元字符 escaping、非 ASCII \xhh 小写编码；Text/Bytes conversion 不能由假 std 或未供给 URI 代替 |
| GlobMatcher 133—155 | Candidate 路径转换、成熟 Regex 编译/匹配的准确绑定、失败与资源边界 |
| GlobStrategic 160—205、test-only starts_with / ends_with 1066—1074 | 单模式策略与 Regex 结果的对应；test-only 助手不当作产品实现资格 |
| glob.rs 中其余 toregex! / matches! / nmatches! / extract! 测试 | 原样保全并迁成对应作者入口的独立比较；当前 token 期望不代签这些行为 |
| crates/globset/src/lib.rs / pathutil.rs / ser.rs 等 crate 其余文件 | 属于全工程余量；本目录 parser 完成不能关闭集合策略、Candidate、公开 API、错误 Display、序列化或平台路径义务 |

Text 与 UTF-8 的通用作者实现由全工程共享 foundation 层收口；在实际源码、公开出口和调用关系落地前，ParseScalars 的 Text-facing 接合保持 **OPEN**。正则引擎可保持成熟外部能力，但 glob 的解析、渲染和策略规则仍由实际 Gift 源码承担相应迁移责任。
