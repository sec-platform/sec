# JSON 搜索输出的公开格式

本定义拥有固定 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 JSON 消息格式及其字节/统计含义；Q 的相交格式源码不变。所约束的公开观察是 `rg --json` 的 stdout 与 `grep-printer` 的 JSON 输出；原生 printer 是对照生产者，不因本文件存在就成为新 Schema 的消费者。命令模式、quiet、快捷结束和退出仍由 [COMMAND](../intent/COMMAND.md) 拥有，搜索如何决定匹配及上下文仍由搜索合同承担。此处不复制 matcher、printer 循环、缓冲或 Rust 类型布局。

[原生 JSON Schema](json-output.schema.json)给单条完整 JSON **值**的必要结构：`#/$defs/CommandMessage` 对应 CLI，`#/$defs/PrinterMessage` 对应库 printer；根是二者共用的五类消息形状。它是第一层引用的公开格式定义，不是新增 Gift 文法、目标运行资源或默认发行成员。Schema 可由成熟 JSON Schema 实现直接消费；未闭合的流、搜索关系和固定 Gift 解释不能由结构 PASS 代签。

## 消息与字节

每条消息具有 `type` 和 `data`，完整值不出现额外成员。五类含义如下；Schema 唯一拥有字段的机械形状和数值范围，本表拥有它们与实际观察的关系。

| 消息 | 内容与发生关系 |
| --- | --- |
| `begin` | 搜索输入的 path；该 sink 尚未成功发出 begin 时，在相应 `match/context` 消息前发出。CLI 不强制为每个无匹配文件发 begin。库的 `always_begin_end` 可使无匹配搜索也发 begin/end；同一 sink 复用的边界见下文。 |
| `match` | 被报告的匹配行或跨行字节、第一行号（可缺值）、起始绝对字节偏移，以及相对该段的 submatches。倒置搜索可以使 submatches 为空。 |
| `context` | 被报告的上下文字节与位置；非倒置时 submatches 为空，倒置时可包含实际匹配及替换。不能仅因消息名为 context 而丢弃它们。 |
| `end` | 搜索结束时观察到的 binary_offset 及该 sink 的统计；允许提前停止，不代表已读到 EOF。输入发生错误或输出失败时不能承诺总有完整 end。 |
| `summary` | CLI 搜索完成处尝试输出的累计 stats 与整次经过时间 elapsed_total；库 JSON printer 不产生此消息。不是 selected 的替代观察。 |

库的 `sink()` 无路径时输出 `path:null`，`sink_with_path()` 输出实际路径。固定 P 的 CLI 使用后一接口；stdin 显示为 `<stdin>`，不输出 null。路径为 Unix 时，合法 UTF-8 输出 `{"text":...}`，否则以原 OS 字节的标准 Base64 输出 `{"bytes":...}`。非 Unix 路径按 P 的 `to_string_lossy` 输出 text，可能不可逆；不能宣称跨平台全部路径无损往返。

`lines`、`submatch.match` 与存在的 `replacement` **各自**按其完整字节是否为合法 UTF-8 选择 text 或 bytes。即使 lines 用 bytes，某个子匹配仍可用 text。Base64 使用标准 `A–Z a–z 0–9 + /` 字母表、必要的 `=` 填充和零填充位，不用 URL-safe 变体或省略 padding。Schema 的 pattern 检查该词法；`contentEncoding` 在 [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-validation#section-8.2) 中是注解，不替代解码或“解码后确为非 UTF-8”的语义检查。

`path`、`line_number`、`binary_offset` 缺值时保留字段并置 null；`replacement` 无值时**省略**，有值时为 Data，不能用 null 代替。`lines` 保留报告字节中的行终止符；输入 CRLF 或 NUL 分隔不把 JSON 消息分隔改成 CRLF/NUL。submatch 的 start/end 相对解码后的 lines 字节；absolute_offset/binary_offset 则相对搜索器所见数据，可能是解压、预处理或转码结果，不保证是原磁盘文件位置。二者都不是 Unicode 或 Base64 字符索引。对每个 submatch，`0 ≤ start ≤ end ≤ len(linesBytes)` 且 `matchBytes = linesBytes[start:end]`，各项 start 非降排列；replacement 是该匹配经所选替换规则得到的字节，start/end 仍指原 lines。字段间关系由此合同拥有，Schema 不声称已检查。

计数、绝对偏移及秒使用准确无符号 64 位整数；不能先转为 JavaScript Number 再验证超过 `2^53−1` 的值。submatch 的 usize 索引还须落在所选目标的可寻址范围内。非空 line_number 是相应搜索观察的一基行号；Schema 只检查底层 u64 值域，不证明行号与内容相符。JSON 值验证也不区分 `1` 与数值相同的 `1.0`，不能据此改写 P 的整数输出词法。

## 流、作用及统计

CLI 使用 compact JSON，在完整正常写入时每条消息后为一个 LF；不是包在数组中的单个大 JSON。JSON 字符串内部的 LF/CR/NUL 由 JSON 编码转义。库还提供 pretty 输出，该模式的一条消息可跨多个物理行，不能对整个库强加 JSON Lines 限制。精确字节、键顺序及转义保持由所选序列化/目标合同承担；Schema 比较 JSON 值，不授权重排原输出或改变格式。

允许失败时出现不完整消息或缺少结束消息；已经写出的字节不回滚。局部非 BrokenPipe 错误之后仍可继续其他输入或 summary，所以不完整内容不一定只在流末尾，不能保证后续输出可按正常 JSON Lines 重新同步。库 `write_message` 在序列化后对 LF 进行一次 `Write::write`，未另检验返回数为 1；对于返回 `Ok(0)` 的合格自定义 Writer，P 不重试也不主动转成 WriteZero。此公开回调观察不能由“返回成功就一定写了完整一行”覆盖。CLI 的真实 stdout、并行块及错误处理仍按其实际供给接合。

CLI 为每次搜索创建 sink；库调用者却可复用同一 JSONSink。P 的 begin 不重置已发 begin 标志或累计 stats，后一次搜索可有 match/end 而无新的 begin，end.stats.searches 也可大于 1。不能把 CLI 的新 sink 分组条件强加给所有 PrinterMessage 流。

| 统计观察 | 本格式的真实含义 |
| --- | --- |
| `searches` | 完成到 sink.finish 的搜索次数；错误提前结束不自动计入。 |
| `searches_with_match` | 上述搜索中有相应 matched 结果的次数；不从 stdout 是否为空推导。 |
| `bytes_searched` | finish.byte_count 给出的已搜索字节数；不等于底层所有读取、预读或原压缩文件字节。 |
| `matched_lines` | 报告匹配涉及的行数，跨行匹配包含所参与各行。 |
| `matches` | 普通 JSON 在 matched 观察上累计其子匹配数；倒置选中行可以贡献零。quiet+JSON 采用 SummarySink，按相应上下文重新计数且每次 matched 至少贡献一，不能强行与普通 JSON 的 submatches 总数相等。 |
| `bytes_printed` | 对应输出计数器接受的字节，采样及目标接收边界如下；不是外部观察到的全文长度。 |

quiet 的二进制 quit 可清除用于 selected 的匹配计数而保留已经累计的统计，stats 不反向决定退出。计数的完整来源仍须与真实搜索/上下文定义接合，格式检查不替代它。

`end.stats.bytes_printed` 在写该 end 前取得，不含该 end 自身。统计数值并不等于把已收到的 JSON 行重新计数：无匹配输入可无 begin/end 但贡献搜索统计；搜索/预处理收尾错误可能使已经出现的 end 没有进入最终累计；并行共享 stdout 的实际写入结果也不能由内部计数直接替代。累计只沿同次真实搜索返回结果形成，不要求作者维护内部 CounterWriter。

`stats.elapsed` 累计各次搜索时间，`summary.elapsed_total` 是整次搜索经过时间，二者不同，并行时不得互换。Duration 的 `secs/nanos` 保持精确分量且 `0 ≤ nanos < 10^9`。上游公开说明不指定 human 的文本格式，Schema 只核字符串类型及数值分量范围；显示不能作为额外精确时钟。固定 P 对相应浮点秒数保留六位小数并加 `s`，Stats 使用 `NiceDuration::fractional_seconds`，summary 使用 `Duration::as_secs_f64`；这是当前版本的显示事实，不据此给所有合格实现增加六位小数或特定舍入算法的永久要求。

quiet+JSON、不可匹配快捷结果、summary 写失败、选择结果与 stdout 的区别复用 COMMAND，不另复制退出政策。筛选次序、匹配/替换的全部算法独立含义、跨行/编码/压缩/预处理、二进制与上下文边界仍须由对应产品定义补齐；本格式不能充当完整搜索规格。

## 解释、生成与再次修改的接合

普通格式检查可以直接解析本 Schema，并选择 CommandMessage 或 PrinterMessage 验证一个完整值。真实输出观察还须保存原字节与输入发生关系；只保留解码值会丢掉 framing、部分写入、转义和整数词法观察。含义解释从所选 Schema 及本文取得对应消息类型、输入字节/路径、offset、替换与统计映射，将这些贡献交现有 MeaningResult/BoundaryView；不在编译期读取未来 stdout，也不把一个格式正确的值当作实际搜索结果。

实现供给须在同一搜索、路径及替换决定下产生这些观察，并保持真实 Write/错误/退出关系；格式引用不选择一个新的打印器算法。后续只改 P→Q 路径决定时，本格式及未变 Schema 可复用；受影响的是选择哪些输入、如何关联 path/内容及其下游消息和统计，不能仅凭格式未变便沿用全产品等价结论。

当前具有可消费的原生格式结构及准确产品说明；固定 Gift 解释方法、完整搜索关系、输出目标及库/CLI 全域保持尚未取得。没有填写空 interpretation 或测试成功标志来掩盖这些缺项。结构检查、源审查、参考产品运行与生成产品运行必须分别报告。

| 固定 P 来源 | 本定义取得的事实 |
| --- | --- |
| `crates/printer/src/jsont.rs:11–218` | 消息、必需/null/省略字段、Data 及平台路径转换 |
| `crates/printer/src/jsont.rs:227–276` | 标准 Base64 字母表、填充及零填充位 |
| `crates/printer/src/json.rs:25–92, 504–558` | builder 默认、公开 sink 路径、pretty 与 LF 写入 |
| `crates/printer/src/json.rs:708–895` | begin/match/context/end 的关系、替换与统计采样 |
| `crates/printer/src/stats.rs:150–171`；`util.rs:372–403` | Stats 与 Duration 格式及浮点显示 |
| `crates/core/main.rs:107–227, 433–458` | 统计汇合、错误与 CLI summary |
| `crates/core/search.rs`；`crates/ignore/src/walk.rs:137–143` | CLI 的 sink_with_path 与 stdin 显示路径 |

这些来源是固定对照，不是要求目标工程保留原打印器源码。当前 Schema 也不是对未来 ripgrep 版本的宽松兼容承诺。
