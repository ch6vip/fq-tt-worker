# fq-tt-worker

番茄小说 API 的 Cloudflare Workers 边缘代理实现，将 `fq-tt` 的 PHP 签名链路移植到 TypeScript，并使用 Cloudflare D1 保存设备池和运行统计。

当前主部署目标是 Cloudflare Workers。EdgeOne 相关代码仍保留，但仅作为实验性适配。

## 功能特性

- 支持小说、短剧、漫画、搜索、目录、正文、播放器等业务端点。
- TypeScript 实现 X-Gorgon、X-Argus、X-Ladon、ABogus、CM DH、spade、图片解密等签名和解密逻辑。
- Cloudflare D1 设备池，定时任务每 10 分钟自动补池。
- 前端监控面板公开访问，面板 HTML 缓存 6 小时，页面内倒计时只在浏览器本地更新。
- 管理端点可通过 `AUTH_PASSWORD` 或 `ADMIN_TOKEN` 保护。
- 适配 Workers Free 计划：统计采样、面板缓存、定时补池频率保守。

## Cloudflare 部署

### 1. 准备环境

需要：

- Node.js 18 或更高版本
- Cloudflare 账号
- Wrangler CLI。本项目已在 `devDependencies` 中包含 Wrangler，推荐用 `npx wrangler ...` 或 `npm run ...` 执行。

安装依赖：

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

### 2. 创建 D1 数据库

```bash
npm run db:create
```

命令会输出 `database_id`。把它填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "fq-tt-pool"
database_id = "你的 database_id"
migrations_dir = "migrations"
```

创建线上表结构：

```bash
npm run db:migrate
```

### 3. 配置密码保护

强烈建议设置 `AUTH_PASSWORD`：

```bash
npx wrangler secret put AUTH_PASSWORD
```

也可以设置 `ADMIN_TOKEN`。如果两者都设置，任意一个匹配即可通过鉴权。

鉴权支持两种方式：

```bash
curl "https://你的域名/?api=stats_detail&password=你的密码"
curl -H "Authorization: Bearer 你的密码" "https://你的域名/?api=device_pool"
```

### 4. 部署

```bash
npm run deploy
```

部署完成后 Wrangler 会输出 Workers 地址，例如：

```text
https://fq-tt-worker.你的账号.workers.dev
```

首次部署后，等待 1-2 个 cron 周期让设备池自动补充。也可以手动触发一次补池：

```bash
curl "https://你的域名/?api=admin_refill&limit=1&password=你的密码"
```

## 访问控制

| 类型 | 端点 | 访问方式 |
|---|---|---|
| 前端面板 | `/`、`?api=dashboard` | 公开访问 |
| 强制刷新面板缓存 | `/?refresh=1` | 需要密码 |
| 业务 API | `search`、`content`、`book`、`video`、`manga` 等 | 公开访问 |
| 状态 API | `stats_detail`、`device_pool` | 设置 `AUTH_PASSWORD` 或 `ADMIN_TOKEN` 后需要密码 |
| 管理 API | `admin_refill`、`admin_insert_device` | 始终需要密码 |
| EdgeOne 诊断 | `kv_probe` | 需要密码，仅 EdgeOne KV 环境有意义 |

面板缓存 6 小时。普通打开面板仍会产生一次 Worker 请求，但缓存命中时不会每次读取 D1。面板底部的刷新倒计时由浏览器本地 JavaScript 更新，不会自动请求 Cloudflare。

需要立即刷新面板缓存时：

```bash
curl "https://你的域名/?refresh=1&password=你的密码"
```

## API 使用

所有 API 通过 `?api=<name>` 路由：

```text
https://你的域名/?api=content&item_ids=7360705605574607385
```

## 阅读书源和段评

书源和段评是两套独立配置：

- 书源导入地址：`https://fq-tt-worker.ch6vip.workers.dev/bookSource-fq-tt-worker.json`
- 段落处理规则 JSON：`https://fq-tt-worker.ch6vip.workers.dev/paragraphRule-fq-tt-worker.json`
- 段落处理规则 JS：`https://fq-tt-worker.ch6vip.workers.dev/paragraphRule-fq-tt-worker.js`

Luoyacheng/legado 版本的段评需要使用“段落处理规则”。这个规则不会随书源自动启用，需要在阅读页进入“段落规则管理”，为当前书启用 `fq-tt-worker` 段落规则。

规则入口是 `process(ctx)`。本项目的段落规则会读取当前章节上下文里的 `book_id`、`item_id`，在正文段落后插入段评入口，点击后通过 Worker 的 `comment_page` 打开段评页面。

### 业务端点

| API | 功能 | 常用参数 | 示例 |
|---|---|---|---|
| `dashboard` | 监控面板 | 无 | `/` 或 `?api=dashboard` |
| `search` | 搜索 | `query`、`search_type` | `?api=search&query=斗破苍穹` |
| `item_info` | 书籍/章节详情 | `item_ids` | `?api=item_info&item_ids=123` |
| `content` | 章节正文 | `item_ids` | `?api=content&item_ids=123` |
| `book` | 书籍目录 | `book_id` | `?api=book&book_id=123` |
| `book_share` | 分享/摘录 | `book_id` | `?api=book_share&book_id=123` |
| `comment_list` | 段评列表 | `item_id`、`book_id`、`para_index` | `?api=comment_list&item_id=123&book_id=456&para_index=0` |
| `directory` | 小说目录 | `book_id` | `?api=directory&book_id=123` |
| `full` | 多章节批量获取 | `book_id`、`item_ids` | `?api=full&book_id=123&item_ids=1,2,3` |
| `toutiao` | 头条小说正文 | `item_ids` | `?api=toutiao&item_ids=123` |
| `toutiao_article` | 时间戳调试端点 | 无 | `?api=toutiao_article` |
| `wkcontent` | 听书时间轴 | `item_ids` | `?api=wkcontent&item_ids=123` |
| `video` | 短剧视频 | `item_ids`、`mode` | `?api=video&item_ids=123&mode=urls` |
| `manga` | 漫画 | `item_ids`、`decode` | `?api=manga&item_ids=123` |
| `player` | HTML 播放器 | `item_id` | `?api=player&item_id=123` |

### 管理和状态端点

| API | 功能 | 是否需要密码 | 示例 |
|---|---|---|---|
| `stats_detail` | 运行统计、调用计数、设备数 | 设置密码后需要 | `?api=stats_detail&password=xxx` |
| `device_pool` | 设备池分组状态 | 设置密码后需要 | `?api=device_pool&password=xxx` |
| `admin_refill` | 手动补充设备池 | 需要 | `?api=admin_refill&limit=1&password=xxx` |
| `admin_insert_device` | 手动写入设备 | 需要 | `?api=admin_insert_device&device_id=...&install_id=...&secret_key=...&password=xxx` |
| `sign` | 签名调试 | 公开 | `?api=sign&q=aid=1967` |
| `kv_probe` | EdgeOne KV 诊断 | 需要 | `?api=kv_probe&password=xxx` |

`admin_insert_device` 的 `secret_key` 必须是 32 位十六进制字符串。

## 常用命令

```bash
# 本地开发
npm run dev

# 本地 D1 建表
npm run db:migrate:local

# 线上 D1 建表/迁移
npm run db:migrate

# 类型检查
npm run typecheck

# 运行测试
npm test

# 部署 Cloudflare Worker
npm run deploy

# 构建 EdgeOne 产物
npm run build:edgeone
```

本地开发默认地址通常是：

```text
http://localhost:8787
```

本地不会自动触发 Cloudflare cron。如需测试 scheduled 事件，可用 Wrangler 的 scheduled 测试能力启动后访问 `__scheduled`。

## Cloudflare 资源消耗说明

前端面板本身是公开的，但不会每秒请求后端。当前实现：

- 面板 HTML 通过 Workers Cache API 缓存 6 小时。
- 缓存命中时不读取 D1。
- 倒计时只在浏览器本地更新，不消耗 Cloudflare 请求。
- 每次打开面板仍然算一次 Worker 请求，这是 Cloudflare 入口请求，无法完全变成零消耗。

业务 API 请求会消耗 Worker 请求、CPU、上游 fetch、D1 设备池读取和少量统计写入。统计写入做了采样，避免每次请求都写 D1。

## EdgeOne 状态

项目保留 EdgeOne Pages Edge Functions 构建：

```bash
npm run build:edgeone
```

产物目录是 `dist-edgeone`，配置文件是 `edgeone.json`。

已知情况：

- EdgeOne KV 绑定变量名需要是 `FQTT_KV`。
- EdgeOne 没有 Cloudflare D1 和 Workers `scheduled()`，设备池和定时补池语义不同。
- 实测 EdgeOne 边缘出口调用设备注册接口时，上游可能返回 `device_id=0/install_id=0`。同一套代码在本机网络可正常注册。
- 因此当前推荐生产部署仍使用 Cloudflare Workers。

## 项目结构

```text
src/
├── index.ts              Cloudflare Worker 入口
├── app.ts                路由、鉴权、面板缓存、管理端点
├── signature.ts          签名头组装
├── stats.ts              D1 统计
├── device/               设备注册和设备池
├── endpoints/            各业务端点
├── crypto/               签名和解密算法
├── edgeone.ts            EdgeOne 入口
└── edgeone_kv.ts         EdgeOne KV 适配

migrations/
└── 0001_init.sql         D1 表结构

test/
└── *.test.ts             加密和协议对拍测试
```

## License

MIT
