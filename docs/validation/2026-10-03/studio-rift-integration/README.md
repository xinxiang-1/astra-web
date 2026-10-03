# Studio撕裂试用接入证据

归档期间用户要求暂停，整体目标当前paused；本页active描述保留阶段完成时的历史状态。最新已完成/待办及恢复入口见[暂停交接](../../../plans/project-pause-handoff-2026-10-03.md)，不据本页历史记录继续开发。

实现起点95b114b；新`rift`独立于旧`trail`，同一原生求解器与Astra字形工厂，冻结95b114b/v8为逐像素对照。步骤、失败、修复与边界见[接入记录](../../../plans/studio-rift-integration-2026-10-03.md)，长期要求见[Studio标准](../../../plans/studio-effects-standard.md)。

- [渲染合同](./renderer.json)：20模式/适用品质/透明场景，480正式rift与冻结v8精确帧、660旧悬停/环境帧精确；零强度/归位、缓存上限/销毁、统一包装器Canvas后端、原生完整求解器/首页保护文件保持。
- [真实作品包](./packages.json)：10图像模式/品质实际下载、全新浏览器存储导入、刷新及精确PNG；17损坏/越界原子拒绝、重复导入独立ID、存储失败、旧项目/视频素材与手机下载。
- [实际HTML/MP4媒体](./media.json)：选中rift的离线HTML保留参数；源视频选段与环境动画编码/解码比较。MP4没有指针轨迹，不将环境动画误称为录制交互。
- [最终正式页面](./editor.json)：六模式/适用品质实际路径、暂停/零强度/全屏/空闲/减少动效、十断网HTML、静态PNG配对、TXT/透明3840px输出和390px连续触摸；具体用例及电影元数据以原报告为准。
- [触摸修复前](./touch-before.json)、[修复后](./touch-after.json)：相同十步移动从1次move/1次cancel/0次release变为10次move/0次cancel/1次release。探针touchAction字段指父滚动区（一直auto）；仅作品canvas限制由最终页面断言。减少动效/原图/旧trail/零强度不限制页面滚动。
- [字体启动修复前](./font-startup-before.json)、[生产修复后](./font-startup-after.json)：同一品牌CSS请求保持pending，原同步link阻塞DOM/模块，修复后真实编辑器可启动；字体CSS地址/字体族保留，核心无需等待外部字体。不代表外部服务可用或已完成字体自托管/布局跳变验收。
- [交互原PNG](./during.png)、[恢复原PNG](./recovered.png)、[全过程三秒抽帧](./review.png)：人工查看范围写在阶段记录，不作为独立人类偏好/用户审美通过。
- [工程检查](./engineering.json)记录最终检查日志hash与已取得的exit状态；[来源与归档](./evidence-manifest.json)核对实际Git blob、原图与原始证据字节。工程日志/下载成品/完整录像保留在sandbox，避免重复加入仓库。

真实失败没有覆盖：[渲染R1](./renderer-failed-r1.json)为开发页面执行上下文销毁；[页面R1](./editor-failed-r1.json)点不存在品质，[R2](./editor-failed-r2.json)与[R3](./editor-failed-r3.json)遗漏真实彩色状态，[R4](./editor-failed-r4.json)未切手机页签，[R5](./editor-failed-r5.json)取到未绘制的全屏空画布，[R6](./editor-failed-r6.json)发现手机CSS隐藏唯一全屏入口，[R7](./editor-failed-r7.json)未等暂停状态完成绘制，[R8](./editor-failed-r8.json)被外部品牌CSS阻塞启动。阶段记录逐项说明修复；失败原始webm保留sandbox，不作为成功演示。

渲染/作品包/媒体报告生成在后来触摸修复之前，其原来源hash不改写。之后增加编辑器条件样式、移动全屏可见性、实际绘制观测属性、品牌字体非阻塞启动和离线触摸偏好处理，渲染器/序列化/MP4算法保持；最终产品type-check/lint/build、严格原型tsc和正式页面的HTML/触摸/PNG/TXT检查覆盖最终源码。最终来源hash单独记录在manifest，不伪称较早报告是在最终触摸源码上重跑。

操作入口：生产预览`http://127.0.0.1:5194/ascii-art`，上传素材后选择“动态效果 → 悬停 → 撕裂试用”；历史[v8原型](../../../prototypes/v8-studio-rift/index.html)用冻结工厂继续保留。所有已有输出免费。素材是内部验证输入，本阶段没有授权成商业模板、发布宣传或部署生产。

原色持续响应仍不足以认证真机/4K实时或60fps，试用也未获得用户审美认可。其他指针创新、商业画质/中文/签名、原创授权模板/宣传和前后端交易/退款/对账/云存储/最终部署继续，整体商业目标active。

最终R9页面20项与10份断网HTML全部通过；手机普通/全屏/离线各10move/1up/0cancel并精确归位。静态PNG开关hover配对、TXT与透明3840px实际下载通过。H.264/1440×960/54.48秒的完整成功影片仅留`sandbox/studio-rift-integration/2026-10-03-v1/editor-r9/studio_rift_editor.mp4`，SHA256 `bb39c0a578d9839bb40eef5fbf930cbc4ab81808c4210ba0f597312ae5f27209`。已查看三秒抽帧及两张原PNG；影片展示桌面十模式/品质，手机/输出验证由原报告证明，不宣称逐帧盲评或全部场景都在影片内。
