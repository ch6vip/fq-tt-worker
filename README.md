# fq-tt-worker

番茄小说 API 边缘代理，支持 Cloudflare Workers 和腾讯 EdgeOne Pages Edge Functions。

将 [fq-tt](https://github.com/ch6vip/fq-tt) 的 PHP 签名链路完整移植到 TypeScript。Cloudflare 部署使用 D1 + cron；EdgeOne 完全部署使用 EdgeOne KV + 受保护的 HTTP 补池端点。

## 特性

- 14 个 API 端点全部可用
- 加密链路与 PHP 原版 byte-for-byte 一致（54 项 oracle 测试验证）
- Cloudflare：设备池原子操作（D1 `UPDATE...RETURNING`），cron 自动注册设备
- EdgeOne：KV 设备池，`admin_refill` 管理端点配合外部定时器补池
- Free 计划友好：内置限流、stats 采样、CPU 优化

## Cloudflare 部署

### 前置条件

- Node.js >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)（`npm install -g wrangler`）
- Cloudflare 账号（Free 计划即可）

### 步骤

```bash
# 1. 克隆并安装依赖
git clone https://github.com/ch6vip/fq-tt-worker.git
cd fq-tt-worker
npm install

# 2. 登录 Cloudflare（首次）
wrangler login

# 3. 创建 D1 数据库
npx wrangler d1 create fq-tt-pool
```

将输出中的 `database_id` 填入 `wrangler.toml`：

```toml
database_id = "你的-database-id"
```

```bash
# 4. 远程建表
npm run db:migrate

# 5. 部署
npm run deploy
```

部署完成后会输出 Worker URL（如 `https://fq-tt-worker.你的用户名.workers.dev`）。

cron 每 10 分钟自动注册设备填充池，首次部署后等待 1-2 个周期即可正常使用。

### 可选配置

```bash
# 设置密码保护 stats_detail 和 device_pool 端点
wrangler secret put AUTH_PASSWORD
```

加密密钥已内置在代码中，无需额外配置。

## EdgeOne 完全部署

EdgeOne Pages Edge Functions 没有 Cloudflare D1 和 `scheduled()`，本项目的 EdgeOne 版本改用：

- `FQTT_KV`：EdgeOne KV 绑定，保存设备池、统计和 meta
- `?api=admin_refill`：受保护的补池端点，替代 Cloudflare cron
- `dist-edgeone/edge-functions/index.js` 与 `dist-edgeone/edge-functions/[[default]].js`：构建后的 EdgeOne Edge Functions 入口

### Git 导入部署

仓库根目录已提供 `edgeone.json`，EdgeOne Pages 导入 Git 仓库时可直接使用：

```json
{
  "installCommand": "npm install",
  "buildCommand": "npm run build:edgeone",
  "outputDirectory": "./dist-edgeone"
}
```

在控制台选择导入 Git 仓库：

1. 仓库：`https://github.com/ch6vip/fq-tt-worker.git`
2. 根目录：仓库根目录
3. 安装命令：`npm install`
4. 构建命令：`npm run build:edgeone`
5. 输出目录：`dist-edgeone`
6. 部署后绑定 KV，变量名：`FQTT_KV`

### 本地构建

```bash
npm install
npm run build:edgeone
```

构建完成后部署 `dist-edgeone` 目录：

```bash
edgeone pages deploy ./dist-edgeone -n 你的项目名
```

### EdgeOne 绑定和变量

在 EdgeOne Pages 项目中绑定 KV 命名空间，变量名必须是：

```text
FQTT_KV
```

建议配置这些环境变量：

```text
AID=1967
LICENSE_ID=1611921764
SDK_VERSION=v04.04.05-ov-android
SDK_VERSION_INT=134744640
PLATFORM=0
GORGON_ALGORITHM=8404
MIN_POOL_SIZE=10
ADMIN_TOKEN=一段强随机密钥
```

`ADMIN_TOKEN` 用于保护补池端点。也可以用 `AUTH_PASSWORD`，但建议 EdgeOne 单独用 `ADMIN_TOKEN`。

### 初始化设备池

部署后先手动调用一次补池：

```bash
curl "https://你的-edgeone-域名/?api=admin_refill&password=你的_ADMIN_TOKEN"
```

之后用腾讯云 SCF 定时触发器、GitHub Actions、VPS cron，或其他定时器每 10 分钟调用同一个 URL。EdgeOne 没有 Cloudflare `scheduled()` 时，这是保持设备池可用的必要步骤。

### EdgeOne 注意事项

- EdgeOne KV 不是 D1，设备选择是“列出 KV 设备后选最久未用”，并发严格性低于 Cloudflare D1 的 `UPDATE...RETURNING`。
- EdgeOne Edge Functions 有代码包大小限制，`npm run build:edgeone` 会检查 5 MiB 限制；当前 bundle 约 0.11 MiB。
- `manga&decode=1` 会为每张图发起子请求并返回 base64，页数多时更容易碰到边缘函数资源限制；默认返回 URL + key 更稳。

## API 文档

所有请求通过查询参数 `?api=<name>` 路由：

```
https://你的worker域名/?api=search&query=斗破苍穹
```

### 端点列表

| API | 功能 | 参数 | 示例 |
|---|---|---|---|
| `search` | 搜索 | `query` | `?api=search&query=hello` |
| `item_info` | 书籍/章节详情 | `item_ids` | `?api=item_info&item_ids=123` |
| `content` | 章节正文 | `item_ids` | `?api=content&item_ids=123` |
| `book` | 书籍目录 | `book_id` | `?api=book&book_id=123` |
| `book_share` | 分享/摘录 | `book_id` | `?api=book_share&book_id=123` |
| `directory` | 小说目录 | `book_id` | `?api=directory&book_id=123` |
| `full` | 多章节批量获取 | `book_id`, `item_ids` | `?api=full&book_id=123&item_ids=1,2,3` |
| `toutiao` | 头条小说 | `item_ids` | `?api=toutiao&item_ids=123` |
| `toutiao_article` | 头条文章 | `item_ids`, `password` | `?api=toutiao_article&item_ids=123&password=xxx` |
| `wkcontent` | 听书时间轴 | `item_ids` | `?api=wkcontent&item_ids=123` |
| `video` | 短剧视频 | `item_ids` | `?api=video&item_ids=123&mode=urls` |
| `manga` | 漫画 | `item_ids` | `?api=manga&item_ids=123&decode=1` |
| `player` | HTML 播放器 | `item_id` | `?api=player&item_id=123` |
| `stats_detail` | 运行状态 | `password` | `?api=stats_detail&password=xxx` |
| `device_pool` | 设备池状态 | `password` | `?api=device_pool&password=xxx` |
| `admin_refill` | 管理补池 | `password` 或 `Authorization: Bearer ...` | `?api=admin_refill&password=xxx` |

### 特殊参数说明

- `video`：默认返回文本内容；加 `&mode=urls` 返回视频播放地址
- `manga`：默认返回图片 URL + 解密 key；加 `&decode=1` 由服务端解密返回图片数据
- `full`：支持 GET 和 POST（POST body 为 JSON `{"book_id":"...","item_ids":["..."]}`）
- `search`：加 `&search_type=fanqie` 走 fanqienovel.com 搜索

### 调试

```
GET /sign?q=aid=1967&device_id=abc
```

返回该查询字符串对应的全部签名头（x-gorgon、x-argus、x-ladon 等）。

## 本地开发

```bash
# 本地 D1 建表
npm run db:migrate:local

# 启动开发服务器
npm run dev
# 访问 http://localhost:8787

# 运行测试
npm test

# 类型检查
npm run typecheck

# 构建 EdgeOne 部署产物
npm run build:edgeone
```

本地开发时 cron 不会自动触发。使用 `--test-scheduled` 标志启动后，访问 `http://localhost:8787/__scheduled` 可手动触发设备注册。

## 项目结构

```
src/
├── index.ts              Worker 入口（路由 + cron）
├── signature.ts          签名头组装
├── stats.ts              调用统计（D1）
├── crypto/               加密模块
│   ├── argus.ts          X-Argus（Simon + AES-128-CBC）
│   ├── simon.ts          Simon128/256 分组密码
│   ├── ladon.ts          X-Ladon（BigInt 运算）
│   ├── xgorgon.ts        X-Gorgon 0404/8404
│   ├── sm3.ts            SM3 国密哈希
│   ├── md5.ts            MD5
│   ├── protobuf.ts       Protobuf wire format
│   ├── cm.ts             2048-bit DH 握手
│   ├── abogus.ts         ABogus（RC4 + SM3）
│   ├── image_decrypt.ts  AES-256-GCM 图片解密
│   └── spade.ts          视频 URL 解密
├── device/               设备管理
│   ├── pool.ts           D1 设备池
│   ├── register.ts       设备注册全流程
│   ├── tt_crypto.ts      ttEncrypt / key 解密
│   └── util.ts           工具函数
└── endpoints/            业务端点
    ├── base.ts           公共 helper
    └── *.ts              各端点实现

migrations/
└── 0001_init.sql         D1 表结构

test/
└── *.test.ts             Oracle 对拍测试（54 项）
```

## Workers Free 计划说明

| 资源 | 每日限额 | 本项目消耗 |
|---|---|---|
| 请求数 | 100,000 | cron 144 + 用户请求 |
| CPU 时间 | 10ms/次调用 | 常规端点 ~5-7ms |
| D1 行读取 | 5,000,000 | ~1-2 次/请求 |
| D1 行写入 | 100,000 | ~1.1 次/请求 |

内置防护措施：
- 请求限流：单 isolate 80K/天后返回 429
- Stats 采样：10% 概率写入，节省 90% D1 写配额
- Cron 频率：每 10 分钟（非每分钟）

个人使用完全够用。如果日请求量超过 5 万，建议升级 Workers Paid（$5/月）。

## License

MIT
