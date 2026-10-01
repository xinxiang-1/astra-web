# 统一字符艺术引擎

版本 `2.2.0`。`core.ts` 负责字体 atlas、源图面积采样、明暗/颜色与顺序文字；`canvas.ts` 负责共享图片、全屏、PNG、视频帧和离线网页的绘制。`embed.ts` 将独立采样/渲染工厂及真实字形 atlas 内嵌为离线 HTML。`index.ts` 的包装工厂根据功能选择已验证的实际后端。

六模式共用 `ArtFrame`：density、color、phrase、contour、braille、halftone。缺省设置保持经典输出；首页首屏仍独立使用原 Studio，不由此模块替换。

## 可选品质

- 单色图片 density：经典、精细（600 笔重 / high）、柔和（受预算约束的两倍采样）、还原（600 笔重 / softwareRaster）。
- 图片 color：经典、还原（600 笔重 / softwareRaster / colorFidelity）。还原颜色将源强度应用一次，色相与字形透明度分别存储；反相时沿用相反明暗语义。
- phrase、其他模式、着色 density 和视频：编辑器使用经典。未通过的光学字格、中文描边、gamma、700 笔重等实验没有进入生产 API。

`ArtSettings.softwareRaster` 只支持单色 density 和 color；不支持的模式忽略此请求。`colorFidelity` 只在 software color 且正常明暗方向时生效，缺省不改变颜色。品质值属于项目设置，纳入 watch、缓存键、脏状态与本地恢复。

## 绘制与内存

经典路径缓存逐色 ImageBitmap，字形 backing 上限16 MiB，饱和后复用 scratch；没有 OffscreenCanvas 时回退 Canvas。柔和的额外表面限制32 MiB、两倍尺寸最长边4096px，超限使用 high。

还原路径只从字体 alpha 构建积分表，按输出像素的实际面积采样，再进行预乘 RGB source-over；没有照片底图、逐色位图或颜色量化。分数位置按1/32px缓存，最大位置舍入误差1/64px；积分表+mask backing 上限4 MiB、最多16,384项。RGBA工作缓冲上限16 MiB，以行条带覆盖大输出。预算计算不包含最终输出 Canvas 或 Map/对象开销；8K输出仍需额外内存。字形 atlas 或输出几何变化会清理对应缓存；destroy 释放持有的字形、mask、工作表面和颜色 probe。

六种 motion（breathe/wave/assemble/current/reform/caustics）与九种 hover（displace/light/ripple/trail/water/silk/vortex/contour/dissolve）保持布局方向和顺序文字语义，各自另有关闭选项。速度、强度和悬停范围进入保存、作品包、HTML和视频快照。`classic` profile保留旧公式；新编辑器默认 `expressive`，旧缺字段项目使用classic。新增效果与品质请求使用Canvas，工厂backend报告实际路径。

字形光晕使用真实glyph遮罩，最长边1536、像素backing最多9MiB；拖尾最多10点、0.7秒。环境暂停只冻结artElapsed，独立interactionTime继续指针响应；越界/抬手按实际时间渐隐。没有照片底图或文字旋转。新效果会增加绘制成本，不能沿用静态品质档的计时承诺实时帧率。

## 验证与范围

`npm run test:art-effects`覆盖独立旧Canvas静态兼容、全部效果的参数/相位、真实UI、全新存储恢复、断网HTML和触控模拟；`test:art-effects-media`使用ffmpeg/ffprobe验证实际H.264参数快照。默认输出目录不能已存在，复跑使用新的 `ASTRA_EFFECTS_OUTPUT` / `ASTRA_EFFECTS_MEDIA_OUTPUT`；服务器地址用 `ASTRA_PREVIEW_URL`。本轮生产证据和全部失败说明见 [效果记录](../../../docs/plans/art-effects-iteration-2026-10-01.md)。

`npm run test:art-software` 在 train/dev 上核对选择性生产迁移、720/1080/3840透明与不透明实际像素、包装工厂、释放、六模式缺省以及不支持的请求；不重新使用已消费 holdout。`npm run test:art-quality` 检查原精细/柔和迁移；`npm run test:art-editor` 检查真实下载、本地恢复、移动布局、离线 HTML、全屏和选段视频。生产 minify 后用 `ASTRA_PREVIEW_URL` 指向本地生产预览再运行编辑器合同。

quality-v5 的软件两模式通过12个开发来源和唯一3个新最终来源。120列/720px/本机 Chromium153 + Intel UHD770 D3D11 的完整 wave 帧 P95：开发最高18.9ms，最终最高14.2ms。该结果不是跨设备、全部字体、视频或4K实时认证，商业审美仍需真实用户与素材验收。中文低对比失败和全部实验记录见 [quality-v5 工程记录](../../../docs/plans/art-quality-v5-iteration-2026-10-01.md)。

后续中文quality-v6已按两轮上限停止，候选留在sandbox。实际宽度排版改善混排与标点，但通用文字扩展仍失败，未晋升；没有改变此模块2.2.0实现、默认或首页。源码快照、失败样例和未消费最终来源说明见 [quality-v6工程记录](../../../docs/plans/art-quality-v6-iteration-2026-10-01.md)。
