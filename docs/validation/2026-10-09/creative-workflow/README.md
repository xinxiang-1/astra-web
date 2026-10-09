# 创作流程验证

对应[实施与边界](../../../plans/creative-ecosystem-2026-10-09.md)和[研究候选](../../../research/2026-10-09-creative-ecosystem/README.md)。2026-10-09，本机 Windows、Node24.12、Edge154 / Chrome157；生产页面消费最终 build，dev合同导入真实产品模块。源码、父提交与证据 SHA256 见 [source-index.json](./source-index.json)。原始日志保留字节，不归一化终端空格或换行。

## 通过的范围

- [Edge核心](./core-msedge.json)、[Chrome核心](./core-chrome.json)：各7组。1×精确保旧/浓度单调，两布局的区域RGB、自定义色、几何不变和作品恢复，有限尺寸PNG回退/禁止放大，以及3配方 `.astra` 往返。核心包含 Path SVG 的自定义颜色检查；不是完整所有风格组合矩阵。
- [Edge生产](./ui-msedge/report.json)、[Chrome生产](./ui-chrome/report.json)：各7组。真实控件自动调色、作品恢复、连续浓度末次输入、区域色、签名→IndexedDB→新标签项目→配方修改、新项目与重置默认“还原”。
- [Edge触控模拟](./ui-msedge-mobile/report.json)：390×844、hasTouch、减少动效，8组，含上述流程和真实tap/两页及新控件的横向边界。不是实体手机性能验收；当前配方采用已有引擎，未重跑六模式全部动态审美矩阵。
- [Edge彩烟生命周期](./smoke-msedge.json)、[Chrome彩烟生命周期](./smoke-chrome.json)：各2组。强制导入失败有可恢复提示，解除拦截后实际刷新成功；导入未完成时通过真实路由离页，无迟到canvas或页面异常。
- [开发依赖与普通彩烟](./smoke-dev.json)：5173和5210各自优化URL200，双浏览器无相关失败响应/页面异常。[SSR后日志](./logs/creative-smoke-after-ssr.log)在实际 configFile:false 身份SSR合同后再次证明这两个URL200。
- [既有PNG回归](./png-regression.json)：69组，默认PNG保持冻结旧实现合同。这份回归运行于最终仅增加配方控件class之前；随后PNG产品代码未再变化。
- 最终类型、相关ESLint及构建exit0。构建警告保留在 [原输出](./logs/creative-build-final.log)。[Impeccable检测结果](./design-detector.json)为无命中，不代表完整无障碍或视觉审美通过。研究视图只按本机SDK/React声明进行类型检查，未验证IDE运行时。

工程源是人工双色320×256区域图、21枚签名的 [作品文件](./source.astra-signature)。它用于识别调色/保存错误，明显淡且稀疏，不作为商业肖像示范。[桌面字符页](./ui-msedge/characters.png)、[手机字符页](./ui-msedge-mobile/characters.png)已查看，配方沿用既有控件风格；签名全页截图显示调色控件，创建/打开由合同验证。调色时间包含250ms合并及测试等待，不能当纯渲染耗时。

## 失败与修复

原输出在 logs：首次类型错误把要求File的图片API当URL调用，修为 Image.decode。核心R1/R2是验证脚本错误（属性序列化顺序、SVG真实hex）；R3发现派生项目缺 previewFontFamily，补产品字段与导出字体，随后通过。生产UI初次未展开高级面板、第二次类名错误，修为真实details操作。开发probe早期服务未就绪/未运行，服务恢复后200。最终suiteR1的手机脚本漏点“调整效果”页签，隐藏面板点击超时；补真实tap后suiteR2全部通过，没有为测试绕过产品交互。

早期生命周期日志分别保留，两浏览器曾共写一个JSON，早期EdgeJSON被覆盖，未伪造。最终按channel目录重新运行，现两份报告分别绑定suiteR2。截图与JSON来自最终suiteR2；source文件由核心生成，最后一次Chrome核心产出供后续手机合同使用。

## 重复运行

在三个终端启动服务，preview应消费当前生产构建：

```powershell
npm.cmd run dev -- --host localhost --port 5173 --strictPort
npm.cmd run dev -- --host 127.0.0.1 --port 5210 --strictPort
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1 --port 4210 --strictPort
```

服务就绪后，在另一终端运行 `npm.cmd run test:creative-workflow`。需要本机已安装Edge和Chrome。套件顺序执行核心→生产UI→生命周期（两浏览器），再手机模拟与双服务普通彩烟；核心先创建UI需要的可携带文件，输出保存在 test-results。

单项命令是 `test:creative-core`、`test:creative-ui`、`test:creative-smoke`、`test:creative-smoke-dev`。可设 `ASTRA_DEV_URL`、`ASTRA_SECOND_DEV_URL`、`ASTRA_PREVIEW_URL`；单项可设 `ASTRA_BROWSER_CHANNEL`，UI另有 `ASTRA_CREATIVE_MOBILE=1`。`ASTRA_CREATIVE_CORE_OUTPUT`同时控制核心输出与UI fixture来源；生命周期按浏览器分目录。服务器同端口复用或程序化启动请单独设置 `ASTRA_VITE_CACHE_DIR`。

## 未验收

真实手写/复杂背景/4K/实体触控性能、新形状匹配/笔迹显影/动作轨迹、统一工作流包、云同步、会员额度与真实资金均不能据此称完成。现有免费导出保持，后台本阶段只有文档。
