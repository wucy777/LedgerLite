# 架构说明

本文描述简账的运行结构、数据边界与扩展方式。版本：0.1.0-beta。

## 1. 设计目标

1. **离线优先**：读写只发生在设备本地，不依赖服务端。
2. **速记优先**：新增账目的高频路径保持短、可预测、无阻塞。
3. **数据与界面分离**：UI 不直接访问 IndexedDB、凭证派生或加解密逻辑。
4. **低主线程开销**：查询、统计、加解密放到独立 Worker。
5. **可替换数据后端**：数据服务以 RPC 契约为边界，可迁移到 SQLite 或原生插件。
6. **可开源维护**：模块职责明确，关键算法可单元测试，无重量级框架绑定。

## 2. 分层

```text
src/
├─ shared/                     领域层（无 UI、无存储）
│  ├─ types.ts                 领域模型 + StorageApi RPC 契约
│  ├─ validation.ts            输入校验
│  ├─ money.ts                 整数分金额处理
│  ├─ date.ts                  本地时区日期处理
│  └─ defaults.ts              默认分类与账户
├─ backend/                    数据服务层
│  ├─ db.ts                    IndexedDB Promise 封装
│  ├─ crypto.ts                PBKDF2 / HKDF / AES-GCM / HMAC
│  ├─ engine.ts                LedgerEngine 业务与持久化编排
│  └─ storage.worker.ts        Worker RPC 入口（薄壳）
└─ frontend/                   表示层
   ├─ api/client.ts            Worker 客户端（请求关联、错误反序列化）
   ├─ App.tsx                  会话、月份、导航、页面编排
   ├─ pages/                   明细 / 统计 / 设置
   ├─ features/                录入面板、统计组件、设置组件
   ├─ components/              图标、排版组件、Toast、弹层基础
   ├─ hooks/                   请求状态管理
   └─ styles/                  设计变量、布局、页面样式
```

依赖方向固定为：

```text
frontend → shared ← backend
```

`frontend` 与 `backend` 不互相 import。二者只共享 `src/shared/types.ts` 的模型与 `StorageApi` 契约。Worker 的导入路径由前端客户端通过 `new Worker(new URL(...))` 建立，属于运行时边界。

## 3. RPC 生命周期

```text
页面加载
  → App 调用 initialize
  → Worker 打开 IndexedDB，读取 catalog / crypto 元数据
  → 未加密：返回 ready + catalog
  → 已加密：返回 locked，UI 显示解锁界面
  → 用户输入口令：unlock 派生密钥并验证 verifier
  → 返回 ready + 解密后的 catalog
  → 页面按月份调用 listMonth / getStats
```

请求格式：

```ts
{ id: number, method: StorageMethod, params: unknown }
```

响应格式：

```ts
{ id: number, ok: true, result: unknown }
{ id: number, ok: false, error: { code, message } }
```

- 每个请求带单调递增 `id`，客户端用 Map 关联 Promise。
- Worker 按消息顺序处理，不需要额外的锁。
- 前端 `useAsyncResource` 使用请求序号丢弃过期响应，避免快速切换月份时旧响应覆盖新页面。
- `LedgerError` 在 Worker 边界序列化为可展示的中文错误。

## 4. 数据模型与存储

### 4.1 领域模型

- `Entry`：账目。金额 `amountCents` 为整数分；日期使用 ISO 时间；本地时区用于展示与月度归类。
- `Category`：分类。包含所属收支类型、图标名、颜色、排序与 `archived` 标记。
- `Account`：账户。同样支持软归档。
- `Catalog`：分类与账户的集合。
- `MonthStats`：由数据层聚合的月度视图，UI 不再重复计算。

### 4.2 IndexedDB

数据库：`ledgerlite`，版本 `1`。

| Store | keyPath | 索引 | 内容 |
| --- | --- | --- | --- |
| `entries` | `id` | `monthTag` | 账目记录，字段可能整体加密 |
| `kv` | `key` | — | `catalog`、`crypto` 元数据 |

记录包装形式：

```ts
interface EntryRecord {
  id: string;
  monthTag: string;         // 明文模式下为 YYYY-MM；加密模式下为 HMAC 十六进制
  payload:
    | { encrypted: false; value: Entry }
    | { encrypted: true; iv: ArrayBuffer; data: ArrayBuffer };
}
```

目录记录使用相同的 `payload` 包装。软归档避免历史账目因删除分类而丢失展示信息。

### 4.3 重要约束

- 一次跨 store 重写（启用/关闭加密、导入）必须在单个 IndexedDB 事务中提交。
- IDB 事务内不得 await 非 IDB 异步任务，否则事务会自动提交；所有加解密先在事务外完成。
- 写入后由前端递增 `revision`，触发当前月的账本与统计重新查询。
- 月份标签按设备本地时区计算，保证跨零点记账落到正确的自然日。

## 5. 加密流程

```text
passphrase
   │ PBKDF2-SHA256, 310000 iterations, 16-byte random salt
   ▼
master bits (256)
   │ HKDF-SHA256，分离用途
   ├──────────────► AES-256-GCM key（记录与目录加密）
   └──────────────► HMAC-SHA256 key（月份索引）
```

- 每条密文使用独立 12 字节 IV。
- AAD 同时绑定记录 ID 与 `monthTag`，防止密文被挪用到其他记录或月份。
- 验证器（verifier）是固定明文常量的 AES-GCM 密文，用于区分“口令错误”和“无可用加密环境”。
- 加密元数据（盐、验证器）以明文保存，但不包含口令或密钥。
- 口令、派生密钥与解密后的业务数据只存在于 Worker 内存中。
- 锁定操作清除内存中的密钥；下一次查询必须重新解锁。

启用加密时，数据层读取全部明文记录，完成加密后再打开一个 `entries + kv` 的读写事务完成替换。关闭加密采用相反流程。

## 6. 性能设计

| 措施 | 目的 |
| --- | --- |
| 独立 Worker 承载 IDB、统计与 Web Crypto | 避免主线程卡顿 |
| `useAsyncResource` 序号校验 | 避免竞态与重复渲染 |
| 二级页面与录入面板按需加载、空闲预载 | 缩短首屏脚本执行时间 |
| 金额使用整数分 | 避免浮点误差与格式化开销 |
| 纯 CSS / SVG 图形 | 不引入图表与图标运行时 |
| 无网络字体、无第三方 UI 框架 | 降低包体与首次绘制成本 |
| 列表按日分组、CSS `content-visibility` | 降低长列表绘制成本 |
| 动画使用 `transform` / `opacity` | 尽量交由合成层处理 |
| `prefers-reduced-motion` 支持 | 降低动效敏感用户的不适 |

## 7. 导出路径

导出本身不经过数据服务：数据层返回完整的明文 `BackupPayload`，由设置页生成文件。

- Web：使用 Blob URL 触发浏览器下载。
- Android：使用 Capacitor Filesystem 将文件写入应用缓存目录，再通过 Capacitor Share 打开系统分享面板。WebView 不提供浏览器式下载目录，因此没有沿用 `<a download>` 路径。
- 加密账本在导出时仍输出明文文件，设置页会显示相应提示。

## 8. 扩展路径

- **替换存储**：实现相同的 `StorageApi` 方法，将 `storage.worker.ts` 替换成原生 Capacitor 插件或 SQLite Worker，前端无需改动。
- **多账本**：在 `Entry` 与查询契约增加 `ledgerId`，在 `kv` 增加账本目录；当前单账本设计是有意保持录入路径最短。
- **同步**：应以独立同步服务为边界，不应把网络请求塞入 UI 组件。记录已包含 `updatedAt`，可作为同步冲突检测的基础。
- **国际化**：UI 文案集中化后可增加语言包；数据层错误码已经是语言无关的枚举。

## 9. 进一步阅读

- [安全与威胁模型](security.md)
- [开发指南](development.md)
- [Android 构建](android-build.md)
