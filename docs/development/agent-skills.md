# Astra 开发技能配置

2026-10-10。用户授权按项目需要选择、安装并配置技能。本阶段使用 `skill-installer` 安装，使用 OpenAI Docs 核对发现规则，使用 `skill-creator` 与 `create-rule` 接入项目技能及持久指导。之前个人安装只有 Impeccable，环境还自带一组技能；原字符画技能仅在 `.cursor/skills/`，尚未进入本工作区的 Codex 发现目录。

## 已安装与适用范围

新增四个官方技能，位于 `%USERPROFILE%/.agents/skills/`：

- `playwright`：真实浏览器导航、表单、快照、截图与调试。使用下面的 Windows 入口；项目已有 Playwright 回归脚本继续使用。
- `screenshot`：明确请求桌面截图，或浏览器截图无法覆盖的问题。网页证据优先用浏览器；内部检查保存到临时目录，桌面原图不自动入 Git。
- `security-best-practices`：明确的 Vue/TypeScript 安全审查及安全实现请求；官方参考包含 Vue，语言范围为 Python、JavaScript/TypeScript、Go，不覆盖 Java。
- `security-threat-model`：明确的登录、交易、私有交付威胁建模请求；根据仓库证据分析边界和滥用路径。安装本身没有运行审计或修改认证代码。

来源为 [openai/skills 固定版本](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated)，commit `49f948faa9258a0c61caceaf225e179651397431`。四个包的 Apache-2.0 `LICENSE.txt` 及其余文件保留原样，[锁定清单](./agent-skills.lock.json)记录全部38文件的大小和 SHA256。没有安装重复系统技能，也没有附加收费账号或 MCP。

保留已安装的 `impeccable`，用于界面设计与体验改进。接入三个项目技能：

- [ascii-engine-optimizer](../../.agents/skills/ascii-engine-optimizer/SKILL.md)：从原 `.cursor/skills/` 完整复制，9文件逐字节一致；原未跟踪目录保持原样。正式维护入口为 `.agents/skills/`，用于字符画质量/性能实验，普通 UI 修改不启动实验循环。
- [astra-web-validation](../../.agents/skills/astra-web-validation/SKILL.md)：前端类型、相关 lint/build、身份及本地/已购工作流合同与浏览器验收。
- [astra-cloud-validation](../../../astra-cloud/.agents/skills/astra-cloud-validation/SKILL.md)：JDK21/Maven3.9.11、静态合同、资源归属明确的后台联调与证据范围。

## 自动发现与调用

[官方发现规则](https://learn.chatgpt.com/docs/build-skills)支持仓库 `.agents/skills/`、个人 `~/.agents/skills/` 和技能目录链接；根据 description 自动匹配任务。三个项目技能的 `allow_implicit_invocation` 均为 true，四个官方技能保持默认自动匹配，现有配置无禁用技能项。新安装技能下一轮可用；若未出现，重启 Codex 刷新。

本机从 `E:/project/astra` 启动，子仓库技能不会因为放在子目录就自动暴露给父工作目录。因此在工作区 `.agents/skills/` 创建三个 Junction，分别指向两仓库的真实技能目录；链接本身为本机配置，内容与源码一起版本化。进入任一仓库时直接发现该仓库技能。前后端 `AGENTS.md` 记录选择条件，按任务读取技能，不要求用户每次选择。

技能不会替代用户授权或仓库约定。已有阶段提交/推送授权继续有效；实验迁入受保护首页、付费外部评估、生产操作仍依实际请求与范围处理。不会因技能中泛化的确认措辞重复询问已授权的例行开发。

## Windows 入口与复现

两个仓库按当前布局放在同一父目录，使用现有 Codex 内置安装器、Python、PowerShell及 Node/npm：

```powershell
cd E:/project/astra/astra-web
./scripts/configure-agent-skills.ps1
./scripts/configure-agent-skills.ps1 -VerifyOnly
./scripts/agent-playwright.ps1 -Session astra-debug -CliArgs @('open','http://127.0.0.1:4210/login','--browser','msedge')
./scripts/agent-playwright.ps1 -Session astra-debug -CliArgs @('snapshot')
./scripts/agent-playwright.ps1 -Session astra-debug -CliArgs @('close')
```

[配置脚本](../../scripts/configure-agent-skills.ps1)仅安装缺失包，固定源 commit，并校验全部文件。已有技能内容或链接不一致时拒绝覆盖；`-VerifyOnly` 不下载、不创建链接。可通过 `-InstallerScript` / `-UserSkillRoot` 指定环境路径。不写令牌、全局权限或其它账号配置。

[浏览器入口](../../scripts/agent-playwright.ps1)固定 `@playwright/cli@0.1.22`，在 Windows 使用 `npx.cmd`，以参数数组传入并隔离会话。官方 Bash wrapper 在本机没有 Bash 可用，不能直接照搬；适配器与官方 CLI 使用同一工具。调试证据保存到 `output/playwright/`，以最新快照的 ref 操作，完成后仅关闭本次会话。

## 本阶段验证与限制

- 七个 `SKILL.md` 通过官方 quick_validate；四官方包38文件 hash 与清单一致；三工作区链接目标正确，重复配置/只验证通过。
- 新配置/浏览器脚本及官方 Windows 截图脚本通过 PowerShell语法解析。截图技能本阶段未捕获用户桌面；没有将语法检查称为桌面截图端到端验证。
- 实际 Edge CLI 打开既有4210生产预览登录页，填写公开假邮箱、切换邮箱 tab、切换主题、调整390×844窗口并截图；无提交、发码或登录。检查页面零 console消息，并关闭自有会话。[页面证据](../validation/2026-10-10/agent-skills/README.md)。
- 字符画工具用合成协议数据验证正常manifest、同源跨split拒绝，以及三种质量/性能取舍的Pareto筛选；不是实际图像优化或审美验收。
- 配置脚本在独立临时目录验证缺失包与被修改文件均按预期拒绝，修改文件hash不变。首次Python捕获PowerShell错误用了Windows默认GBK，出现reader解码错误；改为明确UTF-8后重新验证并匹配具体错误，失败原始日志保留本地。
- 最初 `npx.ps1 --help` 显示帮助后出现 libuv退出异常；Windows适配改用 `npx.cmd`，版本/命令帮助及实际浏览器流程成功。只记录本次观察，不推断已修复所有Node退出问题。
- 首次证据索引生成先检查README链接，因索引尚未写出而失败；调整为先生成索引，再验证包括自链接在内的全部文档链接，并核验源hash。该失败属于归档顺序，不是页面失败。
- 只变更开发技能、工具、指导及阶段文档；未改产品行为，未重跑产品全量测试或数据库联调。后端邮箱验证注册、真实auth JWT跨服务、会员、真实渠道与可复现部署仍按原计划继续。
