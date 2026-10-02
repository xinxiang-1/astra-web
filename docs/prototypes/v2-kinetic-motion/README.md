# 六动效对比原型

开发服务运行后打开 `/docs/prototypes/v2-kinetic-motion/index.html`；三列分别为Studio移植层、0840f8b电影感以及当前生产电影感。原型使用真实Astra作品帧，支持六模式、三素材、时间定位、暂停、强度和Studio拖尾。

新表现直接导入生产Canvas工厂；上一版使用[独立对照源码](../../../scripts/fixtures/cinematic-v1-renderer.ts)，其主体来自0840f8b，保留原MIT声明，只调整类型导入位置。原型不是用户偏好训练数据，也不读取旧未消费最终图片。

运行 `node scripts/kinetic-motion-prototype.mjs`，设置 `ASTRA_KINETIC_OUTPUT` 为新的独占目录；保存18场景、源码hash、三列截图及全过程H.264。环境动效完整工程合同继续由 `studio-motion-contract.mjs --cinematic` 与正式编辑器/媒体脚本验证；本原型对比不替代商业审美或真机验收。

完整实施、失败和修复见[阶段记录](../../plans/kinetic-motion-iteration-2026-10-02.md)。
