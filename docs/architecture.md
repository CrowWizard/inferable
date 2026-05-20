# Inferable 架构与数据流

本文档使用 [Mermaid](https://mermaid.js.org/) 图详细描述 Inferable 项目的整体架构、组件关系、运行时数据流以及核心机制（版本化、Human-in-the-Loop、可观测性等）。

> 在 GitHub、VS Code（带 Mermaid 插件）、或任何支持 Mermaid 的 Markdown 渲染器中可直接查看渲染图。

## 目录

1. [整体系统架构](#1-整体系统架构system-architecture)
2. [工作流执行端到端数据流](#2-工作流执行端到端数据流sequence)
3. [工作流版本控制与版本亲和性](#3-工作流版本控制与版本亲和性)
4. [Human-in-the-Loop 审批状态机](#4-human-in-the-loop-审批状态机)
5. [Monorepo 仓库内组件依赖](#5-monorepo-仓库内组件依赖)
6. [Run 内事件时间线（可观测性）](#6-run-内事件时间线可观测性)
7. [关键要点](#7-关键要点)

---

## 1. 整体系统架构（System Architecture）

```mermaid
graph TB
    subgraph External["🌍 外部触发源"]
        UserApp[用户应用代码]
        ExtAPI[外部 HTTP / cURL]
        CLITrig[Inferable CLI<br/>inf runs create]
    end

    subgraph CP["🎯 Control Plane (api.inferable.ai 或自托管)"]
        direction TB
        Router[Router / API<br/>contract.ts]

        subgraph Modules["核心模块 (control-plane/src/modules)"]
            Auth[auth<br/>认证 / API Keys]
            Clusters[clusters<br/>集群管理]
            Runs[runs<br/>运行编排]
            Jobs[jobs<br/>任务队列]
            Tools[tools<br/>工具注册表]
            Models[models<br/>LLM 路由<br/>routing.ts]
            Machines[machines<br/>Worker 注册]
            Integrations[integrations<br/>Slack / Langfuse]
            Embeddings[embeddings<br/>向量检索]
            Observability[observability<br/>事件流]
            Cron[cron<br/>定时清理]
            Queues[queues<br/>任务分发]
            Email[email<br/>审批通知]
            Expiration[expiration<br/>过期清理]
        end

        subgraph Storage["💾 持久化层"]
            PG[(PostgreSQL<br/>+ pgvector)]
            Redis[(Redis<br/>缓存 / 锁)]
        end

        Router --> Auth
        Router --> Clusters
        Router --> Runs
        Runs --> Jobs
        Jobs --> Queues
        Runs --> Models
        Tools --> Embeddings
        Modules --> PG
        Modules --> Redis
    end

    subgraph LLM["🤖 LLM 提供商"]
        Anthropic[Anthropic Claude]
        Cohere[Cohere]
        Bedrock[AWS Bedrock]
    end

    subgraph UserInfra["🖥️ 用户自有基础设施 (防火墙后亦可)"]
        direction TB
        SDKNode[sdk-node<br/>workflow.listen]
        SDKGo[sdk-go]
        SDKDotnet[sdk-dotnet]
        SDKBash[sdk-bash]
        SDKReact[sdk-react<br/>useRun Hook]

        subgraph WorkerCode["Worker 代码"]
            WF[workflow handler]
            WT[Tools / Functions]
            WA[Agents]
        end

        SDKNode --> WorkerCode
        SDKGo --> WorkerCode
    end

    subgraph Console["🌐 管理控制台 (app/)"]
        UI["Next.js UI<br/>app/clusters/..."]
        Timeline["时间线视图<br/>runs/[runId]"]
        WfUI[工作流浏览器]
        IntegUI[集成配置]
        KeysUI[API Keys 管理]
    end

    subgraph Human["🧑‍💼 人类审批渠道"]
        Slack[Slack]
        Mail[Email]
    end

    UserApp -- "trigger workflow" --> Router
    ExtAPI -- "POST /executions" --> Router
    CLITrig --> Router

    UserInfra -. "③ 长轮询拉取任务<br/>(无入站端口)" .-> Queues
    Queues -. "② 任务下发" .-> UserInfra
    UserInfra -- "④ 上报结果 / 调用 LLM" --> Router

    Models --> Anthropic
    Models --> Cohere
    Models --> Bedrock

    Email --> Mail
    Integrations --> Slack
    Mail -. "审批回执" .-> Router
    Slack -. "审批回执" .-> Router

    Console --> Router
    UI --> Timeline
    UI --> WfUI
    UI --> IntegUI
    UI --> KeysUI

    classDef cp fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef user fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef storage fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef llm fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef human fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class Router,Auth,Clusters,Runs,Jobs,Tools,Models,Machines,Integrations,Embeddings,Observability,Cron,Queues,Email,Expiration cp
    class SDKNode,SDKGo,SDKDotnet,SDKBash,SDKReact,WF,WT,WA user
    class PG,Redis storage
    class Anthropic,Cohere,Bedrock llm
    class Slack,Mail human
```

---

## 2. 工作流执行端到端数据流（Sequence）

```mermaid
sequenceDiagram
    autonumber
    participant App as 用户应用 / cURL
    participant CP as Control Plane API
    participant DB as PostgreSQL
    participant Q as Job Queue
    participant W as Worker (SDK)<br/>your infra
    participant LLM as LLM Provider
    participant H as Human (Slack/Email)

    Note over W: 启动阶段
    W->>CP: 注册 machine + workflow<br/>(POST /machines)
    W->>CP: 注册 tools (POST /tools)
    W-->>CP: 长轮询 /jobs/poll (保持连接)

    Note over App,CP: 触发阶段
    App->>CP: POST /workflows/{name}/executions<br/>{ executionId, input }
    CP->>DB: 持久化 run + version 锁定
    CP->>Q: 入队任务 (pending)
    CP-->>App: 202 Accepted (run_id)

    Note over CP,W: 执行阶段
    Q-->>W: 长轮询返回任务
    W->>W: 执行 workflow handler v1

    Note over W,LLM: 结构化输出步骤
    W->>CP: ctx.llm.structured(schema)
    CP->>LLM: 调用模型 + 注入 schema
    LLM-->>CP: 原始响应
    CP->>CP: 解析 + Zod 验证 + 重试
    CP-->>W: 返回类型安全数据

    Note over W: Memo 缓存
    W->>CP: ctx.memo("key", fn)
    CP->>DB: 查 results 表
    alt 命中
        CP-->>W: 返回缓存
    else 未命中
        W->>W: 执行 fn()
        W->>CP: 写入 results
    end

    Note over W,H: 人类审批 (可选)
    W->>CP: return Interrupt.approval(...)
    CP->>DB: run 状态 = paused
    CP->>H: 发送审批通知 (Email/Slack)
    H-->>CP: 点击批准链接
    CP->>Q: 重新入队 (ctx.approved=true)
    Q-->>W: 恢复执行 (相同 version)

    W->>CP: POST 最终结果
    CP->>DB: run 状态 = completed
    CP->>CP: 触发 observability 事件

    Note over App,CP: 查询阶段
    App->>CP: GET /runs/{run_id}
    CP-->>App: 完整时间线 + 结果
```

---

## 3. 工作流版本控制与版本亲和性

Inferable 通过 **版本亲和性（version affinity）** 机制保证向后兼容：进行中的 run 永远沿用其创建时的版本，新 run 自动使用最新版本。这允许 **渐进式发布**，无需中断正在执行的工作流。

```mermaid
flowchart LR
    subgraph WfDef["工作流定义 (Worker 代码)"]
        V1[workflow.version 1<br/>.define handler]
        V2[workflow.version 2<br/>.define handler]
    end

    subgraph CP["Control Plane"]
        Reg[(版本注册表)]
        Sched{调度器<br/>版本路由}
        DB[(runs 表<br/>记录 version)]
    end

    subgraph Runs["进行中的 Runs"]
        R1[run-A<br/>version=1<br/>paused]
        R2[run-B<br/>version=2<br/>running]
        R3[run-C 新触发]
    end

    V1 -- listen --> Reg
    V2 -- listen --> Reg

    R3 --> Sched
    Sched -->|新 run<br/>使用最新 v2| V2
    Sched -->|进行中 run-A<br/>固守 v1| V1
    Sched -->|进行中 run-B<br/>固守 v2| V2

    R1 --> DB
    R2 --> DB

    style V1 fill:#ffe0b2
    style V2 fill:#c8e6c9
    style R1 fill:#ffe0b2
    style R2 fill:#c8e6c9
```

---

## 4. Human-in-the-Loop 审批状态机

工作流可通过 `Interrupt.approval()` 暂停执行，等待人类（通过 Slack 或 Email）批准后再恢复。整个过程对工作流代码透明，状态由 Control Plane 持久化管理。

```mermaid
stateDiagram-v2
    [*] --> Pending: workflow triggered
    Pending --> Running: worker 拉取任务
    Running --> Calling_LLM: ctx.llm.structured()
    Calling_LLM --> Running: 验证通过
    Calling_LLM --> Calling_LLM: Zod 失败 → 重试

    Running --> Awaiting_Approval: return Interrupt.approval()
    Awaiting_Approval --> Notified: 发送 Slack/Email

    Notified --> Approved: 用户点击 ✅
    Notified --> Rejected: 用户点击 ❌
    Notified --> Expired: 超时

    Approved --> Running: ctx.approved=true<br/>恢复执行 (同版本)
    Rejected --> Failed
    Expired --> Failed

    Running --> Completed: return result
    Running --> Failed: throw error
    Completed --> [*]
    Failed --> [*]
```

---

## 5. Monorepo 仓库内组件依赖

```mermaid
graph LR
    subgraph CoreSvc["核心服务"]
        ControlPlane[control-plane<br/>API + 调度]
        AppUI[app<br/>Next.js 控制台]
        CLI[cli<br/>@inferable/cli]
    end

    subgraph SDKs["SDK 客户端"]
        SDKNode[sdk-node]
        SDKGo[sdk-go]
        SDKDotnet[sdk-dotnet]
        SDKReact[sdk-react]
        SDKBash[sdk-bash]
    end

    subgraph Boot["脚手架"]
        BootNode[bootstrap-node]
        BootGo[bootstrap-go]
        BootDotnet[bootstrap-dotnet]
    end

    subgraph Demos["示例 / 测试"]
        QuoteSys[demos/quote-system]
        Loadtest[load-tests]
    end

    Contract[(共享 Contract<br/>类型定义)]

    ControlPlane <-.contract.-> Contract
    SDKNode <-.contract.-> Contract
    AppUI <-.contract.-> Contract
    CLI <-.contract.-> Contract
    SDKReact <-.contract.-> Contract

    BootNode --> SDKNode
    BootGo --> SDKGo
    BootDotnet --> SDKDotnet

    QuoteSys --> SDKNode
    Loadtest --> SDKNode

    AppUI -- HTTP --> ControlPlane
    CLI -- HTTP --> ControlPlane
    SDKNode -- 长轮询 --> ControlPlane
    SDKGo -- 长轮询 --> ControlPlane
    SDKDotnet -- 长轮询 --> ControlPlane
    SDKReact -- HTTP/SSE --> ControlPlane

    style ControlPlane fill:#bbdefb
    style AppUI fill:#bbdefb
    style CLI fill:#bbdefb
    style Contract fill:#fff9c4
```

---

## 6. Run 内事件时间线（可观测性）

下图为一次包含 LLM 结构化输出、工具调用与人工审批的典型 Run 时间线，对应控制台中的 timeline view。

```mermaid
gantt
    title 一次典型 Run 的事件时间线
    dateFormat  X
    axisFormat  %Ls

    section 调度
    workflow.triggered           :milestone, m1, 0, 0
    job.queued                   :a1, 0, 100ms

    section Worker
    job.picked-up                :a2, after a1, 50ms
    handler.start                :a3, after a2, 30ms

    section LLM
    llm.structured.invoke        :a4, after a3, 800ms
    llm.parse + zod.validate     :a5, after a4, 50ms

    section 工具调用
    tool.searchDatabase          :a6, after a5, 400ms

    section 人类审批
    interrupt.approval           :milestone, m2, after a6, 0
    email.sent                   :a7, after m2, 100ms
    awaiting.user                :crit, a8, after a7, 5s
    user.approved                :milestone, m3, after a8, 0

    section 收尾
    handler.resume               :a9, after m3, 200ms
    workflow.completed           :milestone, m4, after a9, 0
```

---

## 7. 关键要点

| 维度 | 说明 |
|---|---|
| **网络方向** | Worker **主动长轮询** Control Plane → 无需开放入站端口、防火墙友好 |
| **持久化** | PostgreSQL（含 pgvector 向量检索）+ Redis（缓存、分布式锁） |
| **LLM 路由** | `control-plane/src/modules/models/routing.ts` 决定路由到 Anthropic / Cohere / Bedrock |
| **共享契约** | `contract.ts` 在 control-plane / SDK / app 之间共享类型，保证一致性 |
| **版本亲和** | 进行中的 run 永远固守创建时的版本，新 run 使用最新版本 |
| **Memo** | 通过 `results` 表实现分布式缓存，避免重复执行昂贵操作 |
| **Interrupt** | 工作流可"暂停"，由 Slack/Email 回调"恢复"（相同 worker 版本继续执行） |

---

## 进一步阅读

- [docs/internals.md](./internals.md) — **控制平面内部机制**（runs/jobs/queues 模块任务调度详解）
- 项目根 [README](../README.md) — 项目总览
- [control-plane/README.md](../control-plane/README.md) — 控制平面本地开发与自托管
- [sdk-node/README.md](../sdk-node/README.md) — Node.js SDK 快速上手
- [sdk-go/README.md](../sdk-go/README.md) — Go SDK 快速上手
- [cli/README.md](../cli/README.md) — CLI 命令参考
- [Inferable 官方文档](https://docs.inferable.ai/)
