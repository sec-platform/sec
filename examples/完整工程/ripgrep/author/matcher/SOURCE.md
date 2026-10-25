# grep-matcher 的值与捕获默认算法作者片

本片正在把 ripgrep 自有算法迁入 Gift；它不是“保留全部 Rust 就完成 Gift 开发面”的另一种表述。已写作者主体，尚未完成整个 crate 的公共 trait 接合、共享机器供给绑定或生产编译执行。本目录只拥有下面列出的值/默认算法，不声明整个 ripgrep 已完成。

基准是 ripgrep **P `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`** 的 `crates/matcher/src/lib.rs`；实际读取文件的 SHA-256 为 `56212862323457b60a008e8c45f92b2fc3d8590cb82d6d68dc0d31ac6ad97906`。`git diff P Q -- crates/matcher` 为空，故本片同样适用于 Q `7155f6408d370e699795dc75e954635abfaf08a6`。这里的 P/Q 是源码检查点，不是编译器分派条件。

## 唯一源码与交付范围

| 作者文件 | ModuleId | 本片实际内容 |
|---|---|---|
| [values.module.json](values.module.json) | `ripgrep:matcher:values` | 9 个类型定义、43 个函数主体；区间、终止符、字节集合、无捕获值、无错误值、行候选种类 |
| [captures-defaults.module.json](captures-defaults.module.json) | `ripgrep:matcher:captures_defaults` | 3 个默认算法主体；原 Captures trait 身份尚未编码完成 |

两文件选用 `gift.author-module/design-converged`，使用真实 kind-key、普通 imports、完整 Expr/ExecBody 和已有 Type.apply。短形只缩短已规定的声明外壳；没有新增表达式、伪造 std 符号、NativeRun、运行供应表或项目版本分派。完整展开是只读核对结果，不另存可写长源。`SOURCE.md` 是本片设计说明和未决，不是运行时解释器，也不能通过 annotations 为源码补隐藏程序。

`values` 的五个私有表示类型使用本轮协调 owner 正在闭合的 `core:type.body.opaque=true`。该字段需要对应准确 Schema/codec/Reader 修订；不能交旧 Reader 忽略后公开字段。此前结构缺口的准确位置是 `/2.$defs.Definition` 的 core:type body：只有 type/typeParams/visibility，而文本已经拥有 `export opaque type`。`Type.opaque(interfaceRef)` 是另一个已有类型引用构造，不是这个私有表示声明的替代品。

全部 source→Rust 关系是待目标实现消费的保持要求；没有生产 consumer 时，不能把原版 Rust 的 build/test 归功于这些 Gift 文件。原版源仍保留作来源、差分和独立 oracle；要正式替换，必须先取得以下公共接口/目标资格，再由唯一生成 owner 退役同义原生实现，不能让两份活动业务源码长期双写。

## 原源码逐项映射

以下坐标均是上述 P 的 `crates/matcher/src/lib.rs`。函数不是从行号动态解释；行号仅帮助审查。

| P 范围 | Gift 定义 | 已写行为与保持项 |
|---|---|---|
| 69–72 | Match | opaque 名义记录，start/end 均为真实目标 Usize；不公开字段构造 |
| 81–84、88–90 | MatchNew、MatchZero | start≤end 检查失败 panic；zero 两端相同 |
| 94–102 | MatchStart、MatchEnd | 读取输入借用，返回 Usize 值 |
| 111–126 | MatchWithStart、MatchWithEnd、私有 PanicOrder | 只替换指定端，先检查；失败消息保留 `a is not <= b` |
| 138–143 | MatchOffset、私有 UnwrapOffset | start 的 checked_add/unwrap 先于 end；前者失败后不求后者；两个都成功才构造结果 |
| 147–155 | MatchLen、MatchIsEmpty | end−start；检查长度等于 0；不把空区间当无匹配 |
| 158–180 | MatchIndexBytes、MatchIndexBytesMut、MatchIndexStr | 把原范围投影给通用切片能力；返回来自同一输入的只读/独占借用；str 必须检查 UTF-8 边界 |
| 68 的 Eq/PartialEq 语义 | MatchEqual | 先 start，只有相等才比较 end；公开 Rust trait 装配另核 |
| 195–205、211–252 | LineTerminator、LineTerminatorByte、LineTerminatorCRLF、LineTerminatorIsCRLF、LineTerminatorAsByte、LineTerminatorAsBytes | 本片私有表示为 `{crlf,byte}`；CRLF 构造固定 byte=10；单字节分支从真实对象字段借出，CRLF 分支从静态 0d0a 借出 |
| 263–272 | LineTerminatorIsSuffix、LineTerminatorDefault | 空 slice=false；CRLF 也只检查最后一字节 LF；默认 LF 与平台无关 |
| 194、197 的 Eq/PartialEq 语义 | LineTerminatorEqual | CRLF 与 Byte(10) 不相等；两个 Byte 按字节值相等 |
| 288–291、308–317 | ByteSet、ByteSetEmpty、ByteSetFull | 四个 u64 字，全部清零/置一；不变成不定长集合或 256 个托管 Bool |
| 323–327、341–345 | ByteSetAdd、ByteSetRemove、私有 ByteSetWord/ByteSetWithWord | bucket=byte/64，bit=byte%64；置位或清位；精确更新同一独占借用对象 |
| 331–335、349–353 | ByteSetAddAll、ByteSetRemoveAll | 包含两端；start>end 无操作；每次修改后先判 cursor==end 再增量，故 end=255 不溢出 |
| 357–361 | ByteSetContains | 对所选字的单个位求交并判非零 |
| 287 的 Clone 语义 | ByteSetClone | 复制 4×u64 的独立值；不凭此给 Rust ByteSet 添加其原来没有的公开 Copy impl |
| 468–488 | NoCaptures、NoCapturesNew、NoCapturesLen、NoCapturesGet、NoCapturesClone | 私有 unit 表示；len=0；任意 Usize get=None；无资源的独立克隆 |
| 497–515 | NoError、NoErrorDescription、NoErrorDisplay、NoErrorIntoIOError、NoErrorEqual | 保留 inhabited 的私有 unit 表示，不能改成 Never；description 返回借用的 `no error`；Display 与 IntoIOError 原消息 panic；可构造值的 Eq 恒真 |
| 519–532 | LineMatchKind、LineMatchConfirmed、LineMatchCandidate | 两种公开变体携带 Usize；不能合并成同一个 offset 或把 Candidate 升格为 Confirmed |
| 397–409 | CapturesAsMatchDefault、CapturesIsEmptyDefault | 分别恰调用一次实际 get(0)/len；前者 None 时原 unwrap panic，后者只看总槽数 |
| 441–458 | CapturesInterpolateDefault | 原 replacement→append→name_to_index→dst 调用顺序；get 返回 None 不写，Some 按原 haystack 范围追加；不改变捕获名解析规则 |

**准确边界：**43 个 values 函数中包含私有算法 helper、显式相等/克隆入口和两个变体构造入口，数量不能当成已经迁完的原 Rust 方法数。三个 captures 默认算法是算法分解；它们各接所需的 get/len 普通函数，不定义一个可变的 CapturesSupply 对象。最终 trait 编码必须把它们接到同一已选择实现的 required methods，并隐藏这种派生绑定，不能要求应用作者每次调用重新传 len/get。

## 借用、机器值和异常的保持

`Byte` 是 checked uint8，`Word` 是 checked uint64；`Usize` 由共享模块从准确目标取得，绝不写死为 uint64，也不把它换成数学 Int。`std:IntAdd` 本来支持同一个完整有限 int/uint 类型，因此只在 ByteSet 的已经证明不会溢出的 byte 增量使用。`std:IntEq/IntCompare/IntSub` 不适用于机器 uint，本片没有这样调用它们。其他实际保留 std 名只有 BoolNot、TextConcat。

Match 的所有合法构造保持 start≤end；offset 在两次 checked_add 都成功时保持顺序。合法 Match 在另一个过短 haystack 上索引仍可能 panic，构造不变量不能代签索引范围。str 字节边界仍由 StrRange 校验。输入 Borrow/BorrowMut 与返回值通过同一个 Region 参数关联；没有把借用改成复制、指针整数或长寿命句柄。Param.mode 只是独立的调用方式，不能代替 Type.apply 中的真实借用类型。

LineTerminator 的表示变化在 opaque 边界内。Byte 分支结果必须指向 self 的 byte 字段，CRLF 结果指向静态只读二字节；两者均零分配。CRLF 值只由对应工厂生成，所以 `{crlf:true,byte:非10}` 不可从公开源构造。没有承诺私有 enum/record 的跨版本 ABI、地址偏移或 unsafe 观察等价；若工程目标另要求它们，就必须固定原布局并生成等价字段投影，不能从这个结构模型推断已保持。

ByteSet 的 add/remove 暂以读取四字值、修改指定字、回写同一对象表达；真实独占借用禁止中途合法别名观察，因此与单字原地操作的正常结果相同。Target 应把它降低为原来的单字读改写，保持无分配、无额外可失败调用和原地对象身份。ReadCopy/ReadCopyMut 仅可处理该使用点已证明可复制的私有值表示；不能对任意带 Own、Drop 或用户 Clone 效果的 T 复制，也不能自动改变原生公开 Copy trait 集合。

Panic 是目标运行的非正常出口，不能改成 Expr.throw、Result.Err 或 false。共享实现仍需保持 unwind/abort 配置、panic hook、消息、清理及来源映射；文本组装不能引入可观察的额外成功路径。尤其 root `profile.release-lto` 和 `profile.deb` 设置 panic=abort，不能将其默认为可捕获异常。函数效果没有自报空集合：完整已绑定主体才可推导；未知导入和 trait required method 继续是准确 NeedsEffectBound。有限算法的正常终止推导也不消除 panic、内存、取消或未绑定调用的资格义务。

NoError 的旧说明称 Debug/Display 都 panic；P 的真实代码却是 `#[derive(Debug, Eq, PartialEq)]`，只有 Display::fmt 和 From<NoError> for io::Error 显式 panic。最终目标必须保留 Debug 的派生 `NoError(())`（包括 Formatter 格式策略），不能照这个错误注释实现 panic。

## 共享机器供给的最小准确需求

普通 import 的固定 ModuleId 是 **`ripgrep:foundation:machine`**，由工程协调 owner 独占维护。以下是本片当前真实引用集合及签名要求，不声称此模块、Rust reader 或 method 已安装、已绑定或已运行。`Borrow<T,r>`/`BorrowMut<T,r>` 为已有共同类型应用的库构造器，不新增 Type tag；参数顺序为 `(T:Type,r:Region)`。数值和具体类型须与本片声明等同，不能靠同名强转。

| 导出 | 本片要求的准确签名/用途 |
|---|---|
| Usize | native primitive 类型，宽度消费真实 Rust target_pointer_width，值域 0..=usize::MAX；现有值、比较及索引不得经过有损 JS number |
| ByteSlice、Str、ByteVector | 分别是原生 `[u8]`、`str`、`Vec<u8>` 的准确类型；Str 保持 UTF-8，slice/str 是可借用的 unsized view |
| Formatter、FormatResult、IOError | Formatter 是 `(Region)->Type` 构造器，对应原生 `std::fmt::Formatter<'a>`；NoErrorDisplay 的 formatterDataRegion 与外层 formatRegion 分开，后者不能超过实际内部数据寿命。另两者是准确 `std::fmt::Result`、`std::io::Error` |
| Borrow、BorrowMut | `(Type,Region)->Type`；共享/独占资格、有效范围和 reborrow 不可复制/延长；不会创建运行资源 |
| ReadCopy、ReadCopyMut | `<T,r>(Borrow<T,r>)->T` / `<T,r>(BorrowMut<T,r>)->T`；仅限上述可复制表示；无用户回调、无分配；后者只读一次，不消费或泄漏独占资格 |
| WriteValue | `<T,r>(BorrowMut<T,r>,T)->Unit`；本片仅用无 Drop/资源的 ByteSet，覆盖同一位置，返回时写入已完成，目标不得复制成另一个实例 |
| BorrowField | `<R:Type,T:Type,N:Value<Text>,r:Region>(Borrow<R,r>)->Borrow<T,r>`；显式实参在源码中依此顺序。须核 N 为 R 的真实字段、同一个 T、表示权和只读投影。当前唯一使用为 LineTerminator.byte |
| UsizeFromByte | `(uint8)->Usize`，精确无失败转换；本片只用 0 |
| UsizeEqual、UsizeLessEqual | `(Usize,Usize)->Bool`，机器无符号比较 |
| UsizeSubtract | `(Usize,Usize)->Usize`；本片使用点已由 Match 不变量证明 left≥right，不可静默饱和 |
| UsizeCheckedAdd | `(Usize,Usize)->Option<Usize>`；超范围 None，无 wrap；Option 是真实内建构造身份 |
| UsizeDecimal | `(Usize)->Text`；十进制 ASCII、无符号、无 locale/分组，零为 `0`；用于原 panic 消息 |
| ByteEqual、ByteGreater | `(uint8,uint8)->Bool` |
| ByteDivide、ByteRemainder | `(uint8,uint8)->uint8`；本片除数恒 64，商 0..3、余数 0..63；普通共享导出的零除责任须独立固定 |
| WordAnd、WordOr、WordNot、WordEqual | `(uint64,uint64)->uint64`、同前、`uint64->uint64`、`(uint64,uint64)->Bool`；Not 恰翻转 64 位 |
| WordShiftLeft | `(uint64,uint8)->uint64`；本片恰 `1 << bit`、bit<64，不从 generic checked 算术猜移位规则 |
| ByteSliceRange、ByteSliceRangeMut、StrRange | `<r>(Borrow[/Mut]<S,r>,Usize,Usize)->Borrow[/Mut]<S,r>`，S 为准确 slice/str；半开范围与 panic，str UTF-8 边界，返回借用来自同一输入 |
| ByteSliceLast | `<r>(Borrow<ByteSlice,r>)->Option<uint8>`；空 None，非空复制最后字节，无分配 |
| ByteSingletonSlice | `<r>(Borrow<uint8,r>)->Borrow<ByteSlice,r>`；与 `std::slice::from_ref` 同义，不复制 byte，不临时构造一个随后失效的数组 |
| StaticBytes、StaticStr | `<V:Value<bytes/text>,r:Region>()->Borrow<ByteSlice/Str,r>`；显式静态实参是规范值。实际只读静态存储的寿命满足 r，不能返回临时值地址；本片 V 仅 0d0a / `no error` |
| ByteVectorExtend | `<d,s>(BorrowMut<ByteVector,d>,Borrow<ByteSlice,s>)->Unit`；原有内容保留，顺序追加，保持真实 alloc/OOM 与别名约束；仅 captures 默认方法使用 |
| Panic | `(Text)->Never`；目标原生 panic 出口，消息/Hook/unwind/abort/cleanup 按当前目标；不得标为纯且保证正常返回 |

这些是通用机器/容器/借用操作。它们不含 Match、LineTerminator、ByteSet 或 Captures 的业务决定；具体方法仍由本片拥有。最小共享供给的资格、精确 native symbols/编译器输入、推导 effects 和 Type witness 必须由共享 owner 实际闭合，SOURCE 不能自行签发。

## Captures 接合与剩余范围

Captures 的 required members 是 `len(&self)->usize` 与 `get(&self,usize)->Option<Match>`，不负责创建 capture 容器。`get(0)` 必须在报告成功捕获时给出整体 Match；len 统计全部槽，未匹配的非零槽数仍非空。默认算法中的 get/len 是保持这些 exact operations 的普通函数值，接收同一 Borrow<C,r>；Fx 保留它们实际的效果上界，不能因为 Rust `&self` 就假定没有 interior mutation 或 panic。

`CapturesInterpolateDefault` 保留原 `name_to_index` 的 exclusive 可变函数资格和受限回调 Region；参数模式 move 对应 F 的按值移交。`nameEnvironment` 是该函数值的潜在借用捕获上界，必须覆盖实际调用激活，允许原 Rust 闭包借用外部名字表；它不能省略成空 captures，也不能延长实际被捕获对象的寿命。多个输入借用须以真实 outlives/共同有效域证明满足此上界，缺证明保持 Need。append lambda 的参数型由已绑定 Interpolate 的唯一签名推导；捕获的 self/haystack 只在同步调用内可见，不得被保留。其所需 **`ripgrep:matcher:interpolate` 的 Interpolate** 已由[实际插值模块](interpolation.module.json)提供作者主体，保持资格与准确边界见[插值说明](INTERPOLATION-SOURCE.md)，生产链接仍未取得；没有把它冒充实际原生 supplier。最终签名必须与 P `interpolate.rs:20` 等价：replacement 借用；同步、不保留的 `FnMut(usize,&mut Vec<u8>)` append；同步、不保留的 `FnMut(&str)->Option<usize>` name_to_index；同一个可写 dst；返回 Unit，实际效果为这些调用与 dst 扩容的联合。

以下义务仍开放，不能用本片函数数冲销：

1. **Captures trait 声明/impl/default 装配。** `core:interface` 是 operation input/output/errors/effects 端口，perform 固定产生 Result；不等于 Rust trait。[共同trait结构画像](../../../../../docs/领域/计算基础/作者表示与实现分工.md#structured-trait-profile)已给出约束、Self、关联投影、默认方法与覆盖接合；本工程的实际trait声明和实例仍须按该合同落源，不能把每个应用调用的 get/len 参数当最终 API。
2. **Matcher trait 与 `impl<M:Matcher> Matcher for &M`。** `lib.rs:546–1381` 的关联 Captures/Error、全部 default search/replace/iteration、两层 Result、空匹配前进和 trait 方法覆盖仍未迁入本片。不能从值层正确推导这些主体存在。
3. **捕获替换解析接合。** `interpolate.rs` 的 `$`/`${}`/`$$`、ASCII 名字、u32 解析后转 usize、缺失名字与原追加顺序已有独立 Gift 作者体；剩余是机器借用/容器/外部memchr真实声明、函数签名及目标消费者资格，不能从已写源码推导这些已完成。
4. **公开派生与格式协议。** 原 Clone/Copy/Debug/Eq/Hash/PartialEq 的准确集合、Rust Index/IndexMut trait 装配、BitSet Debug 的升序 0..=255 集合格式（含 alternate 等 Formatter 状态）、NoCaptures/NoError/LineMatchKind 派生输出、Error 的其他默认行为尚未完成 trait 资格。显式 Equal/Clone 函数只提供相交算法，不自动生成 impl，不得给 ByteSet/NoCaptures/NoError 新增原本没有的 Copy。
5. **机器/借用/错误供给。** 上表全部名字需要实际模块、签名、约束和 Method/Target 绑定；泛型 primitive 拥有范围、Formatter 内部寿命、opaque native boundary、panic 和公开布局保持必须逐项验证。未绑定是 Needs，不能作为用户必须亲自补 Rust 的默认要求。

准确规范 owner：私有表示归 [模块封装与复用库](../../../../../docs/作者/组合/模块封装与复用库.md) 与 [文法类型与求值](../../../../../docs/领域/计算基础/文法类型与求值.md)；结构接合归 [紧凑结构与同源编辑](../../../../../docs/作者/紧凑结构与同源编辑.md) 和原 universal-author-module Schema/codec 图。trait/关联约束归 [作者表示与实现分工](../../../../../docs/领域/计算基础/作者表示与实现分工.md) 及原目标实现责任；Borrow/Region/type application 归 [参数包与类型级值](../../../../../docs/作者/组合/参数包与类型级值.md) 与 [控制流与存储寿命](../../../../../docs/领域/对象与控制/控制流与存储寿命.md)。本片不在 case 文档里发明公共语法来绕过这些 owner。

## 等价审查与尚未执行的验证

源码级推演已逐项对照上述 P 主体；P/Q 的 matcher 源差分为空。需要独立检查至少包括：

- Match `(0,0)`、`(2,5)`、`start>end`、边界替换、`usize::MAX` 两次 offset 的先后失败；空 range 可正常索引但越界仍 panic；UTF-8 中间字节索引拒绝。
- 每个 byte=0..255 的单独 add/contains/remove、重复操作、四个 bucket 边界；全部 inclusive(start,end) 对与反向范围；full/empty；在 end=255 时最后一步先退出。
- Byte(0)、Byte(LF)、Byte(CR)、CRLF；空/CR/LF/CRLF/其他尾字节；CRLF≠Byte(LF)，CRLF.is_suffix(LF)=true；as_bytes 返回正确长度、字节及原拥有域内借用。
- Captures len=0 与 len>0 且全 None 的区别；get(0)=None panic；required method 恰调用一次；name_to_index 的独立可变状态；Some Match 对错误 haystack 越界；原目标的 unwind/abort 配置。
- 对外尝试构造/读取 opaque 字段须拒绝；仅改函数拼写或结构 Schema PASS 不能证明这一点。

这些是当前设计的检查义务，不是已执行向量或测试成绩。本轮未运行 Cargo、联网、生产 Gift 编译、完整库测试或目标程序。本片不能承担性能、压缩率、公开 Rust ABI、全工程功能闭合或二次修改运行 PASS 的声明。
