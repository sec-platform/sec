# 已定设计的局部正负见证与有限模型

本目录消费当前schema和原canonical规范；不建立另一个编译器或第二套语言。历史Gift95—107样本未被覆盖。十个开放意图的详细含义已写回原作者语义owner；本目录mapping只提供历史名到规范位置的导航，绝不是可执行Definition注册表。

## 实际可运行范围

`vectors.json`包含严格JSON、Requirement局部词法/类型、六工具参数及协商扩展、控制分片全局身份、调用观察相位、原生选择和结果覆盖的正负输入。`verify_contracts.py`使用jsonschema并另做明确局部检查：重复键、整数词元、Unicode代理项、路径、已给出的有限作用域/参数、分片关系和进展checker域。未由输入上下文给出的真实类型/描述符/引用不会被脚本凭名字解释。

脚本的有限模型包含区间精确覆盖、全部三节点有向图的可达/返回路径、Token旋转轨道和搜索预算、量词次序、正负精确除法、Unicode标量与UTF-16排序、请求代ABA、共享取消、未知作用身份、共享预算、控制耦合，以及动态最小ready排序与被环阻塞的后继。跨层三个反例只检查联合义务如何保留失败/未知，不执行真实业务。

```sh
python witnesses/challenges/Gift108/verify_contracts.py --root . --output /tmp/gift108-contract-check.json
```

需要Python 3.11+及jsonschema 4.x。测试工具自身的大小/深度限额仅是安全执行边界，不新增产品硬阈值。源快照CAS、真正语言的类型/效果检查、Target构建、FFI、现场性能、授权服务、Provider、持久恢复与C0—C3均不由本脚本执行。同一作者/同一Python运行时仍为共同信任基础；分别写的算法不等于独立第三方证明。

## 结构与运行资格

有schema不等于有生产decoder；有规范谓词不等于有执行映像；有checker引用不等于取得证据；transport完成也不等于Effect完成。旧样本和新规范接口有差异时必须显式迁移，保留原始输入，不由测试工具替用户静默改业务要求。
