# 两种正则后端的产品合同

本源拥有固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 grep-regex 与 grep-pcre2 公开含义，连接[共享 Matcher](MATCHER-CONTRACT.md)、[内容搜索](SEARCH-CONTRACT.md)和命令。相同 trait 不使模式、默认、错误、行知识和资源保证相同。这里只保留公开控制与观察，私有解析器、自动机和缓存不成为应用作者程序。准确机器声明、固定解释、供给及目标保持仍未完整。

## 构造与模式

build 消费当前 builder 的单模式；build_many 按输入次序形成一个非捕获分组交替，不是返回模式索引的集合查询，捕获编号也属于合并后的同一模式。空列表与列表中一个空模式不能统一：PCRE2 显式把空列表构造成永不匹配；Rust 后端在默认快速字面路径中也如此，但 case_insensitive 或 case_smart 开启后转入解析路径，空列表拼成空表达式，可产生空匹配，随后仍消费 word/whole_line 等实际配置。build_literals 继承同一差异。本次等价保持已有行为，不另定统一的空列表政策。build 不消耗 builder，后续设置不改变已构造 matcher；new 使用各库默认，CLI 显式配置不反向覆盖它们。

模式输入是 str，搜索输入是字节，接受域不同。fixed_strings 使元字符取字面含义，大小写/word/whole_line 仍适用。固定 P 的 regex build_literals **直接调用 build_many，不自动启用 fixed_strings**；默认输入 `a+` 仍是正则。

word 要求两侧不紧邻单词字符，不等于简单包两边普通 `\b`；whole_line 使用局部 multiline 行锚点，独立于全局 multi_line，并在同时开启时优先于 word。两库的单词定义依赖各自 Unicode/ASCII 或 UTF/UCP 控制。

语法由准确锁定的 regex-syntax/regex-automata 或 PCRE2 供给承担。Rust 后端不支持的反向引用/任意 lookaround 不能改义成另一模式；PCRE2 更广语法不自动获得 Rust 后端的资源或错误保证。

## 大小写与 Unicode

regex 默认区分大小写、关闭 smart case、开启 Unicode。明确 case_insensitive 不被 smart case 关闭；否则 smart case 要求语法中至少有一个字面且没有 Unicode 大写字面，字符类字面和范围端点参与，类名/元语法不直接算大写。

PCRE2 默认关闭 caseless、smart case、UTF、UCP。其 smart case 扫描合并模式字符，跳过反斜杠及紧接一个字符，其余没有 Unicode 大写便启用 caseless，不另要求存在字面。它不等于 Rust AST 规则：属性名的大写可能影响结果，转义所代表的字符也不自动参与字面大小写判定。局部模式旗标继续由相应语法决定。

| 控制 | 准确区别 |
| --- | --- |
| regex unicode | 控制类、字面和大小写的 Unicode 含义；关闭后的字节/ASCII 模式不自动拒绝所有无效 UTF-8 输入 |
| PCRE2 utf | 按 UTF-8 码点解释匹配，不等于 Unicode 属性类 |
| PCRE2 ucp | 字符属性类与边界使用 Unicode，同时隐含 UTF；后设 utf(false) 不取消仍开启的 UCP |
| disable_utf_check | 当前已弃用且无操作，不是关闭校验的能力 |

锁定 pcre2 0.2.11 仅在 UCP 构造路径同时设置 MATCH_INVALID_UTF，单独 utf(true) 只设置 UTF；不能把所有 UTF 模式概括为同一非法字节处理。位置始终是原 haystack 字节偏移。Rust 后端允许空匹配位于 UTF-8 码点内部，不能统一成 str 的字符边界。

## 行、点号与限制

两库 multi_line 控制行锚点，不是 Searcher 的整输入多行许可；dot_matches_new_line/dotall 又独立控制点号。regex 的 swap_greed、ignore_whitespace、octal 分别控制贪婪、模式空白/注释与八进制，octal 不是反向引用支持。

regex 的终止符在实际构造路径中从可匹配字符类移除；不能移除的字面或移空的非空类返回 NotAllowed。new_line_matcher 是默认 builder 加 LF 限制，任意终止字节不把所有锚点和点号重定义成该字节行。crlf(true) 开 CRLF 锚点并配置 CRLF 限制；crlf(false) 清除两者；后继 line_terminator(None) 只撤销限制，保留已开的 CRLF 锚点。实际首尾锚点还可能使发布的 line_terminator 知识为 None。

PCRE2 crlf 使用 ANYCRLF 换行含义，不提供 regex 的禁止终止字节匹配保证；wrapper 没有 line_terminator setter，该 Matcher 查询沿默认 None，含 LF 的模式也可能合法。搜索策略和打印上下文分别消费这些实际保证，不能按后端名统一输入裁剪。

regex 默认近似编译程序限制 100 MiB、DFA 缓存请求 1000 MiB、嵌套限制 250；它们分别不是进程总堆、所有线程总额或模式字节长度。辅助候选行匹配器还有相交构造及错误，不能把一个限制当全产品资源证明。

固定 P 快速字面路径可绕过后继 ban/strip 检查：未请求大小写折叠/smart case，模式可直接视为字面且不含所配置终止字节时，ban_byte 不提供无条件拒绝。实际 ban 检查也不等于拒绝所有可能包含该字节的大字符类；非 ASCII ban 在检查处 panic。非 ASCII line terminator 在实际 strip 路径返回 InvalidLineTerminator，快速路径不保证同样检查。正常结果、Error 与 panic 分别保持，本次不因注释不一致擅自修复兼容行为。

## 捕获、分派与运行错误

两个 RegexCaptures 是不同名义类型，由对应 matcher 创建、复用；共同组参与和失败内容规则沿 MATCHER-CONTRACT。PCRE2 的名字映射对重复名使用后写入索引，不根据本次参与情况重新选择同名组。两个后端都是一个合并模式的捕获，不产生额外的输入模式索引。

| 公开能力 | regex | PCRE2 |
| --- | --- | --- |
| find_at/captures_at | 准确字节范围，正常 Result 错误类型为 NoError | 原引擎匹配错误转为本库 Error |
| try_find_iter | 本引擎迭代覆盖 | 本引擎迭代覆盖，后续失败不撤回已有回调 |
| shortest_match_at | 引擎终点搜索，不承诺全局数学最短范围 | 沿共同默认取得 find_at 的终点 |
| non_matching_bytes | 实际保守集合，可遗漏 | 默认 None |
| line_terminator | 构造后仍可提供的真实保证 | 默认 None |
| find_candidate_line | 有辅助 matcher 时 Candidate，否则确认结果 | 默认 Confirmed 或无结果 |

find_iter 等入口不因 try_find_iter 覆盖而全部变成原生迭代。NoError 不证明无 panic、无资源失败或任意起点合法。锁定 regex-automata 接受长度加一表示已结束，更大范围可在建立 span 时 panic；PCRE2 直接查找/捕获要求 at 不大于长度。共同默认遍历的提前结束关系仍独立存在。

两库 Error 都有非穷尽 ErrorKind、kind、Clone/Debug/Display/Error，原引擎错误转为字符串而不保留下转原对象。regex 的 Regex、NotAllowed、InvalidLineTerminator、Banned 保持不同来源；PCRE2 当前 Regex(String) 同时可用于构造/JIT 和运行错误，不能当不匹配或构造期专有错误。

## JIT 与真实原生供给

PCRE2 JIT 请求有关闭、必须、尽力三态。jit(true) 要求成功，否则构造错误；jit_if_available(true) 失败记 debug 后继续非 JIT。两 setter 最后调用生效，包括 false 清除前一请求，不是一个永久优先。max_jit_stack_size 只约束实际成功 JIT 使用的栈，不是全部内存/线程预算；部分原生工作数据或栈分配失败可能 panic。Clone 保持模式但可形成独立可变工作池，不准据它混合会话。

is_jit_available 查询真实 PCRE2 配置，查询异常可 panic；为 true 不证明某模式已 JIT。version 在锁定供给中返回 pcre2-sys 编译绑定的常量 `(10,45)`，不查询动态库版本。Cargo.lock 固定 crate 内容也不唯一固定现场 PCRE2：构建可选 pkg-config 系统库或随包静态库，环境/目标影响原生构建与 JIT。真实原生身份和资格仍须在目标闭包取得。

## 同次 CLI 选择

Default 只尝试 Rust 后端；PCRE2 只尝试 PCRE2，未启 feature 时不可用；Auto 先构造 Rust，只有构造失败才试 PCRE2，双方失败保留双方错误。它不是搜索期间逐次 fallback，不在已有输出后换后端重放。

CLI 显式设置两库 multiline 行锚点、模式/大小写等，默认启 PCRE2 UTF+UCP；适用 64 位目标请求尽力 JIT 与 10 MiB 栈。库默认不因此改变。Rust 的终止符、binary ban、编译/DFA 限制和 PCRE2 差额沿真实构造保持，不能为归一配置增加 PCRE2 原本没有的拒绝。

## 来源与未取得资格

| 公开面 | 固定 P 来源 |
| --- | --- |
| regex builder 全部构造与设置 | `crates/regex/src/matcher.rs:23–362` |
| regex matcher/捕获/实际覆盖 | 同文件 `365–550` |
| 默认、smart case、快速字面与 ban/strip | `config.rs:43–227,242–370`；`ast.rs:31–143`；`ban.rs:8–51`；`strip.rs:33–119` |
| regex Error/Kind | `crates/regex/src/error.rs:6–97` |
| PCRE2 builder 全部构造与设置 | `crates/pcre2/src/matcher.rs:11–298` |
| PCRE2 matcher/捕获/smart case | 同文件 `301–433` |
| PCRE2 Error/Kind、重导出 | `error.rs:6–50`；`lib.rs:8–15` |
| CLI 选择及参数接合 | `crates/core/flags/hiargs.rs:368–513` |

外部片段读取绑定 Cargo.lock 的 regex-automata 0.4.18、regex-syntax 0.8.11、pcre2 0.2.11 和 pcre2-sys 0.2.10；本地归档摘要已核与锁相同，读取文件与归档逐字节相同。核过范围/空匹配、空交替、UTF/UCP、JIT/资源、偏移、版本和原生构建选择；未完整审计全部引擎算法、Unicode 表、JIT 或平台实现，未执行引擎实验。后端准确语义、trait witness、真实导入、固定解释、ABI 及共同保持仍需接合；不得用空 Rule 或未定义 methodRef 消除缺项。
