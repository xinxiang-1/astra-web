# 前后端阶段交付 — 2026-10-01

交付对象：`xinxiang-1/astra-web` 和 `xinxiang-1/astra-cloud` 的当前main阶段改动。商业总目标继续执行，本轮不是正式收费上线。

## 前端范围

累计交付统一六模式编辑器、图片品质档、签名生成快照/镂空、免费离线输出和完整作品包、原创Logo、官网其他区域交互和类型修复。本轮完成九种悬停、六种微动及强度/范围/速度，旧项目classic兼容、新作品expressive、独立暂停、真实字符光晕和导出快照。首页Studio原参数 trail .65、radius .38、current .45保留，首屏不新增滚动位移/缩放，文字方向保持。

执行小步与全部失败见 [动效记录](./art-effects-iteration-2026-10-01.md)、[作品包记录](./project-package-iteration-2026-10-01.md) 与各画质/签名轮次。失败候选继续隔离，不将未通过实验接入生产。

## 后端范围

JWT必要身份声明校验、网关清理伪造身份头、认证401/基础设施503/业务异常边界分离、UserContext清理和16项JUnit。详情见同级 `astra-cloud/docs/plans/auth-boundary-iteration-2026-10-01.md`。未完成真实基础设施联调、支付订单和生产配置验收。

## 本轮验证

- 前端严格vue-tsc、相关ESLint和生产Vite构建通过，已有大包/stream外置等警告保留。
- 效果开发API/真实UI、生产10场景、断网HTML、暂停hover/触控、实际H.264参数编码通过。
- 原作品包10场景、17非法包及存储不足无写入、旧项目/视频/手机回归通过，首页13组hover通过。
- 后端JDK21/Maven3.9.11全7模块verify通过，common3、gateway6、auth7项JUnit通过。
- 前端精简报告与截图在 `docs/validation/2026-10-01/`；后端测试摘要在其对应目录。原始大图、视频、研究副本和失败证据继续保存在本机独占目录。

复跑效果检查先启动开发或生产预览，使用新的输出目录：

```powershell
$env:ASTRA_PREVIEW_URL='http://127.0.0.1:5194'
$env:ASTRA_EFFECTS_OUTPUT='test-results/effects-new-run'
npm run test:art-effects
$env:ASTRA_EFFECTS_MEDIA_OUTPUT='test-results/effects-media-new-run'
npm run test:art-effects-media
```

媒体检查需要ffmpeg/ffprobe及Playwright Chromium。研究型quality/software/render-cache脚本需要文档所述本机sandbox快照；video-cache需要先运行编辑器合同生成短片。sandbox研究命令、旧基线复现及宣传渲染不是新clone可直接运行的默认构建条件。新效果合同自带独立旧Canvas fixture。

## GitHub MCP规则

用户指定：本次及以后提交推送使用GitHub MCP配置账户 `xinxiang-1`。核验连接身份、仓库、main基线后创建blob/tree/commit并非强制更新ref；验证远端tree与本地索引一致，再同步本地HEAD。禁止换用其他CLI账户绕过仓库权限。无关工作区状态、`.cursor/`、研究源图/克隆、大体积输出不混入功能提交。

提交与推送状态以本轮交付回执中的实际SHA为准；本文件记录范围、验证和永久偏好，避免把尚未执行的推送写为完成。

研究目录只提交自写结论、来源元数据与许可正文；下载的第三方README、HTML和案例截图按原字节保留在本机，不作为产品素材发布。相关文档中的这些原始资料路径属于本地研究证据。

## 下一阶段

FE002动效子项完成；S1整体和S2尚未验收。下一项是无效上传保留作品、离开保护和授权原创模板样品，再完善商业/交易PRD，开发商品/订单/权益/支付，完成真实联调、公测、部署和商业验收。剩余工期假设见 [总计划第8节](./product-master-plan.md)：范围冻结且每周35–40小时约4–6周；每周20–30小时且持续审美迭代约6–10周或更长，按验收门槛交付。
