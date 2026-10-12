# Gift141：多输出根的精确发生点身份与全局资格边界（设计范本）（历史研究说明）

原范本是既有 `gift.project/1.targets[].outputRoots[]` 的两个选中发生点：`primary`、`secondary`。两者都选择同一 `module:ide-system/IDEProduct`，但有不同的根上下文绑定（示例 workspace A、workspace B）；每个根下的 `EditorA` 等组件实例名仍只属于**该根的独立命名空间**。

`rootId` 不是新Definition、绑定注册表或第二套工程语言。对新写的多根Target，`rootId`为必填稳定发生点身份；既有单根缺省规范化为 `main`（不改变其原始源码字节）。重复rootId、缺名多根、非法选中根或根上下文错误均在受限检查中被拒绝。

**两根局部结构通过，不能推出完整系统通过。** 两根可以出现相同或不同的业务对象声明；引用字符串相同也只能构成跨根Alias候选。共用外部Resource/Authority/Effect/全局实例标识或部署Placement必须等待签发的交集图、容量、权限、命名空间与联合要求证据。缺独立接受基线时保留Needs；原范本不擅自发明用户接受过的Goal。

此处 `--expected-hard-root` 只是测试提供的**独立结构预期**，不是签发的接受记录。不会执行TS/Rust生成或部署。

两个范本中的`SaveButton.actionRef=platform:SaveAction`仅代表用户意图触发（`domain:meaning operation`）；真正FilePort保存Effect由Workflow/Method等后续获资格者执行，不因UI节点本身触发两次。
