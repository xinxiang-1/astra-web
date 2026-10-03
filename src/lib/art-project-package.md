# Astra 作品包 v1

编辑器“下载作品包”保存当前作品，包括未保存的调整；项目页可下载已保存项目，或导入 `.astra` 文件。免费、本地处理，无需账户。包包含完整源文件，因此可能含用户私人素材；只分享自己愿意交付的源文件。

`art-project-package.ts` 导出编解码与兼容检查，IndexedDB 写入仍由 `art-projects.ts` 负责。导入必须在所有校验成功后调用 `saveArtProject`，每次生成新 ID，不覆盖原项目。普通历史项目新增可选 `engineVersion` 字段，无需更改数据库版本。

文件布局：8 字节 UTF-8 `ASTRA01\n`，4 字节 little-endian manifest 长度，32 字节 manifest SHA256，然后为 manifest UTF-8 JSON、原始源字节、缩略图字节。两项资产的大小、MIME 与 SHA256 在 manifest 声明；长度必须精确匹配，拒绝尾部多余字节。没有压缩/ZIP/Base64 素材，SHA256 用于完整性，不提供作者身份、交易授权或商用许可证明。

源素材上限 64 MiB、缩略图 2 MiB、manifest 64 KiB；在读取大块字节前拒绝超限。浏览器 SHA256 会读取一项完整资产，内存开销随原始素材增加，不承诺低内存设备。图片实际解码后限 32M 像素/最大边 16384；缩略图限 2M 像素/最大边 4096。视频验证元数据、尺寸、选段与读取超时，没有认证全部 codec、长媒体或完整音轨导出。

manifest 版本 1，包含项目名、所有保存参数、源 File 的 name/type/lastModified、缩略图、已知引擎版本和字体环境说明。未知包版本、已知但不兼容的引擎版本、未知/越界参数、不可解码素材均拒绝。旧项目缺版本时保留原 legacy/参数，并提示打开检查。标题通过 Vue 文本绑定呈现，不执行文件中的代码。

包携带字体设置，不分发系统字体，也不捆绑历史引擎程序；跨设备字体/浏览器可能改变可编辑作品画面。需要固定成品时可同时保留 PNG 或含字形图集的离线 HTML。当前包用于继续编辑和备份，不是 DRM 或已上线付费模板授权系统。

验证入口：`node scripts/art-project-package-contract.mjs`。用 `ASTRA_PACKAGE_OUTPUT` 指定不存在的独占输出目录，`ASTRA_PREVIEW_URL` 指定开发或构建预览地址；拒绝覆盖旧报告。具体本轮证据见 `docs/plans/project-package-iteration-2026-10-01.md`。

2026-10-03增加`artHover: rift`试用选项，仍使用v1包布局和现有artHover参数；源素材、强度/范围、脏状态与恢复共用既有合同。当前读取器接受该标识，旧读取器遇到未知枚举会拒绝，不能据引擎版本相同保证旧程序可打开新增效果。静态采样/旧效果不变，未把试用选项作为已通过商业审美的模板能力。设置`ASTRA_PACKAGE_HOVER=rift`可运行实际UI下载、空存储导入和参数/PNG恢复；步骤见[接入记录](../../docs/plans/studio-rift-integration-2026-10-03.md)。
