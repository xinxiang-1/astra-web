# 开发技能安装与项目接入

用户要求按需配置可用技能。新增四个官方技能：Playwright、Screenshot、Security Best Practices及Security Threat Model；保留Impeccable。接入现有字符画优化技能，新增前后端验证技能，并为从双仓库父目录启动的工作区创建指向真实技能目录的Junction，避免内容重复维护。

完整来源、自动匹配、Windows调用、可复现配置及失败/限制见[配置指南](../development/agent-skills.md)，[验证记录](../validation/2026-10-10/agent-skills/README.md)。官方包固定commit并锁定38文件hash，项目技能保持自动调用，前后端AGENTS按任务路由。

七个技能清单、PowerShell解析、安装完整性、配置幂等及拒绝覆盖检查通过；实际Edge登录页调试/截图和合成字符画协议工具检查通过。没有对产品画质进行调优、没有桌面截图端到端测试、没有运行安全审计或真实认证/数据库/资金验收。

本阶段独立提交推送；原无关dirty保留。下一阶段先处理邮箱验证注册与真实auth token跨服务联调，继续产品品质、服务端权益/会员和可复现部署，技能安装不代表商业整体完成。
