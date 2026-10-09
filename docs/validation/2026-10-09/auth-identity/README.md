# 身份隔离验证

对应[阶段记录](../../../plans/auth-identity-2026-10-09.md)。生产应用使用当前 build，接口为受控响应；真实浏览器 Store 合同故意允许已取消请求返回，验证上层代次防护。

- [旧实现复现](./baseline.json)：记录精确父提交与三种覆盖。
- [Edge 18 合同](./edge-contract.json) · [Chrome 18 合同](./chrome-contract.json)。
- [Edge 生产 UI](./edge-ui.json) · [Chrome 生产 UI](./chrome-ui.json)。
- [源码与证据 hash](./source-index.json)。
- logs 保留基线失败、服务未运行的失败及最终成功、类型/lint/build 日志；不将受控接口称为真实后端认证。
