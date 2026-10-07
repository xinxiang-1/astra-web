# 双色、Riso 与波普字符印刷候选

同一素材、尺寸、列数和真实字形比较三种算法。支持三套配色、中文短句、1K/2K、上传、取消、原大缩放及免费PNG。它是独立研究页面，没有修改正式编辑器或签名模式；中文短句是平台印刷字体，不是完整手写签名。

仓库根目录运行：

```powershell
npm run demo:portrait-print
```

打开 `http://127.0.0.1:5186/docs/prototypes/v13-portrait-styles/index.html`。独立打包保存在ignored `test-results/portrait-print-bundle`，只复制两张已有公开示例，不包含上传图片。开发服务也可打开同一路径；开发工具浮层不属于作品PNG。

独立预览的创作工具链接指向5180的主应用；主应用服务需另外启动。其它地址可在打包前设置`VITE_ASTRA_APP_URL`。主题沿用`astra-theme`存储键，同源开发页面共享偏好，独立端口各自保存。

```powershell
npm run check:portrait-print
$env:ASTRA_PREVIEW_URL='http://127.0.0.1:5186'
# 独立算法审计读取开发服务，先在另一个终端启动 npm run dev -- --port 5180
npm run test:portrait-print
```

`ASTRA_BROWSER_CHANNEL`可选`chrome`/`msedge`。`ASTRA_PRINT_SOURCE`指定本机图片，`ASTRA_PRINT_OUTPUT`指定ignored证据目录，`ASTRA_PRINT_RECORD=1`保存操作录像。私人图片及衍生结果只留在本机，不加入public或提交。

三幅完整生成后才替换上一组；取消/错误释放候选并保留原作品。控件待应用，主题与缩放不会启动新任务；PNG来自当前已提交画布。Worker以消息队列分段，让取消消息可处理，不插入嵌套定时器延时；字形与成图使用一致的CPU画布路径。

实际公式、失败、验证和限制见[阶段记录](../../plans/portrait-print-styles-2026-10-07.md)。实体色准、完整手写签名、正式项目及HTML/视频输出合同还需要后续接入与验收。
