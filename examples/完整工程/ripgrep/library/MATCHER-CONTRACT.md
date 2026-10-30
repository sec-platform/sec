# 共享匹配协议的产品合同

本源拥有固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 grep-matcher 公开含义，以及内置后端、搜索器和打印器共同消费它时必须保持的区别。它接到[联合产品](../intent/WHOLE-PRODUCT.md)，不把每个 Rust 方法翻译成作者程序，也不要求产品作者提供新的匹配能力目录。当前是实际设计源；机器声明、固定解释与完整目标签名尚未形成，源码审查不代替运行或全工程等价证明。

## 字节、范围与捕获

匹配输入及位置以字节为基础。`Match` 是允许空区间的半开范围 `[start,end)`，由公开构造和端点修改保持 `start <= end`。`new` 在起点大于终点时 panic；`with_start` 在新起点大于现有终点时 panic；`with_end` 在新终点小于现有起点时 panic；`offset` 在任一端点加偏移后不能由 usize 表示时 panic。它们不验证具体输入长度或 UTF-8 边界，`zero(offset)` 也不读取输入。实际调用 Rust 的字节/字符串索引时，仍须满足该输入的原生切片边界；字符串额外要求字符边界。不能因此把所有匹配输入收窄为有效 UTF-8。

`find_at` 与 `captures_at` 在原 haystack 中从 at 查找，结果位置仍相对于整个输入。at 不是裁剪输入的请求：锚点与 lookaround 所见上下文仍属于原输入。共同协议没有搜索终点参数；消费者的结果接受范围与匹配器可见上下文必须分别保持。固定 P 的打印器在真正多行模式中保留接受范围之后最多 128 字节的后文供 lookaround 使用，再根据结果起点是否超出接受范围停止接收。这个窗口属于当前兼容行为，既不能裁掉全部后文，也不能承诺无界后文。

`Captures::len` 表示组结构数量，包含本次未参与的组。`is_empty` 只判断该数量是否为零，不判断整体匹配是否零宽或所有组是否缺席。成功捕获的索引 0 是整体匹配；其他组可以没有本次范围。`as_match` 使用索引 0，缺席时 panic。组名对应多个索引时，共同合同只要求返回其中一个，不固定最小、最大或最后参与者。

捕获空间是相应匹配器可复用的工作状态。`new_captures` 产生适配该匹配器的初始存储；支持捕获还须共同提供计数、名字映射及捕获行为。捕获返回 false 时其内容 unspecified，错误也没有共同的清空或回滚保证。默认 `captures_at` 直接返回 false，不修改存储。默认遍历会复用同一存储，可能写入随后被抑制而未交付给回调的空匹配；因此遍历后的存储不统一等于“最后一次交付”。消费者不得把旧捕获当作本次成功。

## 查找、遍历与覆盖

共同 Matcher 要求 `find_at` 与 `new_captures`，其余操作提供默认行为并允许覆盖。关联错误只共同要求 Display，不额外要求 std::error::Error、Clone、Send 或 Sync。内置 regex 的特性不能升级为 PCRE2 或外部合法实现的前提。

首个整体匹配、存在性、终点见证、捕获和行候选是不同承诺。`is_match` 不允许假阳性或假阴性；`shortest_match` 给出足以确认匹配的终点，可能早于 find 的完整范围终点，但共同默认允许直接采用 find_at 的终点，不能要求它一定是全局数学最小值。终点见证不能直接用作整体匹配范围。

默认遍历保持非重叠交付。非空匹配之后从 end 继续；空匹配之后从 end+1 继续，这是一字节而非一个 Unicode 字符。若空匹配终点等于上一次已经交付匹配的终点，该空匹配不交付，但仍推进。起点大于长度时结束，故输入末尾的空匹配可以交付。默认遍历的初始 at 大于长度时不调用匹配器便结束；这不是所有 `_at` 操作的共同越界保证。默认捕获替换随后仍会取 `haystack[at..]`，越界可能 panic。

回调 true 继续，false 正常停止。try 形式保持两层错误：外层 `Result` 的错误是 Matcher::Error，内层错误是回调 E；正常穷尽与 false 停止均为 `Ok(Ok(()))`，返回值不再区分二者。已发生回调和作用不因后继错误回滚。原注释所述“搜索错误转成 E”与真实签名及实现不符，本次兼容采用实际两层错误。

以下是会影响可替换实现的公开分派关系，不要求生成器保留原私有循环：

| 公开入口 | 固定 P 的默认消费 |
| --- | --- |
| find | find_at，起点 0 |
| find_iter | find_iter_at，起点 0；后者消费 try_find_iter_at |
| try_find_iter | try_find_iter_at，起点 0 |
| captures | captures_at，起点 0 |
| captures_iter | captures_iter_at，起点 0；后者消费 try_captures_iter_at |
| try_captures_iter | try_captures_iter_at，起点 0 |
| replace | find_iter |
| replace_with_captures | replace_with_captures_at，起点 0；后者消费 captures_iter_at |
| is_match | is_match_at，起点 0；后者消费 shortest_match_at |
| shortest_match | shortest_match_at，起点 0；后者默认消费 find_at |
| find_candidate_line | shortest_match，并形成 Confirmed 或没有候选 |

特别地，find_iter 不经过 try_find_iter。P 的 regex 与 PCRE2 都只覆盖 try_find_iter 并调用各自引擎的原生迭代，没有同时覆盖 find_iter/find_iter_at/try_find_iter_at。即使起点都是零，也不能把这些入口合并为一次原生迭代。`Matcher for &M` 逐一转发全部 25 个方法，保持原覆盖与关联类型，不制造新状态或退回默认行为。

## 替换与捕获插值

默认替换向现有 dst 追加：未替换前缀、回调提供的替换内容及正常结束后的剩余原文。不会先清空 dst。回调 false 时当前匹配已经由回调处置，随后仍追加未替换后缀；搜索错误则提前返回，不补最后后缀，也不撤销已追加内容。`replace_with_captures_at` 只从 at 开始构造追加结果，不自行复制此前的输入前缀。

捕获插值消费原字节和实际捕获，支持 `$name`、`$N`、`${name}`、`${N}` 及 `$$`。有无花括号都只接受非空 ASCII 字母、数字、下划线串；无花括号取最长串，有花括号要求其后立即为 `}`。花括号不开放非 ASCII、空串或标点名字。纯数字先按 u32 解释，失败后交给名字映射；合法引用未找到索引或组未参与时追加空字节。某个 `$` 后无法解析为合法引用时，只追加当前 `$`，随后继续扫描剩余模板，不把非法花括号串当成不可再解析的整体。`${名字}`、`${a-b}` 和 `${}` 会原样保留；若 a 对应的捕获为 X，`${$a}` 则成为 `${X}`。插值不清空目标缓冲，并消费实际捕获范围的切片前提。

## 行与保守知识

`LineTerminator` 保留单字节与 CRLF 两种身份。单字节可为任意字节，所有平台默认 LF；CRLF 的完整序列为 CR LF，单字节边界视图为 LF。其 is_suffix 只检查末字节 LF，裸 LF 也可成立，但不使 CRLF 与单字节 LF 成为同一个值。消费者是否去掉完整序列或分别处理 CR/LF，属于各自真实合同；[搜索器的慢路径](SEARCH-CONTRACT.md#行跨行与上下文)与打印器不能凭相同 as_byte 合并。

`ByteSet` 是 256 字节域上的集合；add_all/remove_all 的两端包含，倒置范围不含元素。`non_matching_bytes` 给出的集合是有方向的知识：集合中某字节保证不出现在匹配里，集合外不证明存在含它的匹配。默认没有集合，允许保守遗漏。

Matcher 的 line_terminator 保证匹配不跨越其约定的行终止边界；无法给出保证时 None 合法，None 不等于“必能跨行”。搜索器按准确终止符身份及禁止匹配字节判断是否需要多行策略；CRLF 的分行边界字节是 LF，CR 本身不构成行结束。不能把可用优化知识、选择的搜索策略和全部产品行为混成同一布尔值。

`Confirmed(i)` 只保证 i 所在行存在匹配，不提供匹配范围；`Candidate(i)` 允许假阳性，须重新确认；候选不能遗漏真实匹配行，None 也不能是假阴性。该操作以行导向匹配为共同前提，跨多行时行为 unspecified。默认只产生 confirmed 或没有结果。regex 后端可用快速行正则产生 candidate；PCRE2 不因此取得相同知识。搜索器另行处理位置在缓冲末尾、没有实际行的边界。

## 公共值与实际消费者

NoCaptures 的组数恒为零、任意 get 均为 None，调用其默认 as_match 会 panic。NoError 供不会产生错误的实现使用，不能当成可正常打印的诊断，也不等于语言的空类型。固定源码为它派生 Debug；Display 与转为 io::Error 会 panic，Error::description 返回 `no error`。原注释声称 Debug 也 panic，与实现不符。

搜索器消费 Matcher 的匹配判定、范围、终点、错误及终止符、禁止匹配字节和行候选保证，不调用捕获 API。打印器为精确位置、替换和高亮再次匹配其可见内容，保留 at 与上下文边界；其 Replacer 按需创建并复用捕获空间。两者消费同一公开定义，实际对象、存储和生命周期仍由各自使用关系决定，见[联合产品的状态与消费图](../intent/WHOLE-PRODUCT.md#共享定义不混合运行)。

公开面覆盖包括：Match 的构造、端点、偏移、长度/空性及三类索引；LineTerminator 的构造、两种字节视图、后缀判断与默认；ByteSet 的集合操作；Captures 的五个方法；NoCaptures、NoError、LineMatchKind；Matcher 的 25 个方法、关联类型与引用转发。机器类型、trait witness、目标 ABI 与外部实现资格仍须由真实声明和消费者接合，本说明不代签它们已存在。

## 来源与证据边界

以下定位均在固定 P，引用源码只供核对，不要求生成构建重新从 Rust 推断意图：

| 含义 | 实际来源 |
| --- | --- |
| 范围、索引、行终止符、ByteSet | `crates/matcher/src/lib.rs:43–360` |
| 捕获、NoCaptures、NoError、行候选值 | 同文件 `364–530` |
| Matcher、默认遍历、替换、知识与引用转发 | 同文件 `533–1379` |
| 捕获插值语法及追加 | `crates/matcher/src/interpolate.rs:14–142` |
| regex、PCRE2 的实际覆盖 | `crates/regex/src/matcher.rs:438–505`；`crates/pcre2/src/matcher.rs:315–374` |
| 打印器上下文、替换、终止符和捕获复用 | `crates/printer/src/util.rs:18–152,484–587`；`crates/printer/src/lib.rs:87` 的窗口上限 |
| 搜索器的终止符和行候选消费 | `crates/searcher/src/searcher/mod.rs:803–820,889–915`；`core.rs:475–518` |

已完整读取共同 matcher 与插值源码，并核对两内置后端的相交实现及上述消费者。未完整审计外部 regex-automata/PCRE2 引擎，未运行捕获失败、空匹配、越界或性能实验；不把委托给外部实现的未核行为写成共同保证。P/Q 的已授权名称变化不改变本合同，注释与实现矛盾也不授予本次修复行为的权限。
