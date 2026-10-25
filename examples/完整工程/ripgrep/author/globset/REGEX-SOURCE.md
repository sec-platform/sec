# globset 正则渲染与策略源码

活动作者源是 [regex.module.json](regex.module.json)，模块身份为 ripgrep:globset:regex，采用 gift.author-module/design-converged。它直接导入 [parser.module.json](parser.module.json) 的 Token / Tokens / Range / Scalars / Options / ParseError 与 ParseScalars；没有重新声明这些类型的身份，没有改动 parser 文件。

本文件补充 [SOURCE.md](SOURCE.md) 中解析切片之外的正则渲染、提取和策略选择义务。比较对象仍固定为 ripgrep **4c2362d359d9913c7a5e391ccd79cb4da22bc89b** 的 crates/globset/src/glob.rs；行号只指该对象。这里的源码闭合范围不等于整个 globset、整个 ripgrep 或生产 Gift Target 已经完成。

## 可调用结果和真实组合

唯一公开计算入口为 CompileScalars(input: parser:Scalars, options: parser:Options) → BuildResult。

1. 实际调用 parser:ParseScalars。失败返回 BuildError.Parse，完整保留 parser:ParseError。
2. 成功后实际遍历取得的 Token，生成正则 Text。转换失败返回 BuildError.Encoding，完整保留共享 text:ConversionError；没有 unwrap、空字符串兜底或静默丢字符。
3. 实际运行全部提取算法并按固定优先级选择 MatchStrategy。
4. 正常返回 CompiledGlob，保留原 glob 标量、options、tokens、regex 与派生 strategy。策略只是派生结果，不能反向加入原 Glob 的 Eq/Hash 身份。

MatchStrategy 与上游相同，包含 Literal / BasenameLiteral / Extension / Prefix / Suffix / RequiredExtension / Regex。各字面量载荷采用同一 parser:Scalars；SuffixValue 携带 suffix 与 component，保持“整个路径或者从组件开始”的区别。把返回的标量字面量接入 native byte 候选、HashMap 或 RegexSet 是另一个真实消费边界。

CompileScalars 具有完整调用、错误与结果主体。所有提取与渲染 helper 也有实际 Expr，只在模块内使用。公开入口先解析输入，因此非法 Unicode 标量进入 parser 输入错误，不直接进入渲染。RenderResult / PartsResult 的防御编码错误仍有真实分支，不能因合法调用时不可达而删掉或伪造成功。

## 逐项来源和完成的纯算法

| 固定上游对象 | 实际 Gift 定义 | 保持的独立行为 |
|---|---|---|
| MatchStrategy 16、new 51 | MatchStrategy、ChooseStrategy | 精确优先级：basename literal → literal → extension → prefix → suffix → required extension → regex |
| Glob::literal 334 | Literal、LiteralScalars、NonemptyScalars | case-insensitive 禁用；必须全部 Literal；空串返回 None |
| Glob::ext 353 | Extension、ExtensionStart、ExtensionDot、ExtensionTail | 可选 RecursivePrefix；必须随后 ZeroOrMore 和点；无递归前缀时 literalSeparator 禁止扩展名充分判定；后缀不含点、斜线或非 Literal；单个点仍合法 |
| Glob::required_ext 390 | RequiredExtension、RequiredExtensionTail、ReverseTokens | 从尾部向前扫描；遇斜线或非 Literal 拒绝；第一次点即完成必要条件；不要求整个前缀可匹配 |
| Glob::prefix 419 | Prefix | 末尾 ZeroOrMore 受 literalSeparator 限制；RecursiveSuffix 替成真实尾斜线；剩余必须全 Literal；空结果拒绝 |
| Glob::suffix 462 | Suffix、SuffixRecursive、SuffixAfterPrefix、SuffixLiteral、IsEmptyOrSlash | RecursivePrefix 后跟 Literal 时保留前导斜线及 component=true；ZeroOrMore 对 separator 的限制；空串和独立斜线拒绝 |
| Glob::basename_tokens 510 | BasenameTokens、BasenameSafe | 必须 RecursivePrefix 开头且剩余非空；斜线禁止；Any/ZeroOrMore 仅在 literalSeparator=true 时合法；class/alternates/递归 token 均拒绝 |
| Glob::basename_literal 559 | BasenameLiteral、LiteralScalars | 先满足 basename_tokens，再要求剩余均为 Literal |
| Tokens::to_regex_with 673 | RenderRegex、IsOnlyRecursivePrefix | 先 (?-u)，再可选 (?i)，再首尾锚点；整个 token 序列恰为单个 RecursivePrefix 时使用 .* |
| Tokens::tokens_to_regex 692 | RenderTokens、RenderToken | 每种 Token 的实际文本：Any / ZeroOrMore 的 separator 区别，三个 Recursive token 固定展开，class 的否定和范围，Literal 的字节转义 |
| tokens_to_regex 的 Class 分支 | RenderRanges、RenderRange | 单点不输出范围短横；非单点输出 start-end；两端均采用同一准确字节转义 |
| tokens_to_regex 的 Alternates 分支 | CollectAlternateParts、JoinParts、RenderToken | 按原顺序渲染；只按渲染结果是否为空及 emptyAlternates 过滤；全部被滤掉时输出空串；否则使用非捕获组和竖线 |
| char_to_escaped_literal 768 | EscapeScalar | 调用共享 ScalarUtf8 得到真实 UTF-8 字节，再调用 EscapeBytes；不把 Unicode 字符直接交给非 Unicode regex |
| bytes_to_escaped_literal 776 | EscapeBytes、EscapeByte | ASCII 分支先准确单字符转换后调用成熟 regex_syntax escape；非 ASCII 每个字节输出反斜线 x 加两位小写十六进制 |
| GlobBuilder::build 579 的 parser→regex 构造关系 | CompileScalars | 已有解析器与实际渲染器组合、原错误传播及派生策略取得；原 Text/API/trait 形状仍需最终目标接合 |

内部 ConcatScalars、ReverseTokens/Into、Less 是已有有限纯基底上的实际递归，不是新的 std 符号。它们保持顺序、重复和精确整数比较。basename_tokens 返回相同逻辑序列；原 Rust 借用切片的存储与成本属性不能由该纯值对应自动取得。

## 真实共享接口与成熟外部边界

共享 text 导入指向 [foundation/text/conversions.module.json](../foundation/text/conversions.module.json)，moduleId 为 ripgrep:foundation:text。以下三个函数均已有实际 Gift 主体，本模块消费其返回值：

| 函数 | 准确成功值与拒绝 |
|---|---|
| ScalarUtf8(Int) | Result<Sequence<Int>,ConversionError>；成功字节各在 0..255，使用 Unicode 标量的最短 UTF-8；代理码点及域外值为 InvalidScalar |
| AsciiText(Int) | Result<Text,ConversionError>；仅接受 0..127，保留 NUL 和全部 ASCII 控制字符；其他值为 InvalidAscii |
| ByteHexLower(Int) | Result<Text,ConversionError>；仅接受 0..255，恰两位小写 hex；其他值为 InvalidByte |

ConversionError 的 ArithmeticInvariant 防御分支也完整传播。本模块不重新实现这三个转换，不复制其普通类型定义。它们的真实方法、SourceReader 和目标资格仍由各自拥有者取得；源码存在不代签运行。

唯一成熟外部函数为 regexSyntax:Escape(Text) → Text，导入身份暂定 ripgrep:external:regex_syntax。它准确对应固定依赖的 regex_syntax::escape_into/escape：本模块只向它传递已经验证的单个 ASCII 标量；调用结果用于普通字面量和字符类两处，不使用 host regex、JSON escape 或 locale 转换替代。

固定 P 的 Cargo.lock 将 regex-syntax 锁为 0.8.11，registry checksum 为 d6f6ff9a378485b298a5286656da665ba74413d36db0979633275d2e708145d4；crate 配置为 default-features=false、features=["std"]。这一记录只是准确依赖定位，不是已经取得或运行该供给的证据。实际 external 模块声明、内容解析、Method/Target 和 native readback 尚待工程集成。Escape 不承接 glob parsing、类范围决定、alternates 过滤、regex 模板或策略选择。

所有源函数显式 effects 为空。这里要求转换及 escape 供给是确定、无外部 IO 的计算；分配失败、预算和目标计算 Fault 不由空效果表消失，也不被自动变为 BuildError.Encoding。只有实际 Result.Err 沿声明通道传播。

## 反例与输入域

关键保持条件包括：

- 顶层单个 RecursivePrefix 的 .* 特例不用于 alternates 内部；每个备选分支使用 RenderTokens，而不是 RenderRegex。
- foo{,.txt} 在 emptyAlternates=false 时删除空分支；true 时保留。整个 {,} 在 false 时渲染为空主体，在 true 时保留包含两个空分支的组。
- 过滤依据是分支实际生成的 regex 是否为空；嵌套空组也需要遵守同一递归规则，不能只看 token 数量。
- 非 ASCII Literal 按 UTF-8 字节逐个写为反斜线 x 加 hex；class/range 也遵守固定上游字节行为，不能擅自改为 Unicode 正则类。
- RequiredExtension 只是必要条件，不能直接升级为 Extension；case-insensitive 使所有字面量提取失效，最终选择 Regex。
- RecursivePrefix 加字面 basename 的优先级高于 suffix；完整 Literal 的优先级高于 prefix。
- Suffix.component 为 true 时返回值包含前导斜线；后续 matcher 必须另保留“候选恰等于去掉前导斜线的 suffix”分支，不能仅做 ends_with。
- literalSeparator=true 时普通星号不能证明跨目录 extension/prefix/suffix；已有 RecursivePrefix 的扩展名规则仍可成立。

公开入口的行为域由 parser 的 Unicode 输入准入与 Options 决定。对 ParseScalars 的合法成功结果，共享 UTF-8/ASCII/hex 函数按合同不会返回输入域错误；若供给返回防御错误，本模块保留它。这种显式额外错误通道不是宣称原 Rust API 新增一个可达业务错误。

所有本地递归都沿有限 token、range、branch 或标量序列缩短；嵌套递归沿有限 Token 树下降。termination=total 仍是需要资格的声明。本地结构论证和用例不证明 native 分配、堆栈、字符转换或 regex 编译的现实完成；复制型列表与重复 Text 拼接的成本也不能自动等同原 Vec/String 累加器。

## 独立期望与取得的证据

[regex.expected.json](regex.expected.json) 保存固定上游正则/提取向量和独立边界预期。期望值是手工依据源规则给出的数据，不由待验证函数生成；生产输出包含 (?-u)，上游 toregex! 宏比较时移除的这个前缀在这里明确保留。

本任务局部核验脚本 .tmp/whole-engineering-20261025/globset-regex-verify.py：

- 实际解释 parser、regex 和共享 text 三份作者源的 Expr。
- 遍历函数实参/返回型、局部绑定、字段、构造 payload、match 分支与有限标准符号签名。
- 对文件内全部 128 条期望核对，并核公开 CompileScalars 的成功组合。
- 对三个真实转换使用点分别注入 ConversionError，核对完整 Encoding 错误传播而非成功兜底。
- 仅 regex-syntax 外部调用使用明确的 ASCII 契约 oracle；没有运行 native regex-syntax，也没有编译正则引擎。

临时脚本不进入作者源集合、不成为第二个生产 Reader。上述证据是绑定文件字节的局部纯值解释和有界静态核对；完整候选 Schema、生产 SourceReader/Linker、Target、原生包接合、形式全域等价、路径匹配及成本均须独立取得。

## 仍开放的相交闭包

本模块没有吞掉 parser/SOURCE 所列其余义务：Text-facing Glob/GlobBuilder 方法、setter 与格式/身份、GlobMatcher 和 native regex 编译、所有 MatchStrategy consumer、Candidate 路径转换、GlobSet 索引/去重、RegexSet、错误 Display、序列化、trait 与平台资源仍在完整工程余量中。

优先下一步是把已经写出的 parser→renderer→strategy 接入真实 Glob 公开值/API，再把策略选择结果交给实际集合和 matcher 算法。创建外部 Escape 声明本身不能关闭这个闭包；全部 ripgrep 的终局也不能由本目录的局部通过代签。
