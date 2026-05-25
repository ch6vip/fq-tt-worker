# fq-tt-worker

Cloudflare Worker 版番茄小说 API 代理。将 [fq-tt](https://github.com/ch6vip/fq-tt) PHP 项目的签名链路移植到 TypeScript，设备池存 D1，注册由 cron 后台处理。

**开箱即用** — clone → `npm install` → 创建 D1 → deploy，无需额外配置。

## 快速部署

```bash
git clone https://github.com/ch6vip/fq-tt-worker.git
cd fq-tt-worker
npm install

# 创建 D1 数据库
npx wrangler d1 create fq-tt-pool
# 把输出的 database_id 粘贴到 wrangler.toml 的 database_id 字段

# 建表
npm run db:migrate

# 部署
npm run deploy
```

部署后 cron 每 10 分钟自动注册设备填充池，约 1-2 个周期后即可正常使用。

### 可选：设置密码保护

```bash
wrangler secret put AUTH_PASSWORD
# 输入你想要的密码，用于保护 stats_detail 和 device_pool 端点
```

加密密钥已内置在代码中（与 PHP 原版相同），无需额外配置。

## API 接口

所有请求通过 `?api=<name>` 访问：

| API | 功能 | 关键参数 |
|---|---|---|
| `search` | 搜索 | `query=关键词` |
| `item_info` | 章节详情 | `item_ids=ID` |
| `content` | 章节内容 | `item_ids=ID` |
| `book` | 书籍目录 (fanqie web) | `book_id=ID` |
| `book_share` | 分享/摘录 | `book_id=ID` |
| `directory` | 小说目录 | `book_id=ID` |
| `full` | 多章节批量 | `book_id=ID&item_ids=ID1,ID2,...` |
| `toutiao` | 头条小说 | `item_ids=ID` |
| `toutiao_article` | 头条文章 | `item_ids=ID&password=...` |
| `wkcontent` | 听书时间轴 | `item_ids=ID` |
| `video` | 短剧视频 | `item_ids=ID` (加 `&mode=urls` 拿播放地址) |
| `manga` | 漫画 | `item_ids=ID` (加 `&decode=1` 服务端解密) |
| `player` | HTML 播放器 | `item_id=ID` |
| `stats_detail` | 健康检查 | `password=...` |
| `device_pool` | 设备池 | `password=...` |

调试签名：`GET /sign?q=aid=1967&device_id=abc`

## Free 计划限制

部署在 Workers Free 计划上的注意事项：

| 资源 | 限额 | 本项目消耗 |
|---|---|---|
| 请求 | 100K/天 | cron 144 + 用户请求 |
| CPU | 10ms/次 | 常规 ~5-7ms，`full` 端点 ~8-12ms |
| D1 写 | 100K/天 | ~1.1 次/请求（采样 stats） |

已内置防护：80K/isolate 限流、stats 10% 采样、cron 每 10 分钟。

## 本地开发

```bash
npm run dev              # wrangler dev (http://localhost:8787)
npm test                 # 54 个 oracle 测试
npm run typecheck        # tsc --noEmit
npm run db:migrate:local # 本地 D1 建表
```
