# grep-matcher 插值算法作者片

本片把 `crates/matcher/src/interpolate.rs` 的全部生产算法写入 [interpolation.module.json](interpolation.module.json)，采用现行 `gift.author-module/design-converged`、普通 import、Expr 和 ExecBody。它是可审查的作者设计源码，尚无本片的生产 Gift 编译或运行证据，不声明整个 matcher crate 或整个 ripgrep 已迁完。

固定来源是 ripgrep P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`；该源文件为 8,946 bytes、331 行，SHA-256 `873b35c9c139f4dbcaa8ed5b81882f74f03cdc0eab5d23df2e2baa598e0cdf4f`。P→Q `7155f6408d370e699795dc75e954635abfaf08a6` 在 `crates/matcher` 下无差分，因此这部分生产逻辑适用于两个检查点。检查点不是编译器按项目版本分派的条件。

ModuleId 固定为 **`ripgrep:matcher:interpolate`**，与现有 [captures-defaults.module.json](captures-defaults.module.json) 的普通导入完全相同。模块有 **3 个私有类型、10 个函数主体，唯一 export 为 `Interpolate`**。helper 数量不能当成迁移了 10 个原 Rust 方法。该文件拥有本片的唯一 Gift 算法定义；说明不隐藏额外程序，Rust 来源不作为一个已绑定的“插值供应函数”。

## 原生产源码的完整映射

以下行号均指固定 P 的 `crates/matcher/src/interpolate.rs`。

| P 范围 | Gift 定义 | 保持的实际责任 |
|---|---|---|
| 14–56 `interpolate` | `Interpolate`、`InterpolateFound`、`AppendCapture`，私有 `InterpolationStep` | 扫描 `$`、先追加前缀、处理 `$$`、解析失败时只消费 `$`、解析成功后先更新剩余视图再调用回调、循环结束追加剩余字节 |
| 64–67 `CaptureRef` | 私有 `CaptureRef<r>` | `cap` 与相对当前切片的结束下标 `end`；不把下标改为绝对原输入位置 |
| 73–76 `Ref` | 私有 `CaptureReference<r>` | `Named(Borrow<Str,r>)` 或 `Number(Usize)`；名字仍直接借用替换输入 |
| 78–83 `From<&str>` | `RefFromName<r>` | 包装同一借用，不分配或复制名字 |
| 85–90 `From<usize>` | `RefFromNumber<r>` | 包装机器整数；原返回 `Ref<'static>` 的 Number 不携带借用，可弱化到当前 r，本 helper 不声称增加公开 From impl |
| 97–134 `find_cap_ref` | `FindCaptureRef<r>` | 起始 `$`、可选开括号、最长非空 ASCII 名字、UTF-8 检查、紧邻闭括号、u32 数字解析与失败后的 Named 回退 |
| 138–143 `is_valid_cap_letter` | `IsValidCaptureLetter` | 恰接受 `0..9`、`a..z`、`A..Z`、`_`，用 uint8 比较；原 `&u8` 的值读取不引入外部身份 |
| 31、98、103、108、120 的 `.get`/比较 | `ByteEqualsAt`、`IsValidCaptureLetterAt` | 越界返回 false；不把原安全 get 改为可能 panic 的下标读取 |
| 117–118 的 `from_utf8(...).expect(...)` | `CaptureNameUtf8<r>` | 成功借出同一名字；错误保持原 expect 消息和错误 Debug 表示的 panic 责任 |

P 的测试宏、测试闭包和派生 trait 装配不是另一个生产算法。私有 `Clone/Copy/Debug/Eq/PartialEq`、两个 From impl 的 Rust 协议装配仍须由目标端在原测试/内部使用范围保持；本片不据函数名声称已自动生成这些 impl。公开 `Interpolate` 的函数边界需由 matcher crate 的原模块可见性控制，不因为本 Gift 模块 export 就新增 crate 对外 API。

## 解析、字节与失败规则

1. 空输入或不足两个字节的前缀不是引用；第一个字节不是 `$` 也不是引用。`${` 后至少需要一个合法名字字节。
2. 名字是最长的非空 `[0-9A-Za-z_]+`。`$42a` 是名字 `42a`，不是数字 42 后接 `a`。非 ASCII、NUL、空格、连字符、加号都不属于名字；不进行 Unicode 归一化或大小写转换。
3. `${name}` 必须在名字后立即出现 `}`。`${}`、`${42`、`${a b}` 都失败；`$foo}` 成功消费 `$foo`，末尾 `}` 留给普通追加；`${foo}}` 只消费第一个闭括号。
4. 名字先用 Rust `str::parse::<u32>()` 解析。成功才执行原 `as usize`；失败（包括全数字溢出）一律成为 Named，随后允许名字解析回调处理它，不把它丢弃或报告错误。`$4294967295` 是数字，`$4294967296` 是名字；前导零保留原解析规则，任意多个前导零不能仅按字符串长度判溢出。名字词法排除了 `+`，即使底层数字解析本来接受它。
5. `u32 as usize` 是目标原生转换；在比 32 位窄的可用目标上须保留截断，而非改成 checked cast。实际目标支持与 Cargo/MSRV 由工程目标资格决定，本片不硬编码 64 位。
6. 名字 UTF-8 检查发生在闭括号检查之前，源码保持此顺序。扫描仅接受 ASCII，故合法内部调用不会触发该 expect 的 Err；保留检查和 panic 分支，不改成 unchecked 转换。`debug_assert!(!replacement.is_empty())` 则由成功 memchr 找到 `$` 后的非空后缀不变量推出，无需另造业务分支。
7. 非名字区域是原始字节，任意非 UTF-8、NUL、CR/LF 都原样保留。整个 replacement 没有转成 Text。Text 仅用于不可达 UTF-8 检查失败的原 panic 文本，错误对象采用 Debug，不是 Display。

无效引用不是错误出口：`InterpolateFound` 恰追加一个 `$` 并从下一字节继续。`$$` 恰追加一个 `$` 并前进两字节；例如 `$$foo` 产生字面 `$foo`，不会再解析刚输出的 `$`。数字引用直接调用 append；名字引用恰调用一次 nameToIndex，仅 Some 时再调用 append。找不到名字会删除整个已解析引用。

## 顺序、借用和有限循环

`Interpolate` 保留原来的两个业务参数 `append`、`nameToIndex`，没有增加 Supplier 记录或全工程回调表。它们都是按值移交、同步调用的 exclusive 函数值；helper 使用 inout 同一个函数值，不克隆闭包。`append` 的精确形状为 `for<writeRegion>(Usize, BorrowMut<ByteVector,writeRegion>)->Unit`；`nameToIndex` 为 `for<nameRegion>(Borrow<Str,nameRegion>)->Option<Usize>`。每次调用的局部 Region 不能被回调保留，函数值本身的 `appendEnvironment`/`nameEnvironment` 捕获上界必须容纳真实外部借用。

这些 Region 不创建运行资源。`replacementRegion` 关联输入、名字、helper 返回的剩余切片；`destinationRegion` 关联同一个原 Vec。函数类型的参数 noescape、函数声明的 noescape 和 Param.mode 各有独立作用，不能互相代替。输入与 dst 必须满足真实 Rust 共享/独占别名规则；helper 不允许在 append 活动时保留另一个独占 reborrow。既有 Captures 默认方法的 append lambda 捕获 self/haystack；这些借用的共同有效域、回调能力的弱化以及 Fx 上界还需要真实类型/效果推导，不能由这里的表格签发。

每次找到 `$` 都先执行 `dst.extend(prefix)`，包括空前缀；随后才处理转义或引用。在成功引用分支中，`next` 后缀视图先于 nameToIndex/append 计算。每次 append 调用接收同一个 dst 对象及此前已写入的内容，可按原 `&mut Vec<u8>` 权限修改甚至清空它；nameToIndex 只接收该名字并返回索引，不能额外捕获这个已被独占借入的 dst。不能先在另一个缓冲区计算结果再一次提交。最终的 `dst.extend(remaining)` 总会发生，包括空 remaining。回调 panic、扩容/OOM 或其他非正常出口立即停止后续动作，不回滚此前修改。目标仍须保持原 panic/unwind/abort、清理、闭包 Drop 及源位置责任；本片未验证目标降低。

主循环用当前调用内的两个局部变量 `remaining`、`scanning`，以及私有 `{done,remaining}` helper 返回值表达原 break/continue。不存在持久状态或调度器。找到引用的每轮至少消费一个字节；未找到 `$` 时 done 使下一轮直接结束；名字扫描的下标单调递增且受切片长度约束。在被调用能力及回调正常返回的条件下，这些 while 有限终止，没有靠尾递归消除假定有限栈；原 FnMut 自身不返回或 panic 的行为不能被该论证抹去。下标递增只在 ByteSliceGet 返回 Some 或闭括号确实存在时发生，故增量前 end<len、结果不超过真实 slice 长度；Rust 合法 slice 的范围约束使这些 UsizeAdd 不会溢出。Region 名字本身不证明别名排斥，必须消费实际 Borrow/Mut 资格。未绑定 primitive 仍不能凭此取得任意输入下的纯/总函数资格。

## 普通导入的最小共享需求

`ripgrep:foundation:machine` 仍由共享 owner 独占。下表是源码实际引用的准确要求，**不是声明已经安装、导出、绑定或运行**。`Byte` 为 checked uint8；`U32` 为标准 u32 值域；下表的结果/错误类型需由真实导入确定相同身份。

| 导出 | 本片要求 |
|---|---|
| Usize、ByteSlice、Str、ByteVector | 准确目标 `usize`、原生 `[u8]`、`str`、`Vec<u8>`，与冻结 values/captures 使用同一身份 |
| Borrow、BorrowMut | `(Type,Region)->Type`；保持共享/独占、unsized、outlives 和 reborrow 资格 |
| UsizeFromByte、UsizeEqual、UsizeLessEqual、UsizeAdd | 分别 Byte→Usize、两 Usize→Bool、同前、两 Usize→Usize；本片转换常量只用 0/1/2，Add 只用有界下标递增；普通导出的溢出合同由共享 owner 固定 |
| ByteEqual、ByteGreater | `(Byte,Byte)->Bool`，机器无符号比较 |
| ByteSliceLength、ByteSliceGet | `<r>(Borrow<ByteSlice,r>)->Usize`；`<r>(Borrow<ByteSlice,r>,Usize)->Option<Byte>`，Get 越界 None，复制一个 byte，无分配 |
| ByteSliceRange | `<r>(Borrow<ByteSlice,r>,Usize,Usize)->Borrow<ByteSlice,r>`；半开范围，精确检查与原生越界 panic，借用同一存储 |
| ByteVectorExtend、ByteVectorPush | `<d,s>(BorrowMut<ByteVector,d>,Borrow<ByteSlice,s>)->Unit`；`<d>(BorrowMut<ByteVector,d>,Byte)->Unit`；直接追加至原对象，保持 alloc/OOM 和已有内容 |
| StrFromUtf8 | `<r>(Borrow<ByteSlice,r>)->Result<Borrow<Str,r>,Utf8Error>`；对应 `std::str::from_utf8`，零拷贝验证，Err 为真实 `std::str::Utf8Error` |
| Utf8ErrorDebug、Panic | `Utf8Error->Text` 的真实 Debug 格式；`Text->Never` 的目标 panic。目标须保持 expect 所需消息、hook 和 unwind/abort；不将异常误写为 Result |
| ParseU32、U32AsUsize | `<r>(Borrow<Str,r>)->Result<U32,ParseIntError>` 对应 `str::parse::<u32>`，真实 std 解析失败类型；`U32->Usize` 对应 `as usize`，不能按目标宽度提前改变数字解析阈值 |

外部普通模块 **`ripgrep:external:memchr`** 仅需 `Memchr<r>(Byte,Borrow<ByteSlice,r>)->Option<Usize>`，对应原依赖 `memchr::memchr`，返回第一个相同字节的相对下标，不保留输入。P 的 Cargo.lock 锁定 memchr **2.8.3**，registry checksum `cf8baf1c55e62ffcace7a9f06f4bd9cd3f0c4beb022d3b367256b91b87513d98`；此 ModuleId 是工程待绑定的普通导入身份，不冒充存在的 std module 或已安装 NativeProfile。其实现/target cfg/CPU 派发与效果证据由真实外部依赖和目标负责。它不负责 `$`、名字、括号或追加政策。

本片 std 引用只有已定义的 `BoolNot`、`TextConcat`。所有函数主体的 effects 留给完整绑定后的推导；回调 `Fx` 是上界参数，不能把 `members:[]` 加开放 tail 误读成没有效果。容器写入、分配、panic 及真实回调效应应组成实际结果；未知导入保持 NeedsEffectBound，不按函数名猜纯度。

## 逐项等价检查与证据边界

源码审查按上述全部生产分支进行了逐项推演。以下是可复查的期望，不是已执行测试结果：

| 输入/情形 | 必须保持的结果或观察 |
|---|---|
| find `$foo`、`${foo}`、`$0`、`$10`、`$42a`、`${42}a` | 分别 Named(foo)/end4、Named(foo)/end6、Number0/end2、Number10/end3、Named(42a)/end4、Number42/end5 |
| find `${42`、`${42 `、` $0 `、`$`、空白、空输入 | None；不扫描到中间 `$` 才假装是首部引用 |
| find `$4294967295`、`$4294967296`、`$0000000000000000000000000000000` | u32 最大值再转 usize、Named 的溢出字符串、Number0；不存在按长度取代标准解析 |
| `test $foo test`，foo→2，append(2) 写 xxx | `test xxx test` |
| `test$footest`、`test$2test`，对应名字不存在 | 都为 `test`，最长名字不被拆短 |
| `test${foo}test`、`test${2}test` | `testxxxtest` |
| `test $$foo test`、`test $ test`、`test ${} test`、`test ${a b} test` | 分别 `test $foo test`；后三者字节不变 |
| `$foo}`、`${foo}}` | 引用展开后保留一个 `}`；`${foo}x` 保留 x |
| 不合法 UTF-8/NUL 在名字外；在名字前/中/后 | 原字节保留；无括号名字到非法字节停止；有括号时非法字节使整个引用解析失败，随后只消费 `$` |
| `$$$foo`、连续引用、最后一字节 `$` | 转义消费2后继续真实输入、回调原顺序、最后 `$` 原样追加 |
| nameToIndex(None)、nameToIndex(Some)、append 自改 dst | 分别零次 append、恰一次 append、后续动作观察真实同一 dst；prefix 在回调前已写入 |
| nameToIndex/append panic、分配失败、空 replacement | 不执行后续追加；保留已发生写入；空 replacement 仍执行末尾空 extend |

P 的 13 个 find 测试及其后插值测试仍是独立来源；未把表格当已迁入 Gift 的测试执行器，也没有新造一个解释器来签发算法正确。当前只执行局部 JSON 严格读取、canonical Expansion、局部引用与词法作用域哨兵；成熟 Schema、实际导入类型/效果/生命周期、Method/Target 绑定、公开 trait 装配、Gift 编译和运行均由对应 consumer 验证，未执行时保持 OPEN。

本片已交付原来待写的普通 `Interpolate` 作者体；[SOURCE.md](SOURCE.md) 的接合说明由集成 owner 同步，文件存在与绑定/目标资格已完成仍是不同事实。本片写者只新增本说明和插值模块，未修改 values/captures 或原 SOURCE。其余 matcher trait/默认搜索替换/派生协议以及完整 CLI 与九库的迁移范围没有被这次算法片代签完成。
