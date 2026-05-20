# 📋 Inferable 项目分析

## 一、项目简介

Inferable 是一个托管式持久化执行运行时（Durable Execution Runtime），用于构建带有 Human-in-the-Loop（人类参与） 的可靠 AI 工作流。核心特性：

- 🔐 工作流在你自己的基础设施上运行（通过长轮询连接，无需开放入站端口）
- 🔄 版本化工作流（向后兼容，渐进式发布）
- 🧑‍💼 人类审批集成（Slack / Email）
- 🏗️ 结构化输出（自动解析、验证、重试）
- 📦 多语言 SDK（Node.js, Go, .NET, React, Bash）
  ────────────────────────────────────────────────────────────────────────────────

## 二、项目目录结构和流程

```
inferable/  (Monorepo - MIT License)
│
├── 🎯 核心服务 (Core Services)
│   ├── control-plane/        ← 控制平面（核心后端服务，Node.js + PostgreSQL + Redis）
│   │   ├── src/              ← API、调度、LLM 路由、工作流编排
│   │   ├── drizzle.config.ts ← 数据库迁移配置
│   │   └── docker-compose.dev.yml  ← 本地开发依赖（Postgres + Redis）
│   │
│   ├── app/                  ← 管理控制台（Next.js 前端）
│   │   ├── app/clusters/     ← 集群管理 UI
│   │   │   └── [clusterId]/
│   │   │       ├── runs/         ← 运行历史
│   │   │       ├── workflows/    ← 工作流执行
│   │   │       ├── integrations/ ← Slack / Langfuse 集成
│   │   │       └── settings/     ← API 密钥管理
│   │   └── components/       ← React 组件库（chat, ui 等）
│   │
│   └── cli/                  ← 命令行工具 (@inferable/cli, alpha)
│
├── 📚 SDK 客户端 (在用户基础设施中运行)
│   ├── sdk-node/             ← Node.js / TypeScript SDK (主推)
│   ├── sdk-go/               ← Go SDK
│   ├── sdk-dotnet/           ← .NET SDK (实验性)
│   ├── sdk-react/            ← React Hooks SDK
│   └── sdk-bash/             ← Bash 脚本 SDK
│
├── 🚀 Bootstrap 模板 (示例项目脚手架)
│   ├── bootstrap-node/
│   ├── bootstrap-go/
│   └── bootstrap-dotnet/
│
├── 🎬 demos/                 ← 示例（如 quote-system 报价系统）
├── 🧪 load-tests/            ← 负载测试
└── 📦 archives/              ← 归档代码
```

────────────────────────────────────────────────────────────────────────────────

## 三、整体运作流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    用户的应用 /触发源                            │
│              (HTTP API / SDK trigger / CLI)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ① 触发工作流
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│            🎯 Control Plane (api.inferable.ai 或自托管)         │
│    ┌──────────────────────────────────────────────────────┐     │
│    │ • 工作流编排 / 调度                                   │     │
│    │ • LLM 路由 (Anthropic / Cohere / Bedrock)            │     │
│    │ • 持久化状态 (Postgres + pgvector)                    │     │
│    │ • 缓存 (Redis)                                       │     │
│    │ • 人工审批触发 (Slack / Email)                        │     │
│    └──────────────────────────────────────────────────────┘     │
└──────────────────▲───────────────────────────┬──────────────────┘
                   │ ③ 长轮询拉任务            │ ② 任务入队
                   │   （无需开放入站端口）    │
                   │                           │
┌──────────────────┴──────────────┐  ┌─────────▼─────────────┐
│  🖥️  你的基础设施               │  │  🌐 管理控制台        │
│  (SDK 嵌入的 worker)            │  │  app.inferable.ai     │
│                                 │  │                       │
│  • workflow.listen()            │  │  • 时间线观察         │
│  • 执行 workflow handler        │  │  • Run 详情           │
│  • 调用 ctx.llm.structured()    │  │  • API Key 管理       │
│  • 调用注册的 tools              │  │  • 集成配置           │
│  • 触发 Interrupt.approval()    │  │                       │
└─────────────────────────────────┘  └───────────────────────┘
```

关键概念：

- Cluster（集群）：tools、agents、workflows 的逻辑分组
- Workflow（工作流）：定义执行步骤序列，支持版本化
- Tool（工具）：可被 LLM/Agent 调用的函数
- Agent：基于 LLM 的自主推理引擎
- Interrupt：暂停工作流以等待人类审批
  ────────────────────────────────────────────────────────────────────────────────

## 四、如何使用（Quick Start）

🅰️ 方式一：使用 Inferable Cloud（最简单）
1️⃣ 创建临时集群
// bash

```
mkdir inferable-demo && cd inferable-demo
curl -XPOST https://api.inferable.ai/ephemeral-setup > cluster.json
```

2️⃣ 安装 SDK
// bash

```
npm init -y
npm install inferable tsx zod
```

3️⃣ 编写工作流（ simple-workflow.ts ）
// typescript

```
import { Inferable } from "inferable";
import { z } from "zod";

const inferable = new Inferable({
  apiSecret: require("./cluster.json").apiKey,
});

const workflow = inferable.workflows.create({
  name: "simple",
  inputSchema: z.object({
    executionId: z.string(),
    url: z.string(),
  }),
});

workflow.version(1).define(async (ctx, input) => {
  const text = await fetch(input.url).then(r => r.text());

  // ✨ 结构化输出（自动验证 + 重试）
  const { menuItems, hours } = ctx.llm.structured({
    input: text,
    schema: z.object({
      menuItems: z.array(z.object({
        name: z.string(),
        price: z.number(),
      })),
      hours: z.object({
        saturday: z.string(),
        sunday: z.string(),
      }),
    }),
  });

  return { menuItems, hours };
});

// 启动 worker 监听任务
workflow.listen().then(() => console.log("Workflow listening"));
```

4️⃣ 启动 worker
// bash

```
npx tsx simple-workflow.ts
```

5️⃣ 触发工作流
// bash

```
CLUSTER_ID=$(cat cluster.json | jq -r .id)
API_SECRET=$(cat cluster.json | jq -r .apiKey)

curl -XPOST https://api.inferable.ai/clusters/$CLUSTER_ID/workflows/simple/executions \
  -d '{"executionId": "123", "url": "https://a.inferable.ai/menu.txt"}' \
  -H "Authorization: Bearer $API_SECRET"
或在代码中触发：
// typescript
await inferable.workflows.trigger("simple", {
  executionId: "123",
  url: "https://a.inferable.ai/menu.txt",
});
```

────────────────────────────────────────────────────────────────────────────────
🅱️ 方式二：使用 CLI
// bash

```
npm install -g @inferable/cli

inf auth login              # 登录
inf clusters create         # 创建集群
inf clusters list           # 列出集群
inf runs create             # 创建 run 并跟踪进度
inf auth keys create        # 创建 API Key
inf generate openapi <...>  # 从 OpenAPI 自动生成 functions
```

────────────────────────────────────────────────────────────────────────────────
🅲 方式三：自托管（Self-Hosting）
进入 control-plane/ 目录：
// bash

```
cd control-plane
```

# 1. 启动依赖（Postgres + Redis）

```
docker compose -f docker-compose.dev.yml up
```

# 2. 配置环境变量

```
cp .env.base .env
# 编辑 .env，填入：
#   - ANTHROPIC_API_KEY 和 COHERE_API_KEY，或
#   - BEDROCK_AVAILABLE=true（需 AWS Bedrock 权限）
#   - JWKS_URL 或 MANAGEMENT_API_SECRET
```

# 3. 数据库迁移

```
npm run migrate
```

# 4. 启动控制平面

```
npm run dev
# API 监听在 http://localhost:7000
```

# 5. （可选）通过 CLI 连接

```
export INFERABLE_API_ENDPOINT=http://localhost:7000
inf auth login
inf clusters create
启动管理控制台 ( app/ )：
// bash
cd app
npm install
npm run dev   # 默认在 http://localhost:3000
```

────────────────────────────────────────────────────────────────────────────────

## 五、高级特性示例

### 🧑‍💼 人类审批（Human-in-the-Loop）

// typescript

```
deleteUserWorkflow.version(1).define(async (ctx, input) => {
  if (!ctx.approved) {
    return Interrupt.approval({
      message: `需要批准删除用户 ${input.userId}`,
      destination: { type: "email", email: "admin@example.com" },
    });
  }
  await db.customers.delete({ userId: input.userId });
});
```

### 🔄 版本化（多版本并存）

// typescript

```
workflow.version(1).define(async (ctx, input) => { /* 旧逻辑 */ });
workflow.version(2).define(async (ctx, input) => { /* 新逻辑 */ });
```

// Inferable 维护版本亲和性，正在执行的 run 继续使用 v1

### 💾 Memoization（缓存昂贵操作）

// typescript

```
const result = await ctx.memo("cache-key", async () => {
  return await expensiveOperation();
});
```

### 🤖 Agent + Tools

// typescript

```
workflow.tools.register({
  name: "searchDatabase",
  inputSchema: z.object({ query: z.string() }),
  func: async (input) => { /* ... */ },
});

const result = ctx.agents.react({
  name: "search",
  tools: ["searchDatabase"],
  input: "查找机器学习相关信息",
  schema: z.object({ result: z.string() }),
});
```

────────────────────────────────────────────────────────────────────────────────

## 六、推荐学习路径

```
┌──────┬────────────────────────────┬───────────────────┐
│ 顺序 │ 资源                       │ 说明              │
├──────┼────────────────────────────┼───────────────────┤
│ 1    │ README.md（根）            │ 总览              │
│ 2    │ sdk-node/README.md         │ Node SDK 快速上手 │
│ 3    │ bootstrap-node/            │ 可运行的脚手架    │
│ 4    │ demos/quote-system/        │ 真实用例          │
│ 5    │ control-plane/README.md    │ 自托管            │
│ 6    │ https://docs.inferable.ai/ │ 官方完整文档      │
└──────┴────────────────────────────┴───────────────────┘
```

────────────────────────────────────────────────────────────────────────────────

## 总结

- 核心架构： control-plane (调度大脑) + app (UI) + sdk-\* (运行在你的基础设施上的 worker)
- 使用方式：① Cloud 注册即用 → ② CLI 管理 → ③ 自托管完全控制
- 典型流程：定义 workflow → workflow.listen() 启动 worker → API/SDK 触发 → 控制台观察时间线
- 杀手锏：版本化、Human-in-the-Loop、结构化 LLM 输出、Memoization
