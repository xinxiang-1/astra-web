# 视频响应验证

[实施、失败与限制](../../../plans/video-responsive-playback-2026-10-04.md)。原始素材与报告留在 `test-results/video-responsive-final-fullscreen-edge-20261004/` 和 `test-results/video-responsive-complete-chrome-20261004/`，归档不包含生成 WebM 或冻结源码副本。

- [最终 Edge 报告](./edge-report.json)：24 组采样、18 组 Worker RGBA 零差、六模式实播、调度 / 取消 / 暂停 / 预解析 / 手机 / 回退，以及全屏关闭释放通过，`errors: []`。
- [Chrome 报告](./chrome-report.json)：相同采样 / 绘制 / 六模式实播与恢复检查通过，`errors: []`；在最后全屏释放及提示补充前运行，没有全屏新增断言。
- [最终 Edge 界面](./video-dark.png)：真实上传视频转换后的编辑器截图，不能单凭截图判断动态流畅度。
- [源码与证据 hash](./source-hashes.json)：当前生产源码、合同、冻结对照和归档证据的 SHA-256。`workingTree` 对应最终 Edge 验证源码；Chrome 执行范围按上述说明，不能将当前 hash 倒推为 Chrome 当时逐文件 hash。

采样和绘制的一致性对照均基于冻结 `6d140c2eb00fefafcf1be663ed05d30989200dac`。页面 rAF 仍有 GPU / compositor 掉帧，Chrome color 最大间隔 690.7ms；主线程 20ms timer 最大间隔 21.8–24.5ms，Edge 23.9–43.4ms。未验证真实网络 stall、长片、全部编码或低端设备。整体目标及商业审美不据本合同自动通过。
