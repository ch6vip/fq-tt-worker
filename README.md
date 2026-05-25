# fq-tt-worker

把 [fq-tt](../fq-tt) PHP 项目的核心签名链路移植到 Cloudflare Worker 上运行，**设备池存 D1**，注册由 cron 后台异步处理。

## 当前状态：✅ 功能完整

- ✅ **加密层**：SM3 / MD5 / Simon128 / Ladon / X-Gorgon (0404+8404) / Argus / ProtoBuf / CM (DH 2048-bit) / ABogus / AES-256-GCM / spade URL
- ✅ **设备池**：D1 schema + `pickDevice` 原子选设备 + `markFailed` + `cleanup`
- ✅ **设备注册**：`registerAndroidDevice` 全套（device_register → premium activate → registerkey → secret decrypt）
- ✅ **14 个业务 endpoint**：全部接入路由
- ✅ **Cron**：每 2 分钟清理失效设备 + 自动 refill（`ctx.waitUntil` 并行注册）
- ✅ **对拍测试**：5 文件 46/46 通过，与 PHP 原版 byte-for-byte

PHP 7849 行 → TS ~5300 行（不含测试），覆盖所有功能性代码。

## 项目结构

```
src/
  index.ts                  Worker entry (fetch + scheduled)
  signature.ts              组装 6 个签名头
  stats.ts                  StatsManager (D1 计数器)
  crypto/
    sm3.ts / md5.ts         哈希
    simon.ts                Simon128/256 分组密码
    ladon.ts                X-Ladon
    xgorgon.ts              X-Gorgon 0404 + 8404
    argus.ts                X-Argus (Simon + AES-128-CBC)
    protobuf.ts             wire format 编解码
    cm.ts                   2048-bit DH 握手 (FullEndpoint)
    abogus.ts               ABogus (RC4 + custom base64 + SM3)
    image_decrypt.ts        AES-256-GCM 漫画图片解密
    spade.ts                视频 URL 解密 (SHA-512 KDF + AES-128-CBC)
  device/
    pool.ts                 D1-backed 设备池
    tt_crypto.ts            ttEncrypt + androidDecryptKey
    util.ts                 uuid / random / androidReverseHex
    register.ts             完整 register 流程
  endpoints/
    base.ts                 helper: signedFetch / withDeviceRetry / decryptResponse
    item_info.ts            书籍/章节详情
    search.ts               搜索（reading + fanqie 双模式）
    directory.ts            目录（reading + novel 双模式）
    book.ts                 fanqienovel web 端（ABogus 签名）
    book_share.ts           分享 + 摘录
    content.ts              章节内容（full + batch）
    full.ts                 多章节 (DH 握手)
    toutiao.ts              头条小说（DH + AES-256）
    toutiao_article.ts      头条文章
    wkcontent.ts            听书时间轴
    manga.ts                漫画（含 AES-256-GCM 图片解密）
    video.ts                短剧视频（默认 reader / mode=urls 拿播放 URL）
    player.ts               HTML 播放器（静态）
migrations/
  0001_init.sql             devices + api_stats 表
test/
  oracle.test.ts            sm3/md5/simon/ladon/xgorgon/argus/protobuf
  tt_crypto.test.ts         设备注册加密
  abogus.test.ts            book 端 ABogus 签名
  image_decrypt.test.ts     manga AES-256-GCM
  spade.test.ts             video URL 解密
```

## 部署步骤

### 1. 安装

```bash
cd E:/aaatest/fq-tt-worker
npm install
```

### 2. 创建 D1 数据库

```bash
npm run db:create
# 把输出的 database_id 粘进 wrangler.toml
npm run db:migrate         # 远端
npm run db:migrate:local   # 本地开发
```

### 3. 设置 secret（可选——默认硬编码值与 PHP 原版相同）

```bash
wrangler secret put ARGUS_SIGN_KEY   # 32-byte hex
wrangler secret put ARGUS_AES_KEY    # 16-byte hex
wrangler secret put ARGUS_AES_IV     # 16-byte hex
wrangler secret put AUTH_PASSWORD    # stats_detail / toutiao_article 密码
```

### 4. 部署

```bash
npm run deploy
```

## API 接口

所有请求通过 `/api/?api=<name>&...` 或 `?api=` 在根 URL 上：

| API | 功能 | 关键参数 |
|---|---|---|
| `item_info` | 章节详情 | `item_ids=...` |
| `search` | 搜索 | `query=...` 或 `search_type=fanqie&q=...` |
| `directory` | 目录 | `book_id=...` (可加 `api_type=novel`) |
| `book` | fanqienovel web 端 | `book_id=...` |
| `book_share` | 分享/摘录 | `book_id=...&mode=share/excerpt/both` |
| `content` | 章节内容 | `item_ids=...` |
| `full` | 多章节 | GET `?book_id=&item_ids=` 或 POST JSON |
| `toutiao` | 头条小说 | `item_ids=...` |
| `toutiao_article` | 头条文章（密码） | `password=...` |
| `wkcontent` | 听书 | `video_id=...` |
| `manga` | 漫画 | `item_ids=...` 默认返回 URL+key；`&decode=1` 服务端解密 |
| `video` | 视频 | `item_ids=...` 默认返回文本；`&mode=urls` 拿播放 URL |
| `player` | HTML 播放器 | `item_id=...` |
| `stats_detail` | 健康检查 | `password=...` |
| `device_pool` | 设备池查看 | — |

调试：`GET /sign?q=aid=1967&device_id=abc` 返回该 query 的签名头。

## 本地验证

```bash
npm test            # 46/46 oracle 测试
npm run typecheck   # tsc --noEmit
npm run dev         # wrangler dev，访问 http://localhost:8787
```

如果设备池空（registerAndroidDevice 还没跑），手动种入一台设备：

```bash
wrangler d1 execute fq-tt-pool --command \
  "INSERT INTO devices (device_id, install_id, secret_key, created_at) \
   VALUES ('test-dev-1','test-iid-1','aabbccdd...32-hex',unixepoch()*1000);"
```

或者等 cron（每 2 分钟）自动注册。

## 与 PHP 版本的差异

| 行为 | PHP (fq-tt) | TS (fq-tt-worker) |
|---|---|---|
| 设备池存储 | `device_pool.json` + `rename(tmp)` 伪原子 | D1 表 + SQLite 写锁，**真原子** |
| 选设备 | 读全池 → usort → 写回 | `UPDATE...RETURNING` 一条 SQL |
| Refill 触发 | 同步在 `getDevice()` 里调 register | cron 后台并行 |
| GMP 大整数 | PHP gmp 扩展 | 原生 BigInt |
| AES-128-CBC | openssl + ZERO_PADDING | Web Crypto + trim trick |
| AES-256-GCM | openssl 单独传 tag | Web Crypto 拼接（subarray 自然对齐） |
| MD5 | PHP 内置 | 自实现（Node 测试也能跑） |
| Manga 图片 | 服务端下载 + 解密 + 落盘 hosted | 默认返回 URL+key 让客户端处理；`?decode=1` 服务端解 |

加密层与 PHP **byte-for-byte 一致**（5 个 oracle 测试文件，46 项全过）。

## 待办（部署前 polish）

1. `pickDevice()` 改 `ctx.waitUntil` 异步写 use_count/last_used（避免高并发撞 D1 ~25 ops/s 写吞吐限速）
2. 真实环境对拍 `registerAndroidDevice` 整条流程（wrangler dev 跑一次）
3. 端到端 smoke 测试每个 endpoint，确认上游接受 TS 生成的签名头
4. 出口 IP 风控验证：已确认通过（CF 出口不会被风控）

详见 `PROGRESS.md`。
