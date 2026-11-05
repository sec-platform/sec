# Rust 标准原语

当前状态：本目录是任务中手写的接合候选与验证参考，**不是已由Gift生成的目标产物，也不再被认可为最终Gift作者工程的生产供给**。用户指出的作者/产物边界问题已确认；写入已停止，后续由真实标准库/外部接口导入及共同Target降低取代这些包装依赖。下方记录原候选的签名、理由与有限证据，供迁移审计使用，不签发其继续作为作者源的资格。

本目录只提供真实 Rust 标准类型、机器操作、借用、容器与平台路径表示；普通函数签名由 [machine.rs](machine.rs) 和 [path.rs](path.rs) 的 Rust compiler 输入拥有。[lib.rs](lib.rs) 是有界编译入口，禁止 unsafe。这里没有 Match、Captures、文件名/扩展名、路径规范化、ignore 规则、格式布局或命令分派算法；这些行为由相邻 `author/` 源码承担。

工程根维护 native selection、Gift 门面、SourceProfile 和目标绑定。本目录的函数存在、Rust 编译和测试不能代签那些消费者已经闭合，也不能代签整个 ripgrep 迁移或等价。

## 导出索引与选择角色

以下只是源码导航，选择文件消费真实 Rust 声明，不从本表生成签名。`pub fn` 的角色一律为 `callable`；返回 Bool 不自动改成纯 `predicate`。类型/常量/trait 角色分别如下，平台 cfg 仍须由 compiler 确认。

| sourcePath | role | nativeExport |
| --- | --- | --- |
| machine.rs | type | Usize, U32, U64, Byte, I32, F64, Char, Str, Text, ByteSlice, ByteVector, ByteArray, Tuple1, Pair, Borrow, BorrowMut, CowBytes, CowStr, Box, Vec, Vector, VectorIter, VectorIterRev, VectorIntoIter, StrChars, HashMap, HashMapIntoIter, BuildHasherDefault, Peekable, Formatter, FormatResult, IOError, ParseIntError, TryFromIntError, Utf8Error, FromUtf8Error |
| machine.rs | constant | USIZE_ZERO, USIZE_ONE, U64_ZERO, BYTE_ZERO, BYTE_ONE, BYTE_TWO, I32_ZERO, I32_ONE, F64_ONE_BILLION |
| machine.rs | trait | AsRef, BorrowKey, BuildHasher, Clone, Copy, Debug, Default, Display, Eq, Fn, FnMut, FnOnce, Hash, Hasher, IntoIterator, Iterator, PartialEq, Sized |
| format.rs | type | DebugList, DebugStruct, DebugTuple, Formatter, FormatResult |
| path.rs | type | Path, PathBuf, OsStr, OsString |
| path.rs | trait | AsRef |

`machine.rs` 的 callable 导出按原生拼写分组：

- 借用/值：`read_copy`, `read_copy_mut`, `write_value`, `clone_value`, `take_value`, `replace_value`, `box_new`, `box_borrow`, `box_into_inner`, `with_borrow`, `with_borrow_mut`, `with_shared_borrow`, `borrow_shared`, `option_borrow`。
- usize：`usize_from_byte`, `usize_equal`, `usize_less_equal`, `usize_less`, `usize_add`, `usize_subtract`, `usize_checked_add`, `usize_decimal`, `usize_as_u64`。
- byte/char/bool：`byte_equal`, `byte_greater`, `byte_divide`, `byte_remainder`, `byte_as_scalar`, `char_equal`, `char_is_ascii`, `ascii_char_to_byte`, `byte_try_from_u32`, `char_from_u32`, `bool_equal`。
- u64/u32：`word_and`, `word_or`, `word_not`, `word_equal`, `word_shift_left`, `u64_from_byte`, `u64_as_byte`, `u64_equal`, `u64_xor`, `u64_wrapping_multiply`, `u64_greater`, `u64_add`, `u64_divide`, `u64_remainder`, `u64_decimal`, `u32_as_usize`, `u32_try_from_usize`。
- i32/f64：`i32_equal`, `i32_add`, `i32_decimal`, `f64_from_u32`, `f64_from_u64`, `f64_add`, `f64_divide`, `f64_greater_equal`, `f64_from_be_bytes`。
- 字节存储：`byte_slice_length`, `byte_slice_is_empty`, `byte_slice_first`, `byte_slice_get`, `byte_slice_index`, `byte_slice_last`, `byte_slice_range`, `byte_slice_range_mut`, `byte_singleton_slice`, `byte_slice_to_vector`, `byte_slice_equals_ascii`, `byte_vector_new`, `byte_vector_clone`, `byte_vector_into_text`, `byte_vector_extend`, `byte_vector_push`, `byte_vector_set`, `byte_vector_as_slice`, `byte_array_fill`, `byte_array_set`, `byte_array_as_slice`。
- Cow：`cow_bytes_from_borrowed`, `cow_bytes_from_owned`, `cow_bytes_empty_borrowed`, `cow_bytes_borrowed_view`, `cow_bytes_view`, `cow_bytes_to_mut`, `cow_bytes_clone`。
- Vec/迭代器：`vector_new`, `vector_clear`, `vector_push`, `vector_len`, `vector_get`, `vector_index`, `vector_remove`, `vector_pop`, `vector_iter`, `vector_iter_rev`, `vector_into_iter`, `vector_iter_next`, `vector_iter_rev_next`, `iterator_next`, `into_iterator`, `iterator_peekable`, `iterator_peek`, `usize_vector_extend`, `usize_vector_sort`, `usize_vector_sort_unstable`, `usize_vector_dedup`。
- HashMap：`build_hasher_default_new`, `hash_map_with_hasher`, `hash_map_entry_or_insert`, `hash_map_get`, `hash_map_get_mut`, `hash_map_insert`, `hash_map_contains_key`, `hash_map_length`, `hash_map_into_iter`。
- 文本：`text_as_str`, `text_new`, `text_push_str`, `text_vector_join`, `str_to_owned`, `str_byte_length`, `str_chars`, `str_trim_start_matches`, `str_replace`, `text_clone`, `cow_str_as_str`, `str_to_scalars`, `str_trim_end`, `str_starts_with`, `str_ends_with`, `str_contains`, `str_equal_text`, `str_find`, `str_drop_first_scalar`, `str_drop_last_scalar`, `text_starts_with`, `text_ends_with`, `text_replace`, `text_trim_start_matches`, `text_trim_end_unicode_whitespace`, `text_utf8_bytes`, `str_range`, `str_from_utf8`, `utf8_error_valid_up_to`, `utf8_error_debug`, `parse_u32`, `char_display`, `char_debug`, `text_debug`。
- Fault 出口：`panic`。

`path.rs` 的 callable 导出：`as_ref_path`, `as_path`, `as_os_str`, `os_string_as_os_str`, `parent`, `has_root`, `to_path_buf`, `clone`, `clone_optional_path_buf`, `equal`, `equal_text`, `is_empty`, `is_file`, `path_from_str`, `join_text`, `from_text`, `from_os_string`, `into_os_string`, `to_utf8`, `os_str_to_str`, `os_str_to_owned`, `os_string_is_empty`, `os_string_vector_debug`, `os_str_to_string_lossy`, `to_string_lossy_owned`, `display`, `path_as_bytes_lossy`, `is_unix_target`, `is_separator_scalar`；Unix 另有 `os_str_as_bytes`, `os_str_from_bytes`, `os_string_from_bytes`, `os_string_into_bytes`；Windows 另有 `os_str_encode_wide`, `os_string_from_wide`。

`format.rs` 的 callable 导出：`write_text`, `write_usize`, `write_display`, `display_fmt`, `display_to_text`, `write_f64_fixed`, `f64_fixed_to_text`, `debug_struct`, `debug_struct_field`, `debug_struct_finish`, `debug_tuple`, `debug_tuple_field`, `debug_tuple_finish`, `debug_list`, `debug_list_entry`, `debug_list_entries`, `debug_list_finish`。

现有 Gift 名的同义选择应指向相同原生导出：`UsizeSub/UsizeSubtract` → `usize_subtract`，`F64Div/F64Divide` → `f64_divide`，`ByteAsScalar/CharFromByte` → `byte_as_scalar`，`StrToText/StrToOwned` → `str_to_owned`，`PathBufFromOsString/FromOsString` → `from_os_string`。文本门面的 `Clone/StartsWith/EndsWith/Replace/TrimStartMatches/TrimEndUnicodeWhitespace/Utf8Bytes/FromUtf8/CharToText` 分别取 `text_clone/text_starts_with/text_ends_with/text_replace/text_trim_start_matches/text_trim_end_unicode_whitespace/text_utf8_bytes/str_from_utf8/char_display`，无须重复 Rust 函数。`OsStringSequenceDebug` 的准确原生实参是 Vec；`StrToScalars` 的准确原生结果是 Vec<char>；它们的 Gift Sequence 表示关系仍由 Target 负责。

## 类型、参数与借用

`Usize` 就是所选目标的 `usize`，不是固定的 u64。`U32/U64/Byte/I32/F64` 分别是原生标量。`Str`、`ByteSlice` 是 unsized 的 `str`、`[u8]`；`Text`、`ByteVector` 是标准 `String`、`Vec<u8>`。`Vec`/`Vector`、`HashMap`、`Formatter`、`FormatResult`、`IOError`、`Display`、`Sized` 都引用标准库真实身份；门面不应因为重命名再制造名义类型。HashMap 的种子/Hasher 选择仍由真实泛型使用点负责。

Rust 类型别名 `Borrow<'r,T:?Sized>` 与 `BorrowMut<'r,T:?Sized>` 的原生参数顺序是 **Region、Type**；作者现有 Type、Region 次序须由真实 Gift 类型别名重排，不能修改 compiler 的原生签名。`CowBytes<'origin>` 保留 borrowed/owned 分支；`cow_bytes_borrowed_view` 只在 borrowed 分支返回原数据区域，`cow_bytes_view` 与 `cow_bytes_to_mut` 的结果受当前 Cow 借用区域限制。不能用后者结果越过 Cow 的生存期。

`with_borrow`、`with_borrow_mut`、`with_shared_borrow` 接收真实 place 的共享/独占借用，并以 `for<'r> FnOnce(...) -> R` 同步调用一次。R 不依赖新引入的 r；回调不能把该局部借用藏入返回值。拥有值没有被移交给 helper。`with_shared_borrow` 期间父独占借用不可另用。函数的 callback 与泛型 Drop/Clone 仍有其实际效果，不因为 helper 很短就成为纯函数。

`Tuple1<T>` 是 `(T,)`，`Pair<A,B>` 是 `(A,B)`，使用原生 tuple 的 `0/1` 字段。`Fn`、`FnMut`、`FnOnce` 是 `std::ops` 相同 trait 的重导出，保持真实类型身份、Args tuple 与 `FnOnce::Output` 的关系，分别拥有共享、独占、消费调用能力。它们没有额外的 `'static` 或 noescape 承诺；闭包实际捕获、借用、可用调用及其清理规则仍须独立检查。外部作者声明若要求原生闭包类型 F，就必须保留 F，不能凭同签名的结构函数类型或新 wrapper 替代。具借用参数的高秩约束和 Rust `Fn` 族的真实降低由共同 bound owner 与 Target 负责。

本机稳定 Rust 1.97.1 对 `<F as FnOnce<Tuple1<u8>>>::Output` 的显式角括号投影报 E0658；`F: FnOnce(u8) -> bool` 等带准确参数与结果的括号形式可用。不能因为存在原生 Args tuple 就假定用户稳定源码可直接打印 `FnOnce<Tuple1<T>>`，也不能按编译器诊断的通用建议改变 tuple 的参数层级。准确投影、trait 导入与目标打印仍须由真实 Rust compiler 和 Target 确定。

`VectorIter<'origin,T>` 的元素借用保持原容器区域；`iterator_next<I: Iterator + ?Sized>` 返回真实 `I::Item`，`iterator_peek` 返回与 Peekable 当前可变借用关联的 `&I::Item`，而不是原地复制或移动元素。`VectorIntoIter`、`HashMapIntoIter` 是各自标准拥有迭代器。`take_value<T: Default>` 返回原值并留下真正的 Default；`replace_value` 返回原值，不额外丢弃它。

`Box` 为标准 `Box<T>`；`box_new` 移入真实 T 并遵循标准 Box 的分配行为，`box_borrow<T: ?Sized>` 的结果借用 box 的内容，`box_into_inner<T>` 移出 T 并处理 box 存储。它们不改变内部值的 Clone/Drop 或错误责任。

`BorrowKey` 只是标准 `std::borrow::Borrow` trait 的重导出，和上面的引用类型别名 `Borrow` 不同。HashMap 的 Get/GetMut/ContainsKey 使用 `K: Eq + Hash + BorrowKey<Q>`, `Q: ?Sized + Eq + Hash`, `S: BuildHasher`；Get/GetMut 的输出区域绑定 map，而不绑定查询 key。EntryOrInsert/Insert 要求 `K: Eq + Hash, S: BuildHasher`；WithHasher、Length、IntoIter 及 BuildHasherDefaultNew 没有凭空添加这些界限。`usize_vector_extend` 实际第二参数为 `&Vec<usize>`；`usize_vector_sort` 调用标准稳定 `sort()`，对应 ripgrep globset 的实际调用；`usize_vector_sort_unstable` 是独立的不稳定排序，不能代替前者的分配和失败语义。MathInt 与 `usize/u32`、Gift Sequence 与 `Vec` 的关系由 Target 显式确定，这些原生声明不暗中签发表示等价。

`DebugStruct/DebugTuple/DebugList<'format,'data>` 持有真实 formatter 独占借用；各 field/entry 的返回借用属于传入 builder 的短借用。builder 保留 formatter 原有 Debug 标志和累积的写入错误，finish 返回真正的 `fmt::Result`。`display_fmt(value, formatter)` 直接调用 `Display::fmt` 并转发原 formatter 标志；`write_display(formatter, value)` 与数值 helper 通过嵌套 `write!` 使用参数自己的格式，`display_to_text` 是 `format!("{}", value)`。文本 helper 直接 `write_str`；它们不宣称将外层 width/precision 施加到嵌套参数。接口实际的 `T: Debug` 包含默认 Sized 约束。

`read_copy`/`read_copy_mut` 要求实际 `T: Copy`；字段形状、Gift readonly 或“看起来没有资源”不自行授予这一资格。`clone_value` 是实际 `T: Clone` 调用，可能有用户行为。`write_value` 是正常赋值，包含旧值的 Drop。需要从私有表示复制却不公开 Copy 的项目类型，应由 Target 为其真实内部表示证明资格；本模块不绕过 Rust 类型系统。

字段名选择、移动字段、常量 bytes/text 的编译期静态存储和任意 record 投影不是普通 Rust 泛型函数。这里不提供 `BorrowField`、`WithFieldBorrowMut`、`ConsumeField` 或伪造的 `StaticBytes<V,r>`。相交作者调用由协调 owner 的准确 native macro/Target 合同处理，不能以 unsafe 偏移或任填生命周期补齐。

## 运算与容器

普通 `usize/i32/u64` 加减、整数除余与移位直接使用原 Rust 运算符。它们消费实际目标的 overflow-checks/profile，并保留零除和边界失败；只有 `usize_checked_add` 明确返回 Option。`u64_as_byte`、`u32_as_usize` 和 `usize_as_u64` 是 Rust `as`，不是带运行检查的转换；调用者若要求无损，必须证明准确值域。F64 采用原转换、加法、除法与舍入，不重排表达式。`ByteArray<N>` 的 N 是原生 const usize，作者数学整数实参须通过真实常量求值和目标范围检查。

切片与 str 的 range 是原半开索引，包括 UTF-8 字节边界检查和原存储身份。`byte_slice_get` 复制单个 byte 并在越界时给 None；`vector_get` 返回 Option 借用，不暗中 Clone T。`VectorIter`/`VectorIterRev` 及其 next 函数是标准 slice iterator，返回值的区域来自原容器。追加和写入操作修改传入的同一个 Vec/array，并保留分配、panic 和别名规则。`byte_slice_equals_ascii` 执行准确 UTF-8 bytes 相等，实际当前作者调用使用 ASCII 常量；没有隐式大小写折叠。

`str_from_utf8`、`parse_u32` 与错误 Debug 直接使用标准库；u32 解析失败类型没有被改成 Bool 或项目错误。数值十进制及 char/text Debug 直接消费标准 formatter。`panic(String)` 是普通目标 panic，保留所选 panic hook/unwind/abort 路径并标注 caller；具体原调用的静态消息 payload 类型、源位置映射和额外文本分配仍须由 Target 资格核对，不能仅按消息相等宣称完全相同。

`str_trim_start_matches<'view>(&'view str, &str) -> &'view str` 保留原输入存储与区域，按照标准规则重复去除匹配的前缀；pattern 不决定输出区域。`str_replace(&str, &str, &str) -> String` 借用三项输入并产生新字符串；拥有 String 的调用点需提供其实际短借用。`text_new`、`text_push_str`、`text_vector_join(&Vec<String>, &str)` 是真实标准字符串操作，各有自己的分配与写入行为；把它们组合成某个原有 `format!` 仍需证明参数求值顺序、异常与输出，而不能仅凭文字相同代签。

## 平台路径

`Path/PathBuf/OsStr/OsString` 保持标准身份。严格 `to_str`/`to_utf8` 不进行 lossy 转换；拥有 Text 结果实际复制。`parent/has_root/join/equal/display` 等直接使用标准库，并不实现 ripgrep 自有的 file_name、hidden 或 normalize 规则。`AsRef` 是原来的泛型标准 trait；`as_ref_path<P: AsRef<Path>>` 不能变成另一条私有 blanket trait 身份。

`path_from_str` 返回借用输入字符串的 Path；`is_file` 是实际文件系统查询，遵循标准库符号链接与错误处理，查询失败返回 false，不是纯路径谓词。

`path_as_bytes_lossy` **直接调用 bstr 的 `Vec::from_path_lossy`**。本工程 P 的锁定依赖为 bstr 1.13.0，checksum `1f7dc094d718f2e1c1559ad110e27eeaae14a5465d3d56dd6dbd793079fbd530`。Unix 分支借用原始任意 bytes；非 Unix 沿该库原 `OsStr::to_string_lossy`，并保留 Cow 分支及替换字符行为。不能把这条依赖从 native 输入闭包中省略。

无损路径表示单独使用目标能力：Unix `os_str_as_bytes`/`os_str_from_bytes` 与 OsString 的 Vec 转换；Windows `os_str_encode_wide`/`os_string_from_wide` 保留含孤立 surrogate 的 16-bit code units。两组导出按 cfg 存在，不能给错误平台登记伪实现。这里没有将 Windows 的内部编码偷换成公共 UTF-8 或 Unix bytes。

## 有界验证

本机已有 `rustc 1.97.1 (8bab26f4f 2026-07-14)`，host 为 `x86_64-pc-windows-gnu`。此前 `machine.rs` SHA-256 `D23934B0402DB61967A7F90E754B99EFA8A33514809545EF370B6601B1203BA1` 的版本使用现有 bstr 缓存编译并执行 **16 个单元测试**、**5 个 compile_fail 用例**，独立正向链接和五个失败原因检查通过；其证据不能直接绑定后续新增 Fn 族与 Tuple1 的版本。此前测试覆盖的能力范围仍见对应模块的测试源码。

针对新增 Fn 族与 Tuple1，当前 `machine.rs` SHA-256 `D1F8E27F477946993D96365B75D3C47C30737F40668D0E3EB7FC9C1FC3EAEE73` 随原入口及缓存 bstr 编成 rlib。外部独立焦点 harness 从公开模块导入三种标准 trait 和 tuple 类型，**3 个测试通过**：共享/独占/消费调用及准确返回；同一 F 接受独立短借用并捕获非 `'static` 环境；保留 F 的大小与类型名并允许合法 `mem::forget`。另外三份负向输入分别得到错误返回类型 E0308、把仅能消费一次的闭包当 FnMut 的 E0507、把只接受 `'static` 独占引用的函数当高秩 FnMut 的“not general enough”。明确的 `FnOnce::Output` 角括号投影另得到上述 E0658；正向返回类型通过稳定的 FnOnce 括号签名约束，未冒称该投影语法在稳定 Rust 上可用。本轮没有重跑整个单元或 rustdoc 集合。

编译通过只证明本次 Rust 输入和工具链的局部资格。`is_file` 与 `path_from_str` 尚未单独验证文件系统边界；Unix cfg 测试未在本机执行；没有跨平台、完整 Gift Reader/linker、原生签名 importer、ownership/effect、生成 Target 或全工程运行证据。此前验证产物保留在 `.tmp/whole-engineering-20261025/native-support/terra-native-closeout-20261027/`；本轮保留 `.tmp/whole-engineering-20261025/native-support/fn-traits-20261027/` 内 rlib、测试 exe 及正负向 Rust 输入。这些缓存不能被当成新的依赖身份或供给注册表。
