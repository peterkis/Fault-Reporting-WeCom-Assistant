# 企业微信官方 Node.js SDK 基线

## 仓库

```text
https://github.com/WecomTeam/aibot-node-sdk
```

## 本次读取

- 日期：2026-08-20
- README blob SHA：`a4052980eb61aa7c2c05e81aaecc31873d992a4e`
- package.json blob SHA：`1c7cf315ba87e33ef6d306d414c2bb00db514847`
- package.json 标识版本：`1.0.6`

## README 描述的主要能力

- WebSocket 默认地址和私有部署地址提示；
- Bot ID + Secret 自动认证；
- 心跳；
- 指数退避重连；
- `text / image / mixed / voice / file` 消息分发；
- 流式回复；
- 模板卡片；
- 主动推送；
- 卡片事件；
- 文件下载和 AES-256-CBC 解密；
- 媒体上传；
- CJS/ESM 和 TypeScript 类型。

## 项目使用原则

1. 实际能力以 Gate 0 为准；
2. 锁定测试通过的确切版本；
3. 业务层只依赖 `wecom-adapter`；
4. SDK 升级重新执行能力矩阵；
5. 不假定群内普通消息、图片和 @ 效果；
6. 不在日志输出 Secret、aeskey 或媒体 URL；
7. 初期一个 Bot 一个活动连接。
