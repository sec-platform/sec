# Rust与C++能力映射依据

本篇保存[原生映射](../../编译/原生映射/README.md)使用的一手来源、命题范围及其限制，不是另一套产品合同。比较关注真实任务、原生接口、表示/寿命、进展、供给与完整成本；“可以通过某种表示完成”不自动等于同API、同ABI、同成本或同保证。A01—A64、X01—X14仅为既有比较定位，不表示相同数量的独立缺失。

## 来源状态与复用

所列研究资料记录日期为2026-09-22。Rust比较基线为1.98.1；C++既有规则与C++26提案、编译器实现状态分开。稳定页面的URL不使其中每个item变成stable；latest crate页面也不永久固定版本。实际采用必须把所选版本、特性开关、目标与构建选项变成准确输入，不仅保存链接。

已经取得且前提/用途未改变的来源可以复用，不要求每次全量重新访问。相交版本核查另明确：R01、R02、R03—R05、R07—R08、R22、R25、R30、C16，以及下述ManuallyDrop和有限模型来源用于当前校准；未逐项重新访问其余页面，不声称所有条目都重新做过目标测试。R30返回页标记1.97.1，后续版本的同页未能直接取得；这一具体覆盖不扩大成1.98.1逐字验证。

来源证明的是所述规范、API、设计或作者声明，不证明SEC实现、被选组合或真实部署已满足。状态页若自身说明可能滞后，保留该限制；标准提案不能替代编译器支持表，支持表不能替代实际工具与运行结果。工具缺陷、语义修订、目标/依赖变化或新反例到来时重开相交判定。

## Rust语言与工具

| 键 | 来源与实际支持命题 | 限制及使用位置 |
|---|---|---|
| R01 | [Rust 1.98.1公告](https://blog.rust-lang.org/2026/09/03/Rust-1.98.1/)：2026-09-03发布、修复相交vtable生成问题 | 校准真实工具版本，不否定全部语言/其他版本；对象分派、外部供给与验收 |
| R02 | [Rust 1.98.0公告](https://blog.rust-lang.org/2026/08/20/Rust-1.98.0/)：2026-08-20，algebraic浮点、具体原子可变视图API、ManuallyDrop保证 | 不把公告的Atomic<T>记法当任意T的稳定泛型API；数值、原子及对象状态 |
| R03 | [泛型参数](https://doc.rust-lang.org/stable/reference/items/generics.html)：类型/const参数及具体限制 | 内部可生成具体值不证明开放native形状；泛型与导出 |
| R04 | [impl与一致性](https://doc.rust-lang.org/stable/reference/items/implementations.html)：不重叠实现、孤儿和重叠规则 | 具体/结构impl并非全部禁止，blanket重叠另判；特化与开放定制 |
| R05 | [关联项](https://doc.rust-lang.org/stable/reference/items/associated-items.html)：GAT、关联类型、合法receiver | GAT编码不等于任意不合作模板名，合法Pin/Box等receiver不能漏掉；泛型、对象调用 |
| R06 | [traits](https://doc.rust-lang.org/stable/reference/items/traits.html)：泛型方法、dyn兼容及接口 | 静态泛型和dyn接口不同，不自动复现C++对象图；调用/导出 |
| R07 | [类型布局](https://doc.rust-lang.org/stable/reference/type-layout.html)：数组/零长数组对齐、表示范围 | [T;0]可以传递T对齐，不保证任意泛型repr表达式或外部ABI；布局 |
| R08 | [Pin](https://doc.rust-lang.org/stable/std/pin/index.html)：地址敏感值与drop保证 | 不必堆分配，不自动提供移动hook或所有原位工厂；存储与协程 |
| R09 | [MaybeUninit](https://doc.rust-lang.org/stable/std/mem/union.MaybeUninit.html)：未初始化存储及有效值边界 | 不是允许先造无效引用再检查，写入函数不证明无临时值；构造/清理 |
| R10 | [Clone/clone_from](https://doc.rust-lang.org/stable/std/clone/trait.Clone.html)：自定义复制和目标资源复用 | 不等于可重载原生`=`或无副作用复制；对象赋值 |
| R11 | [Index](https://doc.rust-lang.org/stable/std/ops/trait.Index.html)：引用返回的下标接口 | value/lending proxy不能无条件同形替换；代理位置 |
| R12 | [Fn](https://doc.rust-lang.org/stable/std/ops/trait.Fn.html)：闭包调用协议及手写实现状态 | 闭包包装、call方法和任意用户类型直接实现原生Fn不同；调用与高阶API |
| R13 | [过程宏](https://doc.rust-lang.org/stable/reference/procedural-macros.html)：TokenStream及宏边界 | 不自动拥有任意外部类型的语义信息；反射、生成与阶段 |
| R14 | [常量求值](https://doc.rust-lang.org/stable/reference/const_eval.html)：所选const域和操作规则 | build脚本不等于目标const，const fn不等于只能静态调用；元求值 |
| R15 | [specialization实验](https://doc.rust-lang.org/unstable-book/language-features/specialization.html) | 实验不作stable默认，不据名称推断所有重叠/表示族已实现；特化 |
| R16 | [generic_const_exprs实验](https://doc.rust-lang.org/unstable-book/language-features/generic-const-exprs.html) | 不抹去类型级长度/关联存储等既有路线；泛型尺寸与导出 |
| R17 | [重载实验公告](https://blog.rust-lang.org/inside-rust/2026/08/19/overloading-experiment/)：2026-08-19的研究方向 | 非稳定承诺、非本系统采用命令；重载候选比较 |
| R18 | [可见性与隐私](https://doc.rust-lang.org/stable/reference/visibility-and-privacy.html) | 模块访问与运行授权不同，不自动提供任意friend/protected协议；封装 |
| R19 | [Any](https://doc.rust-lang.org/stable/std/any/trait.Any.html)：实际类型识别与'static范围 | 不等于继承图、横转或任意借用类型RTTI；对象视图 |
| R20 | [未定义行为边界](https://doc.rust-lang.org/stable/reference/behavior-considered-undefined.html) | 合法unsafe前提须具体，类型强转不证明别名/有效值；布局、FFI、原子 |
| R21 | [Nomicon FFI](https://doc.rust-lang.org/nomicon/ffi.html)：opaque、调用及unwind边界 | foreign catch具体承诺优先核R22，二者措辞差异不隐藏；外部调用 |
| R22 | [catch_unwind](https://doc.rust-lang.org/stable/std/panic/fn.catch_unwind.html)：只处理其panic范围，foreign捕获分支有明确不确定性 | 不承诺C++typed catch或捕获abort；异常域与清理 |
| R23 | [c_variadic实验](https://doc.rust-lang.org/unstable-book/language-features/c-variadic.html) | 调用外部变参与定义ellipsis入口分开；真实native导出 |
| R24 | [Allocator API](https://doc.rust-lang.org/stable/std/alloc/trait.Allocator.html) | 按item稳定性，独立容器不自动等于固定std::Vec；分配策略 |
| R25 | [泛型Atomic](https://doc.rust-lang.org/stable/std/sync/atomic/struct.Atomic.html)：AtomicPrimitive与generic_atomic标记 | stable路径不使任意T可用，具体别名/方法另核；原子映射 |
| R26 | [thread_local!](https://doc.rust-lang.org/stable/std/macro.thread_local.html)：const初始化及相应优化 | 不据包装推断必有高开销，也不代签原生TLS符号/任务局部；运行域 |
| R27 | [std::simd](https://doc.rust-lang.org/stable/std/simd/index.html) | 可移植接口状态与稳定架构intrinsics/库分开；SIMD选择 |
| R28 | [一般coroutines实验](https://doc.rust-lang.org/unstable-book/language-features/coroutines.html) | Future/Iterator可用不等于任意resume/yield原生协议；控制流 |
| R29 | [read_volatile](https://doc.rust-lang.org/stable/std/ptr/fn.read_volatile.html) | volatile不是atomic、fence或设备完成；MMIO访问 |
| R30 | [x86_64 MXCSR](https://doc.rust-lang.org/stable/core/arch/x86_64/fn._mm_setcsr.html)、[x86同接口](https://doc.rust-lang.org/stable/core/arch/x86/fn._mm_setcsr.html)：默认环境及汇编隔离 | 实际读取页面的版本/覆盖如前述；异常标记与改变控制位区分；严格数值内核 |
| R31 | [f128](https://doc.rust-lang.org/stable/std/primitive.f128.html) | 状态按item核对，名称不代签任意long double格式/ABI；扩展浮点 |
| R32 | [平台支持](https://doc.rust-lang.org/stable/rustc/platform-support.html) | 目标分级不代表所有SDK、芯片、资质或当前部署；供给准入 |
| R33 | [代码生成选项](https://doc.rust-lang.org/stable/rustc/codegen-options/index.html) | 选项意图不证明指定成本、指令、无锁或时限；实例/数值/控制 |
| R34 | [显式尾调用实验](https://doc.rust-lang.org/unstable-book/language-features/explicit-tail-calls.html) | 不冒充stable，结构化循环与精确尾调用接口不同；CFG与栈 |
| R35 | [Cargo SemVer](https://doc.rust-lang.org/stable/cargo/reference/semver.html) | 一致性规则不保证全部库演进兼容；公开API和依赖迁移 |
| R36 | [closure类型](https://doc.rust-lang.org/stable/reference/types/closure.html) | 捕获类型、调用trait与开放类型量化不混同；泛型closure |
| R37 | [ManuallyDrop](https://doc.rust-lang.org/std/mem/struct.ManuallyDrop.html)：当前1.98.1页面说明有效值、销毁、公开访问风险与旧Box问题 | 外壳可移动不复活内部T，派生Debug/Clone等访问Dead字段仍需防止；存储状态/验收 |

## 可复用库与互操作

以下版本是已取得比较资料的记录，不是永远跟随latest或已经装入本工程。每条路线仍需核所选目标、特性、支持和许可；库存在不保证与用户硬性原生API相同。

| 键 | 来源及记录范围 | 采用边界 |
|---|---|---|
| L01 | [frunk hlist](https://docs.rs/frunk/latest/frunk/hlist/index.html)，记录0.5.0；异构map/fold/zip | 任意有限HList不是固定元数宏，但类型/编译成本和native tuple接口不同；参数包 |
| L02 | [generic-array](https://docs.rs/generic-array/latest/generic_array/)，记录1.4.5；类型级长度与定长存储 | 不是任何原生泛型const表达式的同形API；尺寸/导出 |
| L03 | [pin-init](https://docs.rs/pin-init/latest/pin_init/)，记录0.2.0；栈/堆原位初始化 | 实际slot、Pin、初始化失败和公开工厂形态仍要匹配；存储 |
| L04 | [allocator-api2](https://docs.rs/allocator-api2/latest/allocator_api2/)，记录0.4.0 | 独立容器/API不自动替换固定std类型；allocator传播与接口 |
| L05 | [atomic](https://docs.rs/atomic/latest/atomic/)，记录0.6.1；泛型值及NoUninit等实际条件 | 大小、padding、进展、锁回退及目标均须核，不是任意拥有对象；原子 |
| L06 | [portable-atomic](https://docs.rs/portable-atomic/latest/portable_atomic/)，记录1.15 | 宽度、检测与回退各有条件，锁不能冒充硬性lock-free/跨进程；原子 |
| L07 | [atomic-wait](https://docs.rs/atomic-wait/latest/atomic_wait/)，记录1.1.0 | wait/wake、timeout、操作系统与类型范围按实际接口，不由std缺名认定无能力 |
| I01 | [Crubit状态](https://crubit.rs/overview/status) | 官方页可能滞后；单个bridge限制不代表全部Rust路线；对象/FFI条件 |
| I02 | [Rust 2026 interop问题图](https://goals.rust-lang.org/2026/interop-problem-map.html) | 路线/问题不当作已发布能力，更不自动采用；互操作剩余范围 |
| I03 | [CXX Result](https://cxx.rs/binding/result.html) | 支持限定错误转译，不证明全部C++类、模板和异常ABI；跨域错误 |

## C++规则、提案与目标工具

动态working draft不整体等于C++23；下面仅按所引命题及相应语言/工具版本使用。编译器状态改变不修改作者要求，具体实装缺陷和不支持进入供给资格。

| 键 | 来源 | 支持及限制/消费者 |
|---|---|---|
| C01 | [派生对象](https://eel.is/c++draft/class.derived) | 子对象、继承/视图规则，非任意bridge已支持；对象映射 |
| C02 | [模板参数](https://eel.is/c++draft/temp.param) | 参数种类及实际域，非所有未来结构都自动NTTP；泛型 |
| C03 | [部分特化](https://eel.is/c++draft/temp.spec.partial) | 类等适用实体；函数模板不能部分特化，不能从标题推全域；选择 |
| C04 | [模板推导](https://eel.is/c++draft/temp.deduct) | 原生推导与候选规则，不强制中立源复制全部复杂度；调用/泛型 |
| C05 | [copy elision](https://eel.is/c++draft/class.copy.elision) | 与C06共同区分目的地构造和可选NRVO；原位初始化 |
| C06 | [初始化](https://eel.is/c++draft/dcl.init) | prvalue与初始化的相交规则，不扩大为任意返回都不移动；对象状态 |
| C07 | [位域](https://eel.is/c++draft/class.bit) | 布局/访问有实现与源规则，不是通用wire/MMIO安全保证 |
| C08 | [no_unique_address](https://eel.is/c++draft/dcl.attr.nouniqueaddr) | 属性许可不等于所有编译器一定节省空间；重叠/布局 |
| C09 | [atomic_ref](https://eel.is/c++draft/atomics.ref.generic) | 类型、对齐、寿命与访问条件，不是任意对象可无锁；原子视图 |
| C10 | [contracts](https://eel.is/c++draft/basic.contract) | 当前草案语义，不等于已测试C++23或通用证明器；契约 |
| C11 | [exception specifications](https://eel.is/c++draft/except.spec) | noexcept传播语义不同于不分配/无终止/时限；错误与优化选择 |
| C12 | [P2996R13](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2025/p2996r13.html) | C++26反射设计，提案内容与编译器实际支持分开；阶段与生成 |
| C13 | [P4197R0](https://www.open-std.org/jtc1/sc22/wg21/docs/papers/2026/p4197r0.html) | trivial relocation的C++29重议，不列为已交付C++26能力；重定位 |
| C14 | [friend](https://eel.is/c++draft/class.friend) | 精确源访问及非传递性，不是运行权限；封装与反射 |
| C15 | [默认参数](https://eel.is/c++draft/dcl.fct.default) | 求值、作用域和静态选择关系，不普遍套用所有语言；调用 |
| C16 | [重载选择](https://eel.is/c++draft/over.match) | 最佳选择后检查可访问性；不可预删private再声称兼容 |
| C17 | [lambda closure](https://eel.is/c++draft/expr.prim.lambda.closure) | 泛型closure的原生调用与捕获，非普通Rust Fn同形量化；高阶API |
| T01 | [GCC特性状态](https://gcc.gnu.org/projects/cxx-status.html) | 逐特性/版本状态，不是当前机器安装状态；反射/contracts/展开等供给 |
| T02 | [Clang Users Manual](https://clang.llvm.org/docs/UsersManual.html) | 严格浮点、环境与选项条件，不由默认优化证明定向舍入 |
| T03 | [Clang extensions](https://clang.llvm.org/docs/LanguageExtensions.html) | 厂商能力按准确语法/目标使用，不自动成ISO能力或所有平台支持 |
| T04 | [GCC labels-as-values](https://gcc.gnu.org/onlinedocs/gcc/Labels-as-Values.html) | computed goto属于GNU扩展，析构边界与普通goto不同；CFG |

## 抽象、策略与推理保持

这些来源只支持相交方法和理论边界，不指定核心对象数、必须安装的求解器或产品实现路线。

| 来源 | 支持命题、前提与使用 |
|---|---|
| [Spot ltlsynt](https://spot.lre.epita.fr/ltlsynt.html) | 输入/输出先后、可观察输入及实际控制器，校准因果策略；工具支持不代表任意域综合可用 |
| [Cousot：Abstract Interpretation in a Nutshell](https://www.di.ens.fr/~cousot/AI/IntroAbsInt.html) | 近似方向与抽象解释背景；具体共同见证/有限构造仍核本系统明确集合定义 |
| [Chatterjee等：Algorithms for Omega-Regular Games with Imperfect Information](https://arxiv.org/html/0706.2619v3) | 2007研究中的不完全信息与策略方法背景；本规范只采用明确有限安全/完成画像，不把论文全部结果或历史未知移植为现状 |
| [Lamport著作与辅助变量](https://lamport.azurewebsites.net/pubs/pubs.html) | 证明辅助量与真实可执行观察不同；目录只是定位入口，不单独作为某定理的证明 |

有限抽象的充分判据、共同交集、不可比较划分、容差链、知识更新、安全固定点与完成rank均在[方法正文](../../编译/有限抽象与观察策略.md)给出实际输入、算法和边界。仅改术语、给fixpoint标签或把反例放进容器不能消解这些义务。源到模型、逻辑基础、目标实现及现实环境仍分别核验。

## 证据不得越过的边界

同版本的一手资料、旧实验记录和当前运行结果不是同一来源。已取得的有限C++检查只能支持其准确输入、工具和选项；没有Rust/TS目标执行结果时不能宣称差分通过。设计案例V01—V40、结构反例和有限数学复算也不代签整个编译器、所有ABI、性能或部署。

反例推翻的只是其相交命题。已有成熟库和正确语义仍可采用；不以一项实现缺陷否定整个语言，也不以其他成功测试弥补本项缺失。是否比其他路线更快、更小或更易维护，按同任务、同依赖政策和同保证取得有依据的成本比较；当前资料不提供无条件全局排名。
