# Rust与C++能力映射依据

本篇保存[原生映射][k1]使用的一手来源、命题范围及其限制，不是另一套产品合同。比较关注真实任务、原生接口、表示/寿命、进展、供给与完整成本；“可以通过某种表示完成”不自动等于同API、同ABI、同成本或同保证。A01—A64、X01—X14仅为既有比较定位，不表示相同数量的独立缺失。

## 来源状态与复用

所列研究资料记录日期为2026-09-22。Rust比较基线为1.98.1；C++既有规则与C++26提案、编译器实现状态分开。稳定页面的URL不使其中每个item变成stable；latest crate页面也不永久固定版本。实际采用必须把所选版本、特性开关、目标与构建选项变成准确输入，不仅保存链接。

已经取得且前提/用途未改变的来源可以复用，不要求每次全量重新访问。相交版本核查另明确：R01、R02、R03—R05、R07—R08、R22、R25、R30、C16，以及下述ManuallyDrop和有限模型来源用于当前校准；未逐项重新访问其余页面，不声称所有条目都重新做过目标测试。R30返回页标记1.97.1，后续版本的同页未能直接取得；这一具体覆盖不扩大成1.98.1逐字验证。

来源证明的是所述规范、API、设计或作者声明，不证明Gift实现、被选组合或真实部署已满足。状态页若自身说明可能滞后，保留该限制；标准提案不能替代编译器支持表，支持表不能替代实际工具与运行结果。工具缺陷、语义修订、目标/依赖变化或新反例到来时重开相交判定。

## Rust语言与工具

| 键 | 来源与实际支持命题 | 限制及使用位置 |
|---|---|---|
| <a id="research-r01"></a>R01 | [Rust 1.98.1公告][k2]：2026-09-03发布、修复相交vtable生成问题 | 校准真实工具版本，不否定全部语言/其他版本；对象分派、外部供给与验收 |
| <a id="research-r02"></a>R02 | [Rust 1.98.0公告][k3]：2026-08-20，algebraic浮点、具体原子可变视图API、ManuallyDrop保证 | 不把公告的Atomic<T>记法当任意T的稳定泛型API；数值、原子及对象状态 |
| <a id="research-r03"></a>R03 | [泛型参数][k4]：类型/const参数及具体限制 | 内部可生成具体值不证明开放native形状；泛型与导出 |
| <a id="research-r04"></a>R04 | [impl与一致性][k5]：不重叠实现、孤儿和重叠规则 | 具体/结构impl并非全部禁止，blanket重叠另判；特化与开放定制 |
| <a id="research-r05"></a>R05 | [关联项][k6]：GAT、关联类型、合法receiver | GAT编码不等于任意不合作模板名，合法Pin/Box等receiver不能漏掉；泛型、对象调用 |
| <a id="research-r06"></a>R06 | [traits][k7]：泛型方法、dyn兼容及接口 | 静态泛型和dyn接口不同，不自动复现C++对象图；调用/导出 |
| <a id="research-r07"></a>R07 | [类型布局][k8]：数组/零长数组对齐、表示范围 | [T;0]可以传递T对齐，不保证任意泛型repr表达式或外部ABI；布局 |
| <a id="research-r08"></a>R08 | [Pin][k9]：地址敏感值与drop保证 | 不必堆分配，不自动提供移动hook或所有原位工厂；存储与协程 |
| <a id="research-r09"></a>R09 | [MaybeUninit][k10]：未初始化存储及有效值边界 | 不是允许先造无效引用再检查，写入函数不证明无临时值；构造/清理 |
| <a id="research-r10"></a>R10 | [Clone/clone_from][k11]：自定义复制和目标资源复用 | 不等于可重载原生`=`或无副作用复制；对象赋值 |
| <a id="research-r11"></a>R11 | [Index][k12]：引用返回的下标接口 | value/lending proxy不能无条件同形替换；代理位置 |
| <a id="research-r12"></a>R12 | [Fn][k13]：闭包调用协议及手写实现状态 | 闭包包装、call方法和任意用户类型直接实现原生Fn不同；调用与高阶API |
| <a id="research-r13"></a>R13 | [过程宏][k14]：TokenStream及宏边界 | 不自动拥有任意外部类型的语义信息；反射、生成与阶段 |
| <a id="research-r14"></a>R14 | [常量求值][k15]：所选const域和操作规则 | build脚本不等于目标const，const fn不等于只能静态调用；元求值 |
| <a id="research-r15"></a>R15 | [specialization实验][k16] | 实验不作stable默认，不据名称推断所有重叠/表示族已实现；特化 |
| <a id="research-r16"></a>R16 | [generic_const_exprs实验][k17] | 不抹去类型级长度/关联存储等既有路线；泛型尺寸与导出 |
| <a id="research-r17"></a>R17 | [重载实验公告][k18]：2026-08-19的研究方向 | 非稳定承诺、非本系统采用命令；重载候选比较 |
| <a id="research-r18"></a>R18 | [可见性与隐私][k19] | 模块访问与运行授权不同，不自动提供任意friend/protected协议；封装 |
| <a id="research-r19"></a>R19 | [Any][k20]：实际类型识别与'static范围 | 不等于继承图、横转或任意借用类型RTTI；对象视图 |
| <a id="research-r20"></a>R20 | [未定义行为边界][k21] | 合法unsafe前提须具体，类型强转不证明别名/有效值；布局、FFI、原子 |
| <a id="research-r21"></a>R21 | [Nomicon FFI][k22]：opaque、调用及unwind边界 | foreign catch具体承诺优先核R22，二者措辞差异不隐藏；外部调用 |
| <a id="research-r22"></a>R22 | [catch_unwind][k23]：只处理其panic范围，foreign捕获分支有明确不确定性 | 不承诺C++typed catch或捕获abort；异常域与清理 |
| <a id="research-r23"></a>R23 | [c_variadic实验][k24] | 调用外部变参与定义ellipsis入口分开；真实native导出 |
| <a id="research-r24"></a>R24 | [Allocator API][k25] | 按item稳定性，独立容器不自动等于固定std::Vec；分配策略 |
| <a id="research-r25"></a>R25 | [泛型Atomic][k26]：AtomicPrimitive与generic_atomic标记 | stable路径不使任意T可用，具体别名/方法另核；原子映射 |
| <a id="research-r26"></a>R26 | [thread_local!][k27]：const初始化及相应优化 | 不据包装推断必有高开销，也不代签原生TLS符号/任务局部；运行域 |
| <a id="research-r27"></a>R27 | [std::simd][k28] | 可移植接口状态与稳定架构intrinsics/库分开；SIMD选择 |
| <a id="research-r28"></a>R28 | [一般coroutines实验][k29] | Future/Iterator可用不等于任意resume/yield原生协议；控制流 |
| <a id="research-r29"></a>R29 | [read_volatile][k30] | volatile不是atomic、fence或设备完成；MMIO访问 |
| <a id="research-r30"></a>R30 | [x86_64 MXCSR][k31]、[x86同接口][k32]：默认环境及汇编隔离 | 实际读取页面的版本/覆盖如前述；异常标记与改变控制位区分；严格数值内核 |
| <a id="research-r31"></a>R31 | [f128][k33] | 状态按item核对，名称不代签任意long double格式/ABI；扩展浮点 |
| <a id="research-r32"></a>R32 | [平台支持][k34] | 目标分级不代表所有SDK、芯片、资质或当前部署；供给准入 |
| <a id="research-r33"></a>R33 | [代码生成选项][k35] | 选项意图不证明指定成本、指令、无锁或时限；实例/数值/控制 |
| <a id="research-r34"></a>R34 | [显式尾调用实验][k36] | 不冒充stable，结构化循环与精确尾调用接口不同；CFG与栈 |
| <a id="research-r35"></a>R35 | [Cargo SemVer][k37] | 一致性规则不保证全部库演进兼容；公开API和依赖迁移 |
| <a id="research-r36"></a>R36 | [closure类型][k38] | 捕获类型、调用trait与开放类型量化不混同；泛型closure |
| <a id="research-r37"></a>R37 | [ManuallyDrop][k39]：当前1.98.1页面说明有效值、销毁、公开访问风险与旧Box问题 | 外壳可移动不复活内部T，派生Debug/Clone等访问Dead字段仍需防止；存储状态/验收 |
| <a id="research-r38"></a>R38 | [fn_traits实验接口][k40]：手写Fn/FnMut/FnOnce实现仍属于实验能力 | 可生成闭包/适配器不等于任意用户类型在stable上原生实现Fn；调用定制与外部接口 |

### FFI 异常边界的相交复核

2026-10-07复核上表 [R21][k41] 的 FFI and unwinding 至 Catching panic preemptively：是否允许跨 ABI 展开由准确 ABI/构建策略决定，`panic=abort` 不因 unwind ABI 而变成可捕获异常，`catch_unwind` 不捕获直接中止的 panic。此处只支持[共同异常边界][k42]把目标语言语义与 Gift 宿主协议转换分开；不宣布所有 Rust/C++ 版本、foreign catch 或 ABI 组合已重新验证。foreign catch 仍按 [R22][k43] 的具体范围与既有不确定性处理。

## 可复用库与互操作

以下版本是已取得比较资料的记录，不是永远跟随latest或已经装入本工程。每条路线仍需核所选目标、特性、支持和许可；库存在不保证与用户硬性原生API相同。

| 键 | 来源及记录范围 | 采用边界 |
|---|---|---|
| <a id="research-l01"></a>L01 | [frunk hlist][k44]，记录0.5.0；异构map/fold/zip | 任意有限HList不是固定元数宏，但类型/编译成本和native tuple接口不同；参数包 |
| <a id="research-l02"></a>L02 | [generic-array][k45]，记录1.4.5；类型级长度与定长存储 | 不是任何原生泛型const表达式的同形API；尺寸/导出 |
| <a id="research-l03"></a>L03 | [pin-init][k46]，记录0.2.0；栈/堆原位初始化 | 实际slot、Pin、初始化失败和公开工厂形态仍要匹配；存储 |
| <a id="research-l04"></a>L04 | [allocator-api2][k47]，记录0.4.0 | 独立容器/API不自动替换固定std类型；allocator传播与接口 |
| <a id="research-l05"></a>L05 | [atomic][k48]，记录0.6.1；泛型值及NoUninit等实际条件 | 大小、padding、进展、锁回退及目标均须核，不是任意拥有对象；原子 |
| <a id="research-l06"></a>L06 | [portable-atomic][k49]，记录1.15 | 宽度、检测与回退各有条件，锁不能冒充硬性lock-free/跨进程；原子 |
| <a id="research-l07"></a>L07 | [atomic-wait][k50]，记录1.1.0 | wait/wake、timeout、操作系统与类型范围按实际接口，不由std缺名认定无能力 |
| <a id="research-i01"></a>I01 | [Crubit状态][k51] | 官方页可能滞后；单个bridge限制不代表全部Rust路线；对象/FFI条件 |
| <a id="research-i02"></a>I02 | [Rust 2026 interop问题图][k52] | 路线/问题不当作已发布能力，更不自动采用；互操作剩余范围 |
| <a id="research-i03"></a>I03 | [CXX Result][k53] | 支持限定错误转译，不证明全部C++类、模板和异常ABI；跨域错误 |
| <a id="research-i04"></a>I04 | [CXX bridge][k54]：`extern "C++"`等声明由CXX桥接系统消费 | 成熟桥接可复用，但不等于Rust编译器具有完整通用C++ ABI/模板语言支持；foreign边界与模块驻留 |

## C++规则、提案与目标工具

动态working draft不整体等于C++23；下面仅按所引命题及相应语言/工具版本使用。编译器状态改变不修改作者要求，具体实装缺陷和不支持进入供给资格。

| 键 | 来源 | 支持及限制/消费者 |
|---|---|---|
| <a id="research-c01"></a>C01 | [派生对象][k55] | 子对象、继承/视图规则，非任意bridge已支持；对象映射 |
| <a id="research-c02"></a>C02 | [模板参数][k56] | 参数种类及实际域，非所有未来结构都自动NTTP；泛型 |
| <a id="research-c03"></a>C03 | [部分特化][k57] | 类等适用实体；函数模板不能部分特化，不能从标题推全域；选择 |
| <a id="research-c04"></a>C04 | [模板推导][k58] | 原生推导与候选规则，不强制中立源复制全部复杂度；调用/泛型 |
| <a id="research-c05"></a>C05 | [copy elision][k59] | 与C06共同区分目的地构造和可选NRVO；原位初始化 |
| <a id="research-c06"></a>C06 | [初始化][k60] | prvalue与初始化的相交规则，不扩大为任意返回都不移动；对象状态 |
| <a id="research-c07"></a>C07 | [位域][k61] | 布局/访问有实现与源规则，不是通用wire/MMIO安全保证 |
| <a id="research-c08"></a>C08 | [no_unique_address][k62] | 属性许可不等于所有编译器一定节省空间；重叠/布局 |
| <a id="research-c09"></a>C09 | [atomic_ref][k63] | 类型、对齐、寿命与访问条件，不是任意对象可无锁；原子视图 |
| <a id="research-c10"></a>C10 | [contracts][k64] | 当前草案语义，不等于已测试C++23或通用证明器；契约 |
| <a id="research-c11"></a>C11 | [exception specifications][k65] | noexcept传播语义不同于不分配/无终止/时限；错误与优化选择 |
| <a id="research-c12"></a>C12 | [P2996R13][k66] | C++26反射设计，提案内容与编译器实际支持分开；阶段与生成 |
| <a id="research-c13"></a>C13 | [P4197R0][k67] | trivial relocation的C++29重议，不列为已交付C++26能力；重定位 |
| <a id="research-c14"></a>C14 | [friend][k68] | 精确源访问及非传递性，不是运行权限；封装与反射 |
| <a id="research-c15"></a>C15 | [默认参数][k69] | 求值、作用域和静态选择关系，不普遍套用所有语言；调用 |
| <a id="research-c16"></a>C16 | [重载选择][k70]、[access control][k71] | 语言构造/候选选择与访问检查是不同阶段；最佳选择后再检查可访问性，不能预删private候选再声称兼容 |
| <a id="research-c17"></a>C17 | [lambda closure][k72] | 泛型closure的原生调用与捕获，非普通Rust Fn同形量化；高阶API |
| <a id="research-c18"></a>C18 | [C++ coroutines][k73] | coroutine handle/promise、frame创建、resume/destroy与错误路径属于具体原生协议；拥有类似Future接口不证明任意C++ coroutine ABI兼容 |
| <a id="research-c19"></a>C19 | [C++ working draft SIMD][k83] | 可移植SIMD库/掩码/向量操作的C++侧直接语言库依据；working draft只支持相交语义比较，不证明具体标准库或编译器已实现、已启用或满足性能硬要求；用于a63比较 |
| <a id="research-t01"></a>T01 | [GCC特性状态][k74] | 逐特性/版本状态，不是当前机器安装状态；反射/contracts/展开等供给 |
| <a id="research-t02"></a>T02 | [Clang Users Manual][k75] | 严格浮点、环境与选项条件，不由默认优化证明定向舍入 |
| <a id="research-t03"></a>T03 | [Clang extensions][k76] | 厂商能力按准确语法/目标使用，不自动成ISO能力或所有平台支持 |
| <a id="research-t04"></a>T04 | [GCC labels-as-values][k77] | computed goto属于GNU扩展，析构边界与普通goto不同；CFG |

## 抽象、策略与推理保持

这些来源只支持相交方法和理论边界，不指定核心对象数、必须安装的求解器或产品实现路线。

| 来源 | 支持命题、前提与使用 |
|---|---|
| [Spot ltlsynt][k78] | 输入/输出先后、可观察输入及实际控制器，校准因果策略；工具支持不代表任意域综合可用 |
| [Cousot：Abstract Interpretation in a Nutshell][k79] | 近似方向与抽象解释背景；具体共同见证/有限构造仍核本系统明确集合定义 |
| [Chatterjee等不完全信息策略证据][k80] | 2007研究中的不完全信息与策略方法背景；本规范只采用明确有限安全/完成画像，不把论文全部结果或历史未知移植为现状 |
| [Lamport著作与辅助变量][k81] | 证明辅助量与真实可执行观察不同；目录只是定位入口，不单独作为某定理的证明 |

有限抽象的充分判据、共同交集、不可比较划分、容差链、知识更新、安全固定点与完成rank均在[方法正文][k82]给出实际输入、算法和边界。仅改术语、给fixpoint标签或把反例放进容器不能消解这些义务。源到模型、逻辑基础、目标实现及现实环境仍分别核验。

## 证据不得越过的边界

同版本的一手资料、旧实验记录和当前运行结果不是同一来源。已取得的有限C++检查只能支持其准确输入、工具和选项；没有Rust/TS目标执行结果时不能宣称差分通过。非权威跨语言接缝反例、结构反例和有限数学复算也不代签整个编译器、所有 ABI、性能或部署。

反例推翻的只是其相交命题。已有成熟库和正确语义仍可采用；不以一项实现缺陷否定整个语言，也不以其他成功测试弥补本项缺失。是否比其他路线更快、更小或更易维护，按同任务、同依赖政策和同保证取得有依据的成本比较；当前资料不提供无条件全局排名。

[k1]: ../../docs/40-目标与制品/原生映射/README.md
[k2]: https://blog.rust-lang.org/2026/09/03/Rust-1.98.1/
[k3]: https://blog.rust-lang.org/2026/08/20/Rust-1.98.0/
[k4]: https://doc.rust-lang.org/stable/reference/items/generics.html
[k5]: https://doc.rust-lang.org/stable/reference/items/implementations.html
[k6]: https://doc.rust-lang.org/stable/reference/items/associated-items.html
[k7]: https://doc.rust-lang.org/stable/reference/items/traits.html
[k8]: https://doc.rust-lang.org/stable/reference/type-layout.html
[k9]: https://doc.rust-lang.org/stable/std/pin/index.html
[k10]: https://doc.rust-lang.org/stable/std/mem/union.MaybeUninit.html
[k11]: https://doc.rust-lang.org/stable/std/clone/trait.Clone.html
[k12]: https://doc.rust-lang.org/stable/std/ops/trait.Index.html
[k13]: https://doc.rust-lang.org/stable/std/ops/trait.Fn.html
[k14]: https://doc.rust-lang.org/stable/reference/procedural-macros.html
[k15]: https://doc.rust-lang.org/stable/reference/const_eval.html
[k16]: https://doc.rust-lang.org/unstable-book/language-features/specialization.html
[k17]: https://doc.rust-lang.org/unstable-book/language-features/generic-const-exprs.html
[k18]: https://blog.rust-lang.org/inside-rust/2026/08/19/overloading-experiment/
[k19]: https://doc.rust-lang.org/stable/reference/visibility-and-privacy.html
[k20]: https://doc.rust-lang.org/stable/std/any/trait.Any.html
[k21]: https://doc.rust-lang.org/stable/reference/behavior-considered-undefined.html
[k22]: https://doc.rust-lang.org/nomicon/ffi.html
[k23]: https://doc.rust-lang.org/stable/std/panic/fn.catch_unwind.html
[k24]: https://doc.rust-lang.org/unstable-book/language-features/c-variadic.html
[k25]: https://doc.rust-lang.org/stable/std/alloc/trait.Allocator.html
[k26]: https://doc.rust-lang.org/stable/std/sync/atomic/struct.Atomic.html
[k27]: https://doc.rust-lang.org/stable/std/macro.thread_local.html
[k28]: https://doc.rust-lang.org/stable/std/simd/index.html
[k29]: https://doc.rust-lang.org/unstable-book/language-features/coroutines.html
[k30]: https://doc.rust-lang.org/stable/std/ptr/fn.read_volatile.html
[k31]: https://doc.rust-lang.org/stable/core/arch/x86_64/fn._mm_setcsr.html
[k32]: https://doc.rust-lang.org/stable/core/arch/x86/fn._mm_setcsr.html
[k33]: https://doc.rust-lang.org/stable/std/primitive.f128.html
[k34]: https://doc.rust-lang.org/stable/rustc/platform-support.html
[k35]: https://doc.rust-lang.org/stable/rustc/codegen-options/index.html
[k36]: https://doc.rust-lang.org/unstable-book/language-features/explicit-tail-calls.html
[k37]: https://doc.rust-lang.org/stable/cargo/reference/semver.html
[k38]: https://doc.rust-lang.org/stable/reference/types/closure.html
[k39]: https://doc.rust-lang.org/std/mem/struct.ManuallyDrop.html
[k40]: https://doc.rust-lang.org/unstable-book/library-features/fn-traits.html
[k41]: #research-r21
[k42]: ../../docs/20-语义与组合/共同语义/规范元模型与结果语义.md#异常边界
[k43]: #research-r22
[k44]: https://docs.rs/frunk/latest/frunk/hlist/index.html
[k45]: https://docs.rs/generic-array/latest/generic_array/
[k46]: https://docs.rs/pin-init/latest/pin_init/
[k47]: https://docs.rs/allocator-api2/latest/allocator_api2/
[k48]: https://docs.rs/atomic/latest/atomic/
[k49]: https://docs.rs/portable-atomic/latest/portable_atomic/
[k50]: https://docs.rs/atomic-wait/latest/atomic_wait/
[k51]: https://crubit.rs/overview/status
[k52]: https://goals.rust-lang.org/2026/interop-problem-map.html
[k53]: https://cxx.rs/binding/result.html
[k54]: https://cxx.rs/
[k55]: https://eel.is/c++draft/class.derived
[k56]: https://eel.is/c++draft/temp.param
[k57]: https://eel.is/c++draft/temp.spec.partial
[k58]: https://eel.is/c++draft/temp.deduct
[k59]: https://eel.is/c++draft/class.copy.elision
[k60]: https://eel.is/c++draft/dcl.init
[k61]: https://eel.is/c++draft/class.bit
[k62]: https://eel.is/c++draft/dcl.attr.nouniqueaddr
[k63]: https://eel.is/c++draft/atomics.ref.generic
[k64]: https://eel.is/c++draft/basic.contract
[k65]: https://eel.is/c++draft/except.spec
[k66]: https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p2996r13.html
[k67]: https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2026/p4197r0.html
[k68]: https://eel.is/c++draft/class.friend
[k69]: https://eel.is/c++draft/dcl.fct.default
[k70]: https://eel.is/c++draft/over.match
[k71]: https://eel.is/c++draft/class.access.general
[k72]: https://eel.is/c++draft/expr.prim.lambda.closure
[k73]: https://eel.is/c++draft/dcl.fct.def.coroutine
[k74]: https://gcc.gnu.org/projects/cxx-status.html
[k75]: https://clang.llvm.org/docs/UsersManual.html
[k76]: https://clang.llvm.org/docs/LanguageExtensions.html
[k77]: https://gcc.gnu.org/onlinedocs/gcc/Labels-as-Values.html
[k78]: https://spot.lre.epita.fr/ltlsynt.html
[k79]: https://www.di.ens.fr/~cousot/AI/IntroAbsInt.html
[k80]: 语言编译与目标工具.md#finite-observation-sources
[k81]: https://lamport.azurewebsites.net/pubs/pubs.html
[k82]: ../../docs/30-实现解析/有限抽象与观察策略.md
[k83]: https://eel.is/c++draft/simd
