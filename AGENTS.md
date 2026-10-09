# Astra 开发约定

本文件适用于整个前端仓库。用户的后续明确指令优先。

## 开发技能

- 改动前端行为及页面验收时使用 `.agents/skills/astra-web-validation/SKILL.md`；界面设计按需使用已安装的 `impeccable`，真实浏览器调试使用 `playwright`。
- 字符画参数、算法或性能的可复现实验使用 `.agents/skills/ascii-engine-optimizer/SKILL.md`。普通 UI 修改不启动优化循环，实验留在 sandbox，正式默认值遵守 Studio 保护范围及用户授权。
- 明确的 Vue/TypeScript 安全审查使用 `security-best-practices`；明确的登录、交易或交付威胁建模使用 `security-threat-model`。Java 检查使用 Spring 官方资料及后端合同，不能把前端技能当作 Java 审计覆盖。
- 桌面截图请求或浏览器截图无法覆盖的问题使用 `screenshot`；普通页面证据优先用浏览器截图。技能说明先阅读，按任务选择，不为纯文档修改运行全部产品测试。
- 安装来源、Windows 入口、复现与验证见 [技能配置](docs/development/agent-skills.md)。当前技能阶段不接入额外收费服务。

## Studio 特效底座

- 开发作品 hover、动效或展示效果前，阅读 [Studio 特效标准](docs/plans/studio-effects-standard.md) 和其中链接的最新阶段记录；该文档是路线与验收标准的统一来源。
- 用户要求后续效果对标原生 Studio，并在 Astra 引擎上创新。复用已移植的原生交互场，结合 Astra 六模式、字形、中文、品质及导出能力。
- 场实现位于 `src/lib/art-engine/canvas.ts`。`createCanvasArtRenderer().sampleInteraction()` 提供只读位移、密度及拖尾位移；当前不返回原始速度，不把位移误当作速度。
- 新效果须具有连续输入反馈、可辨识的主体、局部细节、自然余波和复原。保留真实时间戳与合并指针事件，不用光点串替代流体拖尾。
- 首页主图及原 Studio 参数受保护：`ArtHomeView.vue`、`CharacterArtwork.vue`、`src/lib/ascii/studio-preview.ts`；trail .65、radius .38、current .45。未经用户明确要求，不改变首屏 hover 或增加首屏滚动缩放/位移。
- 文字保持正向与中文句序，真实字符构成画面；保留第三方 MIT 许可。静态、预览、全屏和输出使用同一作品及参数合同。
- 新效果先做可操作原型并保存动态证据，再按标准验收六模式、适用品质、触控、减少动效、暂停、全屏、离线 HTML 及项目恢复；只有像素变化不代表审美通过。
- PNG、透明 4K、TXT、视频、HTML、本地项目及 `.astra` 继续免费。

## 阶段记录与提交

- 每个可验收小阶段记录实施、失败、修复、验证、限制及下一步，放在 `docs/plans/`；精简验证证据放在 `docs/validation/`，原始实验留在独立 sandbox。
- 根据实际变更运行检查：产品代码使用 `npm run type-check`、相关 ESLint、`npm run build` 及对应合同；纯文档变更检查链接、差异和事实，不声称重跑了产品测试。
- 完成阶段后独立提交并立即推送，使用 GitHub MCP 配置的 `xinxiang-1` 账户，再通过官方 MCP 核验远端 SHA。不得切换其它账户、泄露令牌、强制覆盖远端或批量加入无关文件。
- 已有工作和研究输出须保留。局部阶段完成不等于整体商业验收、部署或真实收款完成。
