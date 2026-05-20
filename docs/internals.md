# Inferable 内部机制：Runs & Jobs 任务调度详解

本文档基于源代码深入分析 `control-plane` 中 **`runs`**、**`jobs`** 与 **`queues`** 三大核心模块的内部实现，包含完整的任务生命周期、并发控制、自愈机制与状态机的 Mermaid 流程图。

> 源码路径：`control-plane/src/modules/{runs,jobs,queues}/`

## 目录

1. [模块文件结构](#1-模块文件结构)
2. [核心概念：Run vs Job](#2-核心概念run-vs-job)
3. [Job 状态机](#3-job-状态机)
4. [Job 创建流程（含缓存策略）](#4-job-创建流程含缓存策略)
5. [Worker 长轮询认领任务](#5-worker-长轮询认领任务pollJobsByTools)
6. [Job 结果回写与 Run 恢复](#6-job-结果回写与-run-恢复)
7. [Approval 审批中断流程](#7-approval-审批中断流程)
8. [Self-Heal 自愈机制](#8-self-heal-自愈机制)
9. [Queue 基础设施（BullMQ + Redis）](#9-queue-基础设施bullmq--redis)
10. [Run 处理：分布式锁与重试](#10-run-处理分布式锁与重试)
11. [关键 SQL 模式](#11-关键-sql-模式)

---

## 1. 模块文件结构

```text
control-plane/src/modules/
├── runs/
│   ├── index.ts            ← createRun, resumeRun, cleanupMarkedRuns, deleteRun
│   ├── notify.ts           ← 审批通知 (Slack / Email) + 状态变更通知
│   ├── messages.ts         ← Run 消息持久化
│   ├── summarization.ts    ← Run 摘要
│   └── agent/
│       ├── run.ts          ← processAgentRun (核心 agent 推理循环)
│       ├── agent.ts        ← Agent 编排
│       ├── state.ts        ← 状态机
│       ├── tool.ts         ← 工具调度
│       ├── overflow.ts     ← 上下文溢出处理
│       └── nodes/, tools/
│
├── jobs/
│   ├── jobs.ts             ← pollJobsByTools, requestApproval, submitApproval, cancelJob
│   ├── create-job.ts       ← createJobV2 (含缓存策略)
│   ├── job-results.ts      ← acknowledgeJob, persistJobInterrupt, persistJobResult
│   └── self-heal-jobs.ts   ← selfHealJobs (cron 自愈)
│
└── queues/
    ├── core.ts             ← QueueWrapper (BullMQ 封装), QueueNames 枚举
    ├── index.ts            ← start/stop 全局生命周期
    ├── run-process.ts      ← runProcessQueue + handleRunProcess (互斥锁)
    ├── customer-telemetry.ts
    └── observability.ts    ← withObservability 包装器
```

---

## 2. 核心概念：Run vs Job

```mermaid
graph LR
    subgraph Run["Run (一次工作流执行)"]
        R["runs 表<br/>status: pending/running/paused/done/failed"]
        Msgs["run_messages<br/>对话消息流"]
    end

    subgraph Jobs["Jobs (单次工具调用 / LLM 调用)"]
        J1["jobs 表<br/>每次 tool call 一行"]
        J2["status: pending → running →<br/>success/failure/stalled/interrupted"]
    end

    R -- "1 : N" --> J1
    R --> Msgs
    J1 -- "完成时触发" --> ResumeRun[resumeRun 入队]
    ResumeRun -.-> R

    style R fill:#bbdefb
    style J1 fill:#c8e6c9
```

| 实体 | 表 | 含义 | 状态枚举 |
|---|---|---|---|
| **Run** | `runs` | 一次工作流执行的整体上下文（含消息、agent 状态） | `pending`, `running`, `paused`, `done`, `failed` |
| **Job** | `jobs` | 一次工具调用 / 函数执行（被某 worker 拉取并执行） | `pending`, `running`, `success`, `failure`, `stalled`, `interrupted` |
| **结果** | jobs.result | `resolution` / `rejection` / `interrupt` 三种结果类型 | — |

---

## 3. Job 状态机

```mermaid
stateDiagram-v2
    [*] --> pending: createJobV2
    pending --> running: pollJobsByTools
    running --> success: persistJobResult
    running --> interrupted: persistJobInterrupt
    running --> stalled: selfHeal timeout
    interrupted --> stalled: stuck > 5min
    interrupted --> pending: approval granted
    interrupted --> success: approval denied
    stalled --> pending: attempts > 0
    stalled --> failure: attempts == 0
    success --> [*]
    failure --> [*]

    note right of running
        认领: FOR UPDATE SKIP LOCKED<br/>+ acknowledgeJob<br/>executing_machine_id 标记 worker
    end note

    note right of stalled
        cron 每 5 秒 selfHealJobs<br/>jobRecovered / jobStalledTooManyTimes
    end note

    note left of interrupted
        approval denied 时实际上:<br/>status=success, result_type=rejection<br/>(并非保持 interrupted)
    end note
```

---

## 4. Job 创建流程（含缓存策略）

`createJobV2` 是任务入口，关键代码位于 `jobs/create-job.ts`。

```mermaid
flowchart TD
    Start[调用 createJobV2<br/>tool, args, runId, clusterId] --> Validate{getToolDefinition<br/>查询工具定义}
    Validate -->|未找到 schema| Retry{重试 < 3 次?}
    Retry -->|是| Wait[等待 + 重试]
    Wait --> Validate
    Retry -->|否| Fail1[抛出 ToolNotFoundError]

    Validate -->|找到| Parse["parseJobArgs<br/>用 JSON Schema 校验参数"]
    Parse -->|失败| Fail2[InvalidJobArgumentsError]
    Parse -->|成功| Config["计算配置:<br/>timeoutIntervalSeconds<br/>maxAttempts"]

    Config --> Strategy{"tool.config.cache<br/>?"}

    Strategy -->|有缓存配置| CacheKey["extractCacheKeyFromJsonPath<br/>从 args 提取 key"]
    CacheKey --> CheckCache[("查询 jobs WHERE<br/>cache_key=? AND<br/>status=success AND<br/>created_at &gt; NOW - TTL")]
    CheckCache -->|命中| ReturnCached["返回已存在 jobId<br/>不创建新 job"]
    CheckCache -->|未命中| InsertCached["INSERT pending<br/>带 cache_key"]

    Strategy -->|无缓存| InsertDefault["INSERT pending<br/>default 策略"]

    InsertCached --> EmitEvent["onAfterJobCreated<br/>发出 jobCreated 事件"]
    InsertDefault --> EmitEvent
    ReturnCached --> Done[返回 jobId]
    EmitEvent --> Done

    style ReturnCached fill:#fff9c4
    style EmitEvent fill:#c8e6c9
```

**关键点：**
- **缓存命中**直接复用历史成功结果，避免重复执行（实现 `ctx.memo()`）
- **缓存键**通过 `JSONPath` 从输入参数中提取（确定性 + 灵活）
- **TTL 过期**后自动失效，保证数据新鲜度

---

## 5. Worker 长轮询认领任务（`pollJobsByTools`）

这是 SDK 与 Control Plane 之间最核心的握手机制。源码位于 `jobs/jobs.ts:216`。

```mermaid
sequenceDiagram
    autonumber
    participant W as Worker (SDK)
    participant API as Router (HTTP)
    participant J as pollJobsByTools
    participant DB as PostgreSQL
    participant E as Events

    W->>API: GET /clusters/{cid}/calls/poll<br/>?tools=fn1,fn2&timeout=20s

    Note over API,J: timeout 内可能多次轮询
    API->>J: pollJobsByTools({tools, clusterId, machineId, limit, timeout})

    alt tools 为空
        J-->>API: 返回 []
    end

    J->>J: waitForPendingJobsByTools<br/>(每 N ms COUNT 查询)

    loop 直到 timeout 或有任务
        J->>DB: SELECT COUNT(*) FROM jobs<br/>WHERE status='pending'<br/>AND cluster_id=$1<br/>AND target_fn = ANY($2)<br/>LIMIT 1
        DB-->>J: count
        alt count > 0
            J->>J: 跳出等待
        else
            J->>J: sleep N ms
        end
    end

    Note over J,DB: 原子认领
    J->>DB: UPDATE jobs SET<br/>  status='running',<br/>  executing_machine_id=$mid,<br/>  last_retrieved_at=NOW()<br/>WHERE id IN (<br/>  SELECT id FROM jobs<br/>  WHERE status='pending'<br/>  AND target_fn=ANY($tools)<br/>  LIMIT $limit<br/>  FOR UPDATE SKIP LOCKED<br/>) RETURNING *
    DB-->>J: 已认领的 rows

    J->>J: snake_case → camelCase
    J->>E: writeEvent('jobAcknowledged', ...)<br/>每个 job

    J-->>API: 返回 jobs[]
    API-->>W: 200 OK + jobs

    W->>W: 在本地执行<br/>workflow handler / tool
```

**`FOR UPDATE SKIP LOCKED` 的妙用：**
- 多个并发 worker 可以**同时**调用此 API 而不会拿到同一个 job
- 跳过被其他事务锁定的行 → 完全无冲突的水平扩展
- 这是 PostgreSQL 实现"任务队列"的经典模式

---

## 6. Job 结果回写与 Run 恢复

源码 `jobs/job-results.ts`。

```mermaid
sequenceDiagram
    autonumber
    participant W as Worker
    participant API as Router
    participant J as persistJobResult
    participant DB as PostgreSQL
    participant Q as runProcessQueue

    W->>API: POST /jobs/{jobId}/result<br/>{ result, resultType }
    API->>J: persistJobResult({jobId, resultType, result, machineId})

    J->>DB: UPDATE jobs SET<br/>  status='success',<br/>  result=$result,<br/>  result_type=$type,<br/>  resulted_at=NOW()<br/>WHERE id=$jobId<br/>AND executing_machine_id=$mid<br/>AND status='running'<br/>RETURNING run_id, ...

    alt 更新失败 (例如已被 self-heal 标记 stalled)
        DB-->>J: rowCount=0
        J->>J: emit jobResultedButNotPersisted<br/>(warning)
        J-->>API: 返回 (静默丢弃)
    else 更新成功
        DB-->>J: row { runId, ... }
        J->>J: emit jobResulted 事件

        alt job 关联了 run
            J->>Q: resumeRun({ id: runId, clusterId })
            Note over Q: 入队 runProcessQueue<br/>触发 agent 继续推理
        end

        J-->>API: 200 OK
    end
```

**关键设计：**
- **乐观并发**：`status='running' AND machine_id=?` 作为更新前提，避免覆盖 self-heal 已标记 stalled 的 job
- **解耦**：Job 完成后**不直接执行** agent 逻辑，而是入队 `runProcessQueue`，由 worker 异步 pickup → 防止 HTTP handler 长时间阻塞

---

## 7. Approval 审批中断流程

源码 `jobs/jobs.ts:301`（`requestApproval`）和 `:379`（`submitApproval`）。

```mermaid
sequenceDiagram
    autonumber
    participant Wrk as Worker
    participant CP as Control Plane
    participant DB as PostgreSQL
    participant N as notify.ts
    participant U as 用户 (Slack/Email)
    participant Q as runProcessQueue

    Note over Wrk: workflow 返回 Interrupt.approval(...)
    Wrk->>CP: POST /jobs/{id}/result<br/>{ resultType: 'interrupt' }
    CP->>DB: persistJobInterrupt:<br/>UPDATE jobs SET<br/>  status='interrupted',<br/>  approval_requested=true<br/>WHERE id=? AND status='running'<br/>AND executing_machine_id=?

    CP->>CP: emit approvalRequested

    CP->>N: notifyApprovalRequest<br/>(destination=email/slack)
    alt destination=slack
        N->>U: 发送 Slack 消息 + 批准按钮
    else destination=email
        N->>U: 发送 Email + 批准/拒绝链接
    end

    alt 通知失败
        N-->>CP: emit notificationFailed<br/>(不阻断流程)
    end

    Note over U: ⏳ 等待用户响应

    U->>CP: POST /clusters/{cid}/calls/{jid}/approval<br/>{ approved: true/false }
    CP->>CP: submitApproval

    alt approved=true (批准)
        CP->>DB: UPDATE jobs SET<br/>approved=true, status='pending',<br/>executing_machine_id=NULL,<br/>last_retrieved_at=NULL,<br/>remaining_attempts += 1<br/>WHERE id=? AND approved IS NULL<br/>AND approval_requested=true
        CP->>CP: emit approvalGranted
        Note over DB: ✅ Job 回到 pending 池<br/>下一轮 poll 会被重新认领
    else approved=false (拒绝)
        CP->>DB: UPDATE jobs SET<br/>approved=false, status='success',<br/>result_type='rejection',<br/>result=user-rejection-message<br/>WHERE id=? AND cluster_id=?
        CP->>CP: emit approvalDenied
        Note over DB: ❌ Job 以 rejection 形式完成<br/>后续会触发 resumeRun 让 agent 看到拒绝结果
    end

    CP-->>U: 200 OK

    Note over Q: 后续：worker 重新拉取该 job
```

**Interrupt 设计精髓：**
- 中断不是真正"暂停进程"，而是**写入 DB 状态 + 让 job 短暂消失**
- 批准后**重置回 pending**，由长轮询机制自然回流
- `ctx.approved` 在恢复执行时由 SDK 注入，使代码逻辑得以分支

---

## 8. Self-Heal 自愈机制

源码 `jobs/self-heal-jobs.ts`，由 cron 每 **5 秒**触发。

```mermaid
flowchart TD
    Start[selfHealJobs<br/>cron 每 5 秒] --> Step1

    subgraph Step1["第 1 步: 标记超时的 running 为 stalled"]
        S1A["SELECT jobs WHERE<br/>status='running'<br/>AND last_retrieved_at + timeout &lt; NOW<br/>AND approval_requested=false"]
        S1A --> S1B["UPDATE → status='stalled'"]
        S1B --> S1C["emit jobStalled 每个"]
    end

    Step1 --> Step2

    subgraph Step2["第 2 步: 处理 interrupted 卡住"]
        S2A["SELECT jobs WHERE<br/>status='interrupted'<br/>AND updated_at &lt; NOW - 5min<br/>AND updated_at &gt; NOW - 1h"]
        S2A --> S2B["UPDATE → status='stalled'<br/>remaining_attempts += 1"]
        S2B --> S2C["logger.warn"]
    end

    Step2 --> Step3

    subgraph Step3["第 3 步: 处理所有 stalled"]
        S3A["SELECT jobs WHERE status='stalled'"]
        S3A --> S3B{"remaining_attempts &gt; 0 ?"}
        S3B -->|是| S3C["UPDATE →<br/>status='pending'<br/>remaining_attempts -= 1"]
        S3C --> S3D["emit jobRecovered"]
        S3B -->|否| S3E["UPDATE →<br/>status='failure'"]
        S3E --> S3F["emit jobStalledTooManyTimes"]
        S3F --> S3G{"有 runId?"}
        S3G -->|是| S3H["resumeRun<br/>让 agent 处理失败"]
    end

    Step3 --> End["返回:<br/>stalledByTimeout: ids<br/>recovered: ids<br/>nonResumedInterrupts: ids"]

    style S3D fill:#c8e6c9
    style S3E fill:#ffcdd2
    style S3H fill:#ffe0b2
```

**容错保证：**
- Worker 崩溃 → `last_retrieved_at + timeout` 超时 → 自动 stalled → 自动 retry pending
- 永不失联：即使所有相关组件全部宕机重启，5 秒内系统恢复一致性
- `remaining_attempts` 提供有限重试，避免无限循环

---

## 9. Queue 基础设施（BullMQ + Redis）

源码 `queues/core.ts`。

```mermaid
graph TB
    subgraph Wrapper["QueueWrapper&lt;T&gt; (类型安全封装)"]
        Send[send method<br/>入队]
        Start[start method<br/>启动 worker]
        Stop[stop method<br/>优雅关闭]
        Inspect[inspect method<br/>队列状态]
    end

    subgraph Names["QueueNames 枚举"]
        N1[runProcess]
        N2[customerTelemetry]
        N3[generateName]
        N4[externalToolCall]
        N5[emailIngestion]
        N6[resumeRun]
    end

    subgraph BullMQ["BullMQ 库"]
        Queue[bullmq.Queue]
        Worker[bullmq.Worker]
        OTel[bullmq-otel<br/>分布式追踪]
    end

    Wrapper --> BullMQ
    BullMQ --> Redis[(Redis<br/>bullmqRedisConnection)]

    Names -.使用.- Wrapper

    Wrapper -- "默认配置" --> Defaults["• attempts: 3<br/>• removeOnComplete: keep last 1000<br/>• removeOnFail: keep last 1000<br/>• withObservability 自动包裹<br/>(runProcessQueue 覆写为 true/true)"]

    Wrapper -- "ENABLE_QUEUE_INGESTION=false" --> Skip[跳过 worker 启动<br/>仅入队，不消费]

    style Redis fill:#fff3e0
    style Defaults fill:#e8f5e9
```

**为什么需要 BullMQ 而不只是 PG 表队列？**
| 用途 | 实现 |
|---|---|
| **Job 调度**（用户工作流的工具调用） | PostgreSQL `FOR UPDATE SKIP LOCKED`（持久化、可审计） |
| **Run 处理**（agent 内部推理触发） | BullMQ（低延迟、自动重试、延迟入队） |

两者**互补**：DB 队列保证业务持久性，Redis 队列保证响应性能。

---

## 10. Run 处理：分布式锁与重试

源码 `queues/run-process.ts`。`processAgentRun` 必须保证**同一 run 不会被并发处理**。

```mermaid
flowchart TD
    Start[runProcessQueue 收到消息<br/>{ runId, clusterId, lockAttempts? }] --> Parse[zod 校验 message schema]
    Parse --> TryLock[acquireMutex<br/>'run-process-${cid}-${rid}']

    TryLock -->|获取成功| Acquired[拿到锁]
    TryLock -->|获取失败<br/>已被其他 worker 持有| FailLock{"lockAttempts &lt; 5 ?"}

    FailLock -->|是| Backoff["指数退避<br/>delay = 2^attempts 秒"]
    Backoff --> Requeue["runProcessQueue.send<br/>{ ...msg, lockAttempts: +1 }<br/>+ delay"]
    Requeue --> Done1[当前 worker 释放任务]

    FailLock -->|否 已达上限| Skip["logger.warn<br/>跳过该 run"]
    Skip --> Done2[结束]

    Acquired --> GetRun["getRun: 查 runs 表"]
    GetRun --> CheckLimit{"ephemeral cluster<br/>是否超限 ?"}
    CheckLimit -->|是| Reject[抛错 - 释放锁]
    CheckLimit -->|否| Process["processAgentRun run<br/>—— Agent 推理循环 ——"]

    Process --> Finally["finally:<br/>releaseMutex"]
    Reject --> Finally
    Finally --> Done3[完成]

    style Acquired fill:#c8e6c9
    style Backoff fill:#fff9c4
    style Process fill:#bbdefb
    style Skip fill:#ffcdd2
```

**关键参数：**
- **并发限制**：`runProcessQueue` 的 worker concurrency = **5**（同一进程最多 5 个 run 并行）
- **锁机制**：Redis 互斥锁，name=`run-process-{clusterId}-{runId}`
- **最大重试**：`MAX_PROCESS_LOCK_ATTEMPTS = 5`，超过则放弃（依赖后续 resumeRun 触发）
- **作业清理**：`runProcessQueue` 覆写了 `QueueWrapper` 的默认值，设为 `removeOnComplete: true, removeOnFail: true`——不保留作业历史，因为 run 状态完全在 PG 中跟踪

---

## 11. 关键 SQL 模式

### 11.1 原子性的"领取任务"
```sql
UPDATE jobs SET
  status = 'running',
  executing_machine_id = $1,
  last_retrieved_at = NOW()
WHERE id IN (
  SELECT id FROM jobs
  WHERE status = 'pending'
    AND cluster_id = $2
    AND target_fn = ANY($3)
  ORDER BY created_at
  LIMIT $4
  FOR UPDATE SKIP LOCKED   -- 🔑 关键：跳过其他 worker 锁定的行
)
RETURNING *;
```

### 11.2 缓存命中检查
```sql
SELECT id FROM jobs
WHERE cluster_id = $1
  AND target_fn = $2
  AND cache_key = $3
  AND status = 'success'
  AND result_type = 'resolution'
  AND created_at > NOW() - INTERVAL '$4 seconds'
LIMIT 1;
```

### 11.3 乐观并发结果回写
```sql
UPDATE jobs SET
  status = 'success',
  result = $1,
  result_type = $2,
  resulted_at = NOW()
WHERE id = $3
  AND cluster_id = $4
  AND status = 'running'
  AND executing_machine_id = $5  -- 🔑 防止 self-heal 抢夺后的覆盖
RETURNING run_id;
```

### 11.4 Self-heal 超时检测
```sql
UPDATE jobs SET status = 'stalled'
WHERE status = 'running'
  AND approval_requested = false
  AND last_retrieved_at + (timeout_interval_seconds || ' seconds')::interval < NOW()
RETURNING id, run_id, cluster_id;
```

---

## 总结：调度全链路

```mermaid
graph LR
    A[trigger] --> B[createJobV2]
    B -->|缓存命中| Z[复用结果]
    B -->|未命中| C[INSERT pending]
    C --> D[Worker poll]
    D -->|FOR UPDATE SKIP LOCKED| E[running]
    E --> F1[success]
    E --> F2[interrupted - 审批]
    E --> F3[stalled - 超时]
    F2 -->|批准| C
    F3 -->|attempts > 0| C
    F3 -->|attempts = 0| F4[failure]
    F1 --> G[resumeRun 入队]
    F4 --> G
    G --> H[runProcessQueue]
    H -->|互斥锁| I[processAgentRun]
    I -->|继续推理| B
    I -->|完成| J[run.done]

    style B fill:#c8e6c9
    style E fill:#bbdefb
    style F2 fill:#fff9c4
    style F3 fill:#ffe0b2
    style F4 fill:#ffcdd2
    style J fill:#a5d6a7
    style Z fill:#fff9c4
```

---

## 进一步阅读

- [docs/architecture.md](./architecture.md) — 系统级架构与端到端数据流
- [`control-plane/src/modules/jobs/jobs.ts`](../control-plane/src/modules/jobs/jobs.ts) — Job 主调度逻辑
- [`control-plane/src/modules/jobs/create-job.ts`](../control-plane/src/modules/jobs/create-job.ts) — Job 创建 + 缓存策略
- [`control-plane/src/modules/jobs/self-heal-jobs.ts`](../control-plane/src/modules/jobs/self-heal-jobs.ts) — 自愈逻辑
- [`control-plane/src/modules/queues/run-process.ts`](../control-plane/src/modules/queues/run-process.ts) — Run 处理队列与互斥锁
- [`control-plane/src/modules/runs/agent/run.ts`](../control-plane/src/modules/runs/agent/run.ts) — `processAgentRun` Agent 推理循环
