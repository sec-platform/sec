# 命令行工具库的产品合同

本源拥有固定 P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 grep-cli 公开工具含义：外部进程读取、解压、字节转义、模式来源、大小解析、主机/终端与标准输出，以及 rg 的真实消费。使用本库不自动取得命令的 argv、quiet、selected、错误累计或退出政策；[参数来源](../intent/ARGUMENT-SOURCES.md)与[命令合同](../intent/COMMAND.md)继续拥有这些关系。当前为设计源，完整机器声明、固定解释与目标接合未完成。

## 外部命令读取

CommandReaderBuilder 从调用者给定的真实 Command 启动直接子进程，覆盖 stdout/stderr 为管道，不覆盖 stdin，也不补 shell 命令。程序、参数、环境、cwd 与 stdin 仍来自该 Command。spawn 失败返回 CommandError，但不回滚已改的管道配置；得到 reader 不证明进程已经或最终正常结束。

new/Default 的实际默认为 **async_stderr=false**，CommandReader::new 继承它；固定 P 的公开注释所称默认异步与派生 Default 不符。同步模式不同时排空 stderr，可能因管道填满而阻塞；异步模式另开线程将全部 stderr 读入堆，没有本库声明的容量上限。线程创建、读取线程 panic 不统一转成普通 CommandError。设置只影响后继构造。

Read 交付真实 stdout 字节，后继状态或读取错误不撤回已交付内容。stdout 读错误直接返回，不在该分支自动 close；后继显式 close 或 Drop 仍承担尝试。底层返回 Ok(0) 时，reader 先标记 EOF，再 close，只有 close 成功才返回 Ok(0)；全部 stdout 已交付后的最后一次 read 仍可能返回 Err。**零长缓冲使底层返回零时也进入这条 EOF/close 路径**，不属于无作用探测。

## close、stderr 与错误优先

close 先取走并关闭 stdout 管道，再等待直接子进程；没有主动 kill、timeout 或进程树协议。关闭可能促使仍输出的进程发生管道错误，不承诺 portable 信号身份。

| 实际条件 | 结果 |
| --- | --- |
| stdout 已取走 | 直接 Ok，不再次等待或读取 stderr |
| 等待失败 | 返回等待 IO 错误；stdout 已取走，后继 close 不重试 |
| 成功状态 | Ok，不在此读取或 join stderr 线程，也不把 stderr 当错误 |
| 非成功状态 | 同步读取完整 stderr，或取得异步线程结果；该读取失败优先返回其 IO 错误 |
| 非成功、未经过 stdout 返回零，且 stderr 原字节长度为零 | 按提前停止读取的兼容例外返回 Ok，不检查具体退出码或信号 |
| 其余非成功状态 | 返回包含 stderr 的错误，包括 EOF 后的空 stderr |

空白但非空 stderr 不满足提前关闭例外，即使 Display 最后显示 `<stderr is empty>`。后继 close 的 Ok 不覆盖首次错误，也不证明失败已恢复。Drop 尝试 close，并将错误交 log::warn；是否显示及显示位置由 logger 决定，不保证直接写 stderr。显式 close 已取走 stdout 后，Drop 不再次报告同一错误。

直接子进程成功、reader 释放、异步 stderr 线程结束、继承管道的后代结束及全部作用结算分别成立。成功分支不 join stderr 线程；不退出的进程没有有限时间完成保证。

CommandError 的内部 IO/stderr 分类、原 stderr 字节和 ExitStatus 不是公开可读字段。公开 Debug/Display/Error 与 IO 转换保持：IO 分支 Display 委托原错误，往返转换恢复原 IO 错误；stderr 分支有损 UTF-8 后 trim，为空显示上述文本，否则由两条 79 个连字符包围，转 io::Error 为 Other 并携带 CommandError。非零状态不直接成为 rg 退出码或错误累计。

## 解压规则与程序路径

DecompressionMatcherBuilder 先加默认关联，再加自定义关联；同路径多项匹配时最后加入者优先。defaults(false) 只保留自定义项；build 按 [globset](globset-contract.md) 编译，错误转 CommandError。路径关联不读取压缩 magic，也不证明扩展名对应内容。

| 路径 glob | 程序与固定参数 |
| --- | --- |
| `*.gz`、`*.tgz` | `gzip -d -c` |
| `*.bz2`、`*.tbz2` | `bzip2 -d -c` |
| `*.xz`、`*.txz` | `xz -d -c` |
| `*.lz4` | `lz4 -d -c` |
| `*.lzma` | `xz --format=lzma -d -c` |
| `*.br` | `brotli -d -c` |
| `*.zst`、`*.zstd` | `zstd -q -d -c` |
| `*.Z` | `uncompress -c` |

try_associate 先解析程序，失败不加入；associate 忽略该错误并放弃关联。这里不编译 glob，故程序可解析而 glob 非法仍在 build 报错，不能概括为所有无效规则都被静默忽略。

command(path) 只选规则并构造带程序与固定参数的新 Command，**不追加 path、不打开或启动**。has_command 只证明规则匹配。reader build 才追加实际路径并启动，不额外插入 `--`，不经 shell 拼接。

公开 resolve_binary 在非 Windows 直接返回原路径，不查 PATH/存在。Windows 公开调用和所有平台的自定义关联内部解析则搜索 PATH：绝对路径直接返回且不核存在；PATH 缺失报错，空成员跳过，非空相对成员允许，结果可仍相对。先查原名，无扩展名再试 `.com`、`.exe`，不是完整 PATHEXT。候选仅要求 metadata 可取且不是目录，不检查执行位、ACL 或内容身份，不证明后继可启动或程序未变。

非 Windows 默认关联可保留不存在的程序名，启动时再暴露；Windows 解析失败的默认项记 debug 后不加入。关联形成、后继使用和启动不共享一个隐含的不变 PATH/文件系统快照。

## 解压 reader 与透传

DecompressionReaderBuilder 的 new/Default 包含默认 matcher 与 CommandReaderBuilder，故实际同样 async_stderr=false。matcher 完整替换当前规则，get_matcher 返回当前 matcher；build 可重复使用它。无关联时直接打开原文件；有关联时启动程序，**spawn 失败只记 debug，再尝试原文件透传**，若打开失败则返回文件 IO 错误。DecompressionReader::new 也如此，不能沿局部注释将所有 spawn 失败写成 Err。

成功启动后的解压、stdout 或状态错误不回退重读原文件，不撤销部分解压数据。进程分支 read/close/Drop 沿 CommandReader；File 透传分支 close **只返回 Ok，不关闭 File、不推进 EOF**，后继 read 可继续，释放时才按拥有关系关闭。本库不安装外部解压器，不把透传称为已解压。

## rg 的实际使用

SearchWorkerBuilder 对预处理与解压读取器显式设置 async_stderr(true)，不同于独立库默认。stdin 直接读取；其他路径满足预处理选择时预处理，否则按解压开关和 matcher 选择，再否则直接搜索路径。两种处理不自动适用于 stdin，也不是无条件叠加。

预处理先打开原文件作 stdin，并将路径作为参数；文件打开可早于 spawn 失败，已发生 IO 不撤销。解压按前节向所选命令追加路径。两路取得 search 结果后都先调用 close：search 错误优先，其次 close 错误，二者成功才返回搜索结果。错误优先不表示跳过 close。预处理启动和搜索错误增加相应命令上下文，后继 close 错误不自动有相同包装。如何累计、诊断和退出由 COMMAND 拥有。

## 模式来源

pattern_from_bytes 仅验证 UTF-8 并借用 Text，不编译正则或 unescape。InvalidPatternError 保存转义显示及 Utf8Error::valid_up_to，即原字节首个未通过位置。pattern_from_os 成功也借用 Text，失败却以有损串**首个 U+FFFD 的字节位置**记录；原文先含合法 U+FFFD 时，这不保证等于首个原生非法位置。valid_up_to 返回保存值；错误公开 Clone/Debug/Eq/PartialEq/Display/Error，可转 IO Other。

patterns_from_reader 自行缓冲，按 LF 分行，删 LF 或完整 CRLF，保留裸 CR；每行验证 UTF-8，保序、重复、空行、其他空白与 BOM，不去注释或 trim。空输入没有模式，末尾终止符不额外加空项，未终止的最终非空行仍是模式。无效 UTF-8 错误带一基行号，底层读错沿 IO 传播；失败不交付前面累计的 Vec，但输入消费不回滚。

patterns_from_path 打开普通路径并补路径错误上下文，`-` 在此不是 stdin。patterns_from_stdin 明确锁定当前 stdin，错误补 `<stdin>`；CLI 是否/何时打开和是否跳过由原命令 owner 决定。

## 转义与大小

escape/unescape 不是正则转义、shell quoting、JSON 编码或路径规范化。锁定 bstr 的 escape 保留有效非 ASCII UTF-8、除反斜杠外的可见 ASCII；NUL/LF/CR/TAB/反斜杠分别为 `\0`、`\n`、`\r`、`\t`、`\\`。空格、其他需转义 ASCII 和非法 UTF-8 字节使用大写两位 `\xHH`。unescape 接受这些短写与恰两位十六进制；非法/不完整转义保留原文本，不统一报错，不解释 `\u{...}`。字节上 unescape(escape(x))=x，反向不保持原非规范拼写。escape_os 在 Unix 取原字节，其他平台有损转换；unescape_os 先有损转 Text，不保证任意原生 OS 串可逆。

parse_human_readable_size 接受非空 ASCII 数字及可选大写 K/M/G，分别乘 2^10/2^20/2^30，结果 u64；不 trim，不接受符号、小数、小写或其他单位。数字解析先于后缀验证，数字溢出和未知后缀的错误优先保持。ParseSizeError 保存原串与格式/整数解析/乘法溢出差异，公开 Clone/Debug/Eq/PartialEq/Display/Error，转 IO Other；内部分类不是公开枚举，解析值不签资源保证。

## 主机、终端与标准流

hostname 返回平台 OsString，不是可信设备身份。Windows 用 PhysicalDnsHostname；Unix 用锁定 libc 的 sysconf/gethostname，要求缓冲最终含 NUL，保留对应 IO 错误；sysconf=-1 未区分无限制与错误。其他平台为不支持错误。

is_readable_stdin 不读正文：先排除终端，Unix 成功克隆描述符/取得 metadata 后仅将普通文件、FIFO、socket 视为候选；Windows 检查 disk/pipe；其他平台或观察失败为 false。false 不证明 EOF，true 不保证后继不阻塞。三个已弃用 is_tty 包装只委托 IsTerminal，不签颜色或输入消费权限。

stdout(color_choice) 在构造时按真实 stdout 是否终端选择行/块缓冲，两个显式 buffered 构造器固定策略；ColorChoice 交 termcolor。StandardStream 的 Debug、Write.write/flush 和 WriteColor 的颜色/链接能力、set_color/set_hyperlink/reset/is_synchronous 转交实际 writer。write 可部分成功，flush 独立；能力查询不证明展示，wrapper 不增加跨线程整块原子性或 stdout/stderr 全序。终端与控制台差异由准确 termcolor/平台供给承担。

## 公开覆盖与证据边界

| 公开范围 | 固定 P 来源 |
| --- | --- |
| CommandError、Builder new/Default/Clone/Debug/build/async_stderr、Reader new/close/Read/Drop/Debug | crates/cli/src/process.rs:11–318 |
| DecompressionMatcherBuilder/Matcher 的构造、派生、关联、build、command/has_command | decompress.rs:15–193 |
| DecompressionReaderBuilder/Reader 的构造、派生、matcher/get_matcher、async_stderr、build/read/close，以及 resolve_binary | decompress.rs:198–533 |
| InvalidPatternError、五个模式入口及转换 | pattern.rs:12–158 |
| escape/escape_os/unescape/unescape_os | escape.rs:26–79 |
| ParseSizeError 与大小解析 | human.rs:6–101 |
| hostname、stdin 与 tty | hostname.rs:16–75；lib.rs:170–295 |
| StandardStream、三个 stdout 构造器、Write/WriteColor | wtr.rs:7–149 |
| CLI 异步选择、输入分流、打开/启动、close 与错误优先 | crates/core/search.rs:54–80、245–340 |

本次逐读全部 cli 生产模块及相交 core/search。转义和分行另核锁定 bstr 1.13.0 的 escape_bytes.rs/ext_vec.rs/io.rs；所读成员与 Cargo.lock 对应归档逐字节一致，归档 SHA256 为 `1f7dc094d718f2e1c1559ad110e27eeaae14a5465d3d56dd6dbd793079fbd530`。这只支持相交静态含义，不等于完整审计 bstr/termcolor/libc/标准库或压缩程序。

未运行进程、解压、终端或死锁/短写实验。真实程序身份、平台管道、线程/进程结束、资源和目标 ABI 仍需准确供给及保持证据；一次 close、成功状态、来源捕获或空能力名不代签。注释与实现差额按本次兼容范围保留，不据此修改参考 Rust。
