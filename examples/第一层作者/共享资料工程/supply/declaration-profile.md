# 被动目标值的声明与准确解释

本文件是`profile:passive-typescript-values:1`的设计内容，配合[真实声明](boundary.d.ts)及[原生选择](boundary.selection.json)解释这七个公开符号。它不是已安装的Provider或可执行body；原生读取器、接受合同绑定、实现及目标运行资格均未执行。声明、下面的有限完整解释和源选择共同给出可独立检查的**声明与语义来源**，不得从`.d.ts`推断运行实现存在。

## 类型、输入与观察边界

`TargetPassiveValue`是被动宿主值的保留视图：null/undefined、boolean、primitive Number（含NaN/Infinity/-0）、bigint、symbol、原始UTF-16 string，及由普通数组/数据记录构成的有限可共享、可循环图。Proxy、accessor、可执行对象及读取会触发任意用户代码的宿主对象在原承诺域外。不能声称能够先安全识别所有Proxy，再将任意JS值强行纳入承诺域。

“普通数据记录”准确指具有ECMAScript ordinary own-property内部方法、不是Array或callable、全部own属性为数据属性的对象；包含null-prototype、其他realm的普通对象及满足这些条件的被动class实例。原型身份及原型上的方法不影响分类，也不读取它们；带私有内部槽的其他exotic/宿主对象不因此进入范围。方法须由既有输入资格取得该类别，不能用同realm的Object.prototype相等测试缩域，或调用toString/valueOf猜品牌。

声明中的私有brand不要求宿主值带该字段，不序列化或复制整图；其源身份来自原生type符号和本profile。实际观察只在调用所需路径发生，不在进入产品Closed守卫之前预先扫描raw。模型中的不可变观察与物理可变对象区别保留：方法在同次同步、无重入、无并发修改的允许窗口取值；更强并发需求不由本profile提供。

视图及由它得到的子视图保持相同调用/输入的来源与寿命。在该稳定调用窗口内允许共享只读视图、重复传参和建立临时序列/记录（包括Enumerate的index/value）；这些容器、子视图和闭包共同携带同一来源寿命，不因此变成可跨调用保存的已拥有资料。退出窗口不得逃逸，不能放入持久组件状态或返回给外部消费者。原生Profile取得的签名须把这些参数解释为共享只读借用，并将结果中的视图寿命关联原输入；`.d.ts`的readonly、brand或名义引用本身不提供Region资格。原通用库的值类别、借用、捕获和清理检查仍须允许本次局部用途后才能采用。

下面函数无用户代码调用、无写入或外部IO；得到的普通Text/Int值不保留可变宿主别名，可以独立保存。只读和有限输入不签发物理内存/时间上界，分配失败或宿主终止也不成为业务InvalidInput。

类型解释固定为：被选择的TargetPassiveValue进入原Type名义空间；`boolean→Bool`，`bigint→Int`，已合格`string→Text`，`readonly T[]→Sequence<T>`。Int为精确数学整数，Text为有限Unicode标量序列，采用逐标量相等且不正规化。数组源次序与重数保持；Readonly的TS表面本身不证明深不变、借用或完整观察，仍须本合同及真实Method资格。

这里的string解释逐签名取得精化：ScalarTexts从raw primitive string检查并取得Text；ScalarLength与FieldValues的key、HasExactlyKeys的keys只接已合格Text。ImportedModuleView必须保留这项输入域，不能把TS的任意string（其中仍可含孤立代理项）自动提升为Text。未取得精化是资格缺口，不能由ScalarLength返回0来掩盖；直接绕过Gift合同调用声明不在其已承诺调用范围。

## 六个普通供应函数的完整有限解释

以下函数均对其声明范围有唯一结果。返回0或1项序列表示“没有/有一个有型解释”，不是未知证据、不完整搜索结果或空数组资料；合格方法尚未取得的Need不能编码成空序列。

| 声明 | 准确结果 |
| --- | --- |
| DenseArrays(v) | v为真实Array，存在own length数据属性，0到length−1均为own数据位置，且own键恰为这些索引及length时，返回一项序列，其唯一项为依位置排列的子视图序列；否则返回空。空Array返回`[[]]`。拒绝孔洞、额外string/symbol键和访问器；不调用迭代器。 |
| FieldValues(v,k) | v为普通数据记录且具有准确名为k的own数据属性时，返回该值的单项视图序列；否则空。不从原型补值，不将symbol键按显示文本匹配，不发生字符串强转。 |
| HasExactlyKeys(v,keys) | keys有重复时false；否则仅当v为普通数据记录、每个own属性均为数据属性，且全部own string键与keys逐字相同且无额外symbol键时true。键次序不影响集合相等，大小写/正规化不折叠。非枚举属性也参与，Array和null不当记录。 |
| NumberIntegers(v) | v为primitive Number且有限、数学上为整数时，返回其**实际binary64数值**对应的精确Int单项序列；否则空。-0映为0。已经发生的输入浮点舍入不被恢复成调用者想象的整数，不强转bigint/字符串/包装对象；0..9是应用政策，不在本函数中。 |
| ScalarTexts(v) | v为primitive string且全部UTF-16码元构成合法标量编码时，返回相同标量序列的Text单项序列；否则空。配对代理项合为一个标量，孤立高/低代理项拒绝，不替换、不正规化。空字符串返回一项空Text。 |
| ScalarLength(t) | 对已经合格的Text，返回其标量序列长度Int。UTF-16方法逐项消费一个非代理码元或一对合格代理码元，每次加1；有限长度严格减小。它不是UTF-16 length、UTF-8字节数、字素数或物理内存。 |

有限方法路径来自成熟ECMAScript能力：[own属性描述符](https://tc39.es/ecma262/2024/multipage/fundamental-objects.html#sec-object.getownpropertydescriptors)、[全部own键](https://tc39.es/ecma262/2024/multipage/reflection.html#sec-reflect.ownkeys)、[Number.isInteger](https://tc39.es/ecma262/2024/multipage/numbers-and-dates.html#sec-number.isinteger)及原字符串码元表示。实现固定可信内建函数，不调用被替换的全局、用户getter或迭代器。资料形状只观察数组及条目一层属性，不需展开任意对象图；循环值若落到需要数值/文本的位置，由对应标量分类拒绝。

这些原生能力只支持上述有限方法的可实施性，不能代替本profile的值域、借用、纯性和同次观察证明。实际函数body、可信intrinsics绑定、Reader/原生类型适配和目标运行仍为NOT_IMPLEMENTED。本阶段没有安装包或生成应用TS代码。

## 源绑定及业务边界

selection采用`gift.native-binding-selection/design-converged`，准确列出真实`.d.ts`导出。`role:type`仅发布名义类型，callable/predicate分别进入其原符号空间；公开函数签名可达的其他私有类型不自动获得公开出口。profileRef固定本文件ID与内容；后续实际锁还须绑定文件字节及原生工具链，不能依ID相同复用任意内容。

应用的score/text字段、0..9范围、10000/100000容量、≥/＞政策、Closed优先、共享/独立状态及关闭责任必须留在应用源。六个叶不接受工作区、业务错误枚举或“过滤”能力名，不产生应用成功结果。未提供的观察采集、组件构造与TS产物实现不得冒挂到这份声明下。
