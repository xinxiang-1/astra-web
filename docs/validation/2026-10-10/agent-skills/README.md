# 技能配置验证

2026-10-10，软件基线前端483e3b4、后台66a62b7；本阶段仅开发工具和指导。范围、来源及失败记录见[配置指南](../../../development/agent-skills.md)，阶段见[技能接入](../../../plans/agent-skills-2026-10-10.md)。

- 官方quick_validate：四官方包及三个项目技能全部通过；原字符画9文件复制逐字节一致。
- 官方四包38文件通过[安装hash清单](../../../development/agent-skills.lock.json)核验；三个Junction目标正确，配置重复执行及VerifyOnly通过。
- 两个新PowerShell脚本与官方Windows截图脚本语法解析通过。桌面截图未端到端执行；浏览器截图是真实执行。
- [配置拒绝覆盖](./config-smoke.json)：在自有临时目录，VerifyOnly对缺失技能及人为修改文件返回预期错误，文件hash保持原样；明确UTF-8捕获复跑成功。
- [字符画协议工具](./optimizer-smoke.json)：合成manifest正常、同源跨split被拒绝、质量/平衡/速度三候选进入Pareto前沿，劣解及无效候选排除。没有渲染新作品或改生产默认值。
- [浏览器记录](./browser-smoke.json)：固定CLI0.1.22/Node24.12.0，真实Edge及既有4210生产预览，读取新快照填写假邮箱、切换邮箱tab和主题、390×844窗口截图，零console消息，关闭自有会话。沒有发码、提交登录或真实身份验收；手机仅改变窗口尺寸，不是真机或触控模拟。
- [亮色桌面](./login-light.png)、[暗色窄屏](./login-dark-mobile.png)实际查看：表单、文案与主题正常，无截断。快照见[初始页](./login-initial.yml)、[邮箱tab](./login-email.yml)、[暗色页](./login-dark.yml)。

最初npx.ps1帮助退出出现libuv异常，Windows入口改用npx.cmd后实际流程成功；最初Python默认GBK解码PowerShell错误失败，明确UTF-8后验证具体错误；首次索引因生成前检查其自链接失败，改为先生成再验证全部链接及hash。原失败输出保留本地，没有过滤为产品通过。未运行产品全量测试、Maven/数据库、真实认证/邮件/资金或部署验收。

[源文件索引](./source-index.json)记录本阶段源码、文档及精简证据的SHA256；不含令牌、环境配置、桌面截图或CLI私有会话。个人安装文件通过锁定清单复现，父工作区Junction通过配置脚本复现，不提交本机链接本身。
