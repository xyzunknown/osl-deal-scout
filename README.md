# OSL 项目情报平台

一个轻量的项目发现与打分平台，用来为香港合规交易所 BD / 上币团队筛选更值得跟进的项目。

## 功能
- 从多组 Google News RSS 查询抓取新线索
- 低频接入 CoinGecko、DeFiLlama、项目官网/Blog、RootData 缓存补数
- 自动抽取项目名称、赛道、地区、合规/机构/融资信号
- 对候选项目打分，生成可读理由
- 提供本地面板查看 Top leads
- 支持手动生成日报
- 支持 Telegram Bot 推送，或输出给 Openclaw 自动化转发

## 启动
```bash
cd /Users/xyz/Documents/X\ zhuaqu
npm start
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)

## 手动生成日报
```bash
cd /Users/xyz/Documents/X\ zhuaqu
npm run digest
```

默认只输出摘要文本，不发送消息。

如果已经在 `data/config.json` 填好 Telegram Bot：

```bash
node run-digest.js --push
```

## 主要文件
- `data/config.json`: 推送与打分配置
- `data/api-cache.json`: 外部数据源缓存
- `data/sources.json`: 数据源查询
- `data/projects.json`: 最近一次聚合后的候选项目
- `data/run-history.json`: 运行历史
- `data/telegram-message.txt`: 最近一次生成的日报文本

## 说明
- 这个版本的重点是“发现 + 排序 + 摘要”，不是自动群发开发信。
- 免费 API key 有额度限制，当前实现按缓存优先设计，避免高频重复请求。
- `CryptoRank` key 已保存到配置里，但目前没有自动调用，避免在没确定具体查询口径前消耗免费额度。

## 以 `/osl` 子路径部署到 Vercel

这个项目现在已经支持挂在子路径下运行，比如：

- 本地根路径：`http://127.0.0.1:3000`
- 线上子路径：`https://eyang.space/osl`

### 本地模拟 `/osl`

```bash
cd /Users/xyz/Documents/X\ zhuaqu
APP_BASE_PATH=/osl npm start
```

然后访问：

- `http://127.0.0.1:3000/osl`

### Vercel 配置

仓库里已经带了 [vercel.json](/Users/xyz/Documents/X%20zhuaqu/vercel.json)，会把 `/osl` 和 `/osl/*` rewrite 到 [api/index.js](/Users/xyz/Documents/X%20zhuaqu/api/index.js) 这个 Vercel Serverless 入口。

你还需要在 Vercel 项目里加一个环境变量：

- `APP_BASE_PATH=/osl`

### 域名接入步骤

1. 在 Vercel 新建这个项目并导入仓库
2. 在 Project Settings -> Environment Variables 里添加：
   - `APP_BASE_PATH=/osl`
3. 在 Project Settings -> Domains 里添加：
   - `eyang.space`
4. 按 Vercel 提示去你的域名 DNS 面板加记录
5. 等证书生效后，访问：
   - `https://eyang.space/osl`

### 重要限制

当前版本会把数据写到本地这些文件：

- `data/projects.json`
- `data/run-history.json`
- `data/crm-records.json`

在 Vercel Serverless 环境里，这类写入**不会长期持久化**。也就是说：

- 页面能打开
- API 能临时执行
- 但刷新、CRM 保存、运行记录、日报状态这些写回磁盘的数据，不适合直接依赖 Vercel 本地文件系统

如果你要长期稳定在线跑，下一步应该把这些数据迁到外部存储，比如：

- Vercel KV
- Supabase
- Neon / Postgres
- Upstash Redis
