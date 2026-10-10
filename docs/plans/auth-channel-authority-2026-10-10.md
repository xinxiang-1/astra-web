# 验证码不能由前端模拟成功

源码检查：`src/api/auth.ts`走`/api/auth/captcha`、`/api/auth/email/send`、`/api/auth/sms/send`，HTTP网络失败/不成功状态/业务错误均抛错；auth store仅在await成功后显示成功，没有本地验证码生成、比对或成功回退。图形码可由仍运行的真实认证进程返回，即使IDE的启动项已关闭。

发现并修复的是后端占位发送适配器“没有发送也返回成功”；真实Nacos已关闭短信/微信，邮箱保持SMTP。后端验证码及权限边界详见兄弟仓库`astra-cloud/docs/plans/auth-channel-authority-2026-10-10.md`。

[前端失败合同](../validation/2026-10-10/auth-channels/frontend-failures.json)对实际auth store注入断网、渠道503、网关502、坏JSON和SMTP失败，两种发送都返回false，无成功文案、无pending悬挂。此测试不触达真实收件人；8项HTTP合同同时通过。

用户素材的字符画和GPU动效可以本地处理，但它们不负责认证、验证码、定价、订单、付费权限或私有文件授权。以后新增商业渲染任务由后端签发任务、限额与授权，浏览器不自行决定付费结果。当前GPU实验没有上传用户素材或启用收费服务。
