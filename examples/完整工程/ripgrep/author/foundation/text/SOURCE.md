# 共享 ASCII、UTF-8 与 byte hex 作者源码

[conversions.module.json](conversions.module.json) 是 `ripgrep:foundation:text` 的当前作者模块，使用 `gift.author-module/design-converged` 完整 AST。它含 9 个实际纯函数体和 1 个公开错误类型；通过真实 `exports` 表供 JSON `ModuleImport` 消费。这里不占有所有文本功能：命令层所需 `TrimEndUnicodeWhitespace` 仍为 **OPEN**，没有放入空实现或冒名导出。

本次共享需求来自 P=`4c2362d359d9913c7a5e391ccd79cb4da22bc89b` 的 `crates/globset/src/glob.rs:768–789`：`char_to_escaped_literal` 使用 `char::encode_utf8`；`bytes_to_escaped_literal` 把 ASCII byte 变为字符，把其余 byte 写成两位小写 hex。本模块只拥有这三种值转换；regex 元字符逃逸、`\x` 前缀和 glob 渲染次序仍由真正 glob 作者模块决定。

## 导出和拒绝域

Int 是无 bits 的数学有符号整数，不是机器 Byte/usize。实际导出为：

| 名称 | 签名 | 成功域与值 |
| --- | --- | --- |
| `ScalarUtf8` | `Int → Result<ordered Sequence<Int>, ConversionError>` | 0..0x10FFFF，排除 0xD800..0xDFFF；返回 1–4 个 0..255 的 byte 整数，顺序为最短 UTF-8 编码 |
| `AsciiText` | `Int → Result<Text, ConversionError>` | 0..127；返回恰一个对应 ASCII 标量，包括 NUL、C0 和 DEL，不 trim、不丢控制字符 |
| `ByteHexLower` | `Int → Result<Text, ConversionError>` | 0..255；返回恰两个小写十六进制字符，前导零保留，没有 `0x`/`\x` 前缀 |
| `ConversionError` | 闭合 variant | `InvalidScalar(Int)`、`InvalidAscii(Int)`、`InvalidByte(Int)`、`ArithmeticInvariant(Unit)` |

前三种错误保存原始输入 Int；域检查在转换、除法、序列构造和拼接之前完成。没有把无效值模 256、夹紧、替换为 U+FFFD、返回空串或静默忽略。Unicode noncharacter（包括 U+FFFE/U+FFFF 和每个补充平面的末尾）仍是合法 scalar，不能额外拒绝。

显式 Result 是本工程真实接口决定。当前 `Contract.requires` 只有 Ref 数组，不能仅凭某个谓词名称猜它如何绑定到参数，然后把运行拒绝假装已实现。原 Rust 的 char/u8 在类型上排除了相应无效输入；本模块扩大到数学 Int 时明确检查，没有把原先不可能的值交给不受限原生调用。

glob 消费者须 match Ok/Err。即使前序 parser 已证明 scalar 域，也保留真正 Err 传播或独立成立的消解依据，不 `unwrap`、panic、返回空串或调用不具名失败供应。已对齐的 glob 接合把转换错误映射为 `BuildError.Encoding(ConversionError)`；该消费实现及最终工程锁仍由 glob/工程拥有者检查。

## 实际算法与有限映射

`ScalarUtf8` 先调用 `IsUnicodeScalar`，成功后进入 `EncodeScalarValid`。后者按 `<128`、`<2048`、`<65536` 分成 1/2/3/4 byte。非 ASCII 路径按低位到高位依次取得 base-64 quotient/remainder，再按高位到低位构造输出：

| 长度 | 输出 |
| --- | --- |
| 1 | `code` |
| 2 | `192+q0`, `128+r0`，其中 `(q0,r0)=divmod(code,64)` |
| 3 | `224+q1`, `128+r1`, `128+r0`，其中 `(q1,r1)=divmod(q0,64)` |
| 4 | `240+q2`, `128+r2`, `128+r1`, `128+r0`，其中 `(q2,r2)=divmod(q1,64)` |

各除数是严格正的常量 64。两字节最低输入 128，使首字节至少 C2；三字节最低输入 2048；四字节最低输入 65536，最高输入 0x10FFFF 使首字节不超过 F4。配合 surrogate 拒绝，这些分段直接排除 overlong、surrogate encoding 和超出 Unicode 上界的序列。序列建立使用明确 Int 实参的 SeqEmpty/SeqPrepend；没有宿主数组编码暗换 bytes 类型。

`AsciiLookup` 是私有平衡选择树，叶子恰为 U+0000..U+007F 的 128 个 Text 字面量，顺序由数值区间决定；有效输入最多经过 7 个树内比较。它是 ASCII 定义的完整有限映射，**不是根据 ripgrep 测试样例填出的输入特判表**。JSON 中的 `\u0000`、`\n`、引号和反斜线只是字面量编码；消费后的 Text 必须保留对应单个标量。私有入口只由已经完成 0..127 检查的 AsciiText 调用，未作为无限 Int 域公共接口导出。

`ByteHexLower` 在 0..255 检查后除以 16，先查 quotient 对应的高位字符，再查 remainder 对应的低位字符，最后 TextConcat。私有 `HexNibble` 同样是一棵完整 0..15 映射树，叶子为 `0`..`9`,`a`..`f`，所有实际调用实参已由商余数界证明属于该域。

`DivModPositive` 显式 match 标准 IntDivMod 的 Result；Err 映射为 ArithmeticInvariant，所有调用链立即传播，不构造部分成功值。本模块实际除数只有 16/64；按现行非零除法合同，该防御分支不可由正常输入触发，但源码和消费者没有用 panic 假设替代它。局部故障注入只检验这一分支的传播，不宣称合格 IntDivMod 会对非零除数返回除零错误。

全部函数无递归、无循环、无外部资源或修改、无消息与 IO；计算图有限，`termination:total` 的源码理由是有限分支/最多三次除法/有限序列构造。这个声明仍不是生产 checker 已签发的证明，也不承诺无限内存或取消不可发生。无外部 Effect 不授予把域检查后的运算任意提前执行的许可。

## 真实标准接合与字段资格

唯一使用的保留名称是现行[固定纯基底](../../../../../../docs/领域/计算基础/文法类型与求值.md#successor-structured-std-int-add)中的 `std:IntCompare`、`std:IntAdd`、`std:IntDivMod`、`std:SeqEmpty`、`std:SeqPrepend`、`std:TextConcat`。没有假造 CharFromInt、EncodeUtf8、FormatHex、TextAt、panic 等标准名称；也没有声明 native ripgrep callback。

IntCompare 返回 Less/Equal/Greater 的 Ordering，必须经 match 转 Bool；IntDivMod 返回 Ok 的 `{quot:Int,rem:Int}` 或 Err，必须经 match 消费。`Expr.field` 只读取已知不可变数学 Int 记录中的 quot/rem，没有移出未知 non-Copy 资源再复用父对象。三函数不需要 Region 或外部生命周期供应。

实际 Method/Target 仍须绑定共同 Result/Ordering 构造身份、精确数学 Int/欧几里得商余数、次序保持的有限序列及 Text 标量拼接；本目录不伪造 profileRef 或供应安装事实。这里的 Text 输出均属于 ASCII，但不能将 NUL 当 C 字符串终止，不能自动增加换行或转 locale。默认合同、数值域、有限输入的纯值结果不等于生产 ABI、分配成本或整个目标已闭合。

## 独立预期、已运行范围与后续修改

[verify-conversions.py](verify-conversions.py) 是本目录保留的有界辅助验证程序，不是作者模块、生产 Reader、编译器或代码生成器。它直接求值本 JSON 使用的有限 Expr 和上述六个固定纯符号；实际结果来自作者函数体，预期来自 Python 内置 `bytes.decode('ascii')`、`chr(...).encode('utf-8', errors='strict')` 与 `format(byte,'02x')`，没有从被测模块倒推预期。

本次运行 `python -B examples/完整工程/ripgrep/author/foundation/text/verify-conversions.py` 获得以下 PASS：

| 检查 | 数量/范围 |
| --- | --- |
| ASCII 成功域 | 128，全域 |
| byte hex 成功域 | 256，全域 |
| UTF-8 成功 | 67,617；全部 BMP scalar、固定补充面采样、编码长度/各平面边界 |
| ScalarUtf8 拒绝及拒绝先于转换 | 2,053；全部 2,048 个 surrogate，负数、超上界及超大整数 |
| AsciiText 拒绝及拒绝先于转换 | 8 |
| ByteHexLower 拒绝及拒绝先于转换 | 6 |
| 防御除法错误的首错传播 | 4；2/3/4 byte UTF-8 路径与 hex |
| 本地函数实际执行 | 9/9 |

本次证据绑定 `conversions.module.json` SHA-256 `af1dd686087169fd0fc1fe5032ba020d63928136ac898ab414b5c072a6a6daf1`，验证程序 SHA-256 `b207512dbe72b96f516e07a2518d3d46821e999fadaee3638e53e155d792a9e2`。严格 JSON 拒绝重复键，并核本地调用、导出和保留符号集合；没有运行全量 Schema、生产 linker/type/Effect/Method 检查、Rust/Cargo、glob regex 引擎或 ripgrep 终端。补充平面没有全域枚举，不能将上述有限结果宣称为所有 Unicode 输入的形式证明。

再次修改以 JSON 为唯一算法真源。变更范围必须同步三个真实调用者的 Result 型及错误映射；新增 Text 操作另行给实际主体，不能因为共享 moduleId 就声称本片已供应它。值结果变化使本报告的源 hash 失效；只重跑相关转换及其真实消费者，失败回到具体分支/表/标准接合，不放宽域、不吞 Err、不修改 oracle 去迎合输出。根层 `foundation/fnv.gift` 和 `foundation/SOURCE.md` 本次未改。
