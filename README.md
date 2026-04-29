# code-in-wechat

一个 WeChat 机器人，负责在 WeChat 与 AI 编码工具（OpenCode）之间转发消息。你可以在手机上通过微信直接和 AI 助手对话，让它帮你写代码、调试问题或处理文件。

## 技术栈

- **Bun** — 运行时（要求 >= 1.0.0）
- **TypeScript** — 全项目使用 TypeScript 5.5，ES2022 模块
- **Vitest** — 单元测试框架
- **Hono** — Web 管理页框架
- **Zod** — 配置校验与环境变量解析
- **@opencode-ai/sdk** — OpenCode 集成，支持 SSE 流式响应
- **Node.js crypto** — AES 加解密（图片/文件 CDN 传输）

## 架构

```
WeChat 客户端
    |
    |  iLink HTTP API (微信 ClawBot)
    v
iLinkClient
    |
    |  消息解析 / 斜杠命令 / 媒体处理
    v
MessageBridge  ── SessionManager
    |                  |
    |  SSE 流式调用     |  context_token 缓存（~24h TTL）
    v                  |  cursor 持久化
OpenCodeAdapter      v
    |              get_updates_buf 持久化
    |  SSE streaming
    v
OpenCode Server (本地 127.0.0.1:4096)
```

数据流：WeChat 用户发送的消息经过 iLink API 到达 `iLinkClient`，`MessageBridge` 负责调度 `SessionManager`、`MediaHandler`、`StreamHandler`，最终通过 `OpenCodeAdapter` 以 SSE 流式调用 OpenCode，再把 AI 的回复分段发回微信。

## 快速开始

```bash
# 1. 克隆仓库
git clone <repo-url>
cd code-in-wechat

# 2. 安装依赖（使用 Bun）
bun install

# 3. 复制环境变量模板
cp .env.example .env

# 4. 编辑 .env，至少填写 SESSION_DB_PATH
# SESSION_DB_PATH=./session-db.json

# 5. 启动机器人（开发模式）
npx tsx src/index.ts

# 或启动守护进程（自动重连）
npx tsx src/index.ts --daemon

# 6. 首次运行需要扫码登录
# 终端会输出二维码链接，用微信扫码即可
```

启动后，Web 管理页默认在 http://localhost:3000 可用。

## 配置

复制 `.env.example` 为 `.env`，根据需求调整以下变量：

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `ILINK_BASE_URL` | 否 | `https://ilinkai.weixin.qq.com` | iLink API 基础地址 |
| `OPENCODE_PORT` | 否 | `4096` | OpenCode 服务端口 |
| `OPENCODE_HOSTNAME` | 否 | `127.0.0.1` | OpenCode 服务主机 |
| `OPENCODE_MODEL` | 否 | （空） | 指定模型，格式 `provider/model` |
| `SERVER_PORT` | 否 | `3000` | Web 管理页端口 |
| `SERVER_HOST` | 否 | `localhost` | Web 管理页主机 |
| `LOG_LEVEL` | 否 | `info` | 日志级别：`debug` / `info` / `warn` / `error` |
| `BOT_TOKEN_PATH` | 否 | `./bot-token.json` | Bot token 存储路径 |
| `SESSION_DB_PATH` | **是** | — | Session 数据库文件路径 |

所有配置项均通过 Zod schema 校验，启动时会自动检查格式与必填项。

## CLI 用法

```bash
npx tsx src/index.ts [options]          # 启动机器人（默认）
npx tsx src/index.ts auth [options]     # 仅运行认证流程
```

### Options

| 选项 | 说明 |
|------|------|
| `--port <number>` | Web 服务端口（覆盖 `SERVER_PORT`） |
| `--host <string>` | Web 服务主机（覆盖 `SERVER_HOST`） |
| `--opencode-port <number>` | OpenCode 服务端口（覆盖 `OPENCODE_PORT`） |
| `--log-level <string>` | 日志级别：`debug` / `info` / `warn` / `error` |
| `--daemon` | 以守护进程模式运行，支持自动重连 |
| `--help`, `-h` | 显示帮助信息 |
| `--version`, `-v` | 显示版本号 |

### 示例

```bash
# 指定端口启动
npx tsx src/index.ts --port 8080 --log-level debug

# 守护进程模式
npx tsx src/index.ts --daemon

# 仅执行认证
npx tsx src/index.ts auth
```

生产环境构建后使用：

```bash
bun run build
node dist/index.js --daemon
```

## 斜杠命令

在微信中发送以 `/` 开头的消息即可触发命令：

| 命令 | 说明 |
|------|------|
| `/new [标题]` | 开启新对话，可选传入标题 |
| `/reset` | 重置当前 session |
| `/switch` | 切换工具（即将支持） |
| `/help` | 显示可用命令列表 |

## 守护进程

使用 `--daemon` 标志启动时，机器人会以守护进程模式运行，具备以下能力：

- **自动重连**：session 过期（ret=-14）时自动重新认证，指数退避重试
- **健康检查**：iLink 连接每 30s 检测一次，OpenCode 每 60s 检测一次
- **信号处理**：`SIGINT` / `SIGTERM` 优雅关闭，`SIGUSR2` 重启 bridge
- **重试上限**：默认最多连续重试 5 次，超过则 fatal exit
- **退避策略**：基础延迟 2000ms，上限 300000ms（5 分钟）

## Web 管理页

基于 Hono 的轻量管理页面，默认监听 `SERVER_HOST:SERVER_PORT`：

| 路由 | 说明 |
|------|------|
| `/` | 状态总览页（Bot 状态、运行时长、session 列表、登录二维码） |
| `/api/status` | JSON 格式的 Bot 状态 |
| `/api/sessions` | JSON 格式的活跃 session 列表 |
| `/health` | 健康检查端点 |

状态页每 10 秒自动刷新，采用暗色主题，无需额外前端构建。

## 开发

```bash
# 开发模式（带 watch）
bun run dev

# 类型检查
bun run lint

# 构建
bun run build

# 生产启动
bun run start
```

启动流程（`src/index.ts`）：

1. 解析 CLI 参数
2. 加载配置（环境变量 + CLI 覆盖 + 默认值）
3. 设置日志级别
4. 创建 `iLinkClient`
5. 创建 `OpenCodeAdapter`
6. 创建 `StreamHandler`
7. 创建 `MediaHandler`
8. 创建 `AuthFlow`
9. 创建 `MessageBridge`
10. 启动守护进程或前台 bridge
11. 启动 Web 服务



## 项目结构

```
src/
├── index.ts              # 入口：启动流程编排
├── cli.ts                # CLI 参数解析器
├── daemon.ts             # 守护进程（自动重连、健康检查）
├── log.ts                # 结构化日志与敏感信息脱敏
├── config/
│   ├── index.ts          # dotenv 加载与 loadConfig()
│   └── env.ts            # Zod schema 定义
├── bridge/
│   ├── message-bridge.ts # 核心消息调度桥
│   ├── session-manager.ts# Session 生命周期与 context_token 缓存
│   ├── auth-flow.ts      # 二维码登录与 token 管理
│   ├── stream-handler.ts # SSE 流处理与消息分块发送
│   ├── media-handler.ts  # 媒体下载、AES 解密、格式转换
│   └── slash-commands.ts # 斜杠命令解析与执行
├── wechat/
│   ├── ilink-client.ts   # iLink HTTP API 客户端
│   ├── types.ts          # iLink 消息类型定义
│   └── index.ts          # 模块导出
├── tools/
│   ├── opencode.ts       # OpenCode SDK 适配器
│   └── adapter.ts        # ToolAdapter 接口定义
├── types/
│   ├── wechat.ts         # WeChat 相关类型
│   ├── bridge.ts         # Bridge 事件类型
│   ├── tool.ts           # Tool 适配类型
│   ├── config.ts         # 配置类型
│   └── index.ts          # 类型 barrel export
└── web/
    └── server.ts         # Hono Web 服务与状态页

tests/
├── cli.test.ts
├── daemon.test.ts
├── bridge/
│   ├── message-bridge.test.ts
│   ├── auth-flow.test.ts
│   ├── session-manager.test.ts
│   ├── media-handler.test.ts
│   ├── stream-handler.test.ts
│   └── slash-commands.test.ts
├── wechat/
│   └── ilink-client.test.ts
├── tools/
│   ├── opencode.test.ts
│   └── adapter.test.ts
├── config/
│   └── config.test.ts
├── types/
│   └── types.test.ts
├── web/
│   └── server.test.ts
└── setup.test.ts
```

## 许可证

MIT
