# 内容合集联调证据

[实施、失败、修复和限制](../../../plans/catalog-ui-2026-10-08.md)。

- [summary.json](./summary.json)：源SHA256、验证计数和实际限制。
- [empty-browser-report.json](./empty-browser-report.json)：真实空目录、三款免费模板入口及实际新项目保存。
- [browser-report.json](./browser-report.json)：十项有商品浏览器检查与30次真实gateway GET；两个503注入单列，正常响应与404来自实际后台。
- [schema-report.json](./schema-report.json)：225次实际HTTP，217商业响应schema通过；浏览器32请求与后台193请求均纳入，原HEAD/ping边界仍由JUnit验收。
- [桌面截图](./catalog-detail-desktop.png)、[390px暗色截图](./catalog-detail-mobile.png)：已查看实际页面布局。桌面截图在版本选择操作后的滚动位置捕获，sticky摘要按当前视口定位；模拟视口不代表真机。

最终R2相关全七模块verify成功，15项真实JUnit，0失败/错误/跳过；两组共12浏览器检查。type-check、七个相关文件ESLint和production build通过。独占MySQL库删除及gateway终止已验证，共享Redis保留；浏览器匿名，没有auth模拟或资金写入，数据库断言目录浏览时订单/支付均零。

原失败与原始完整日志留于独立tmp，首轮筛选保留误判修复后通过。图片为原免费模板测试preview，不是正式付费商品；不证明完整购买/会员/真实商户资金、真实设备、原创商品画质或生产部署完成。
