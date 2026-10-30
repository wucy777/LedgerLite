# 开发指南

版本：0.1.0-beta

## 1. 环境

- Node.js 22.12+
- npm 10+
- 仅开发 Web 界面时无需 Android SDK
- 构建 Android 时需要 JDK 21 与 Android SDK Platform 36

```bash
npm ci
npm run dev
```

## 2. 命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器（默认 127.0.0.1:4173） |
| `npm run typecheck` | `tsc --noEmit`，必须零错误 |
| `npm test` | Vitest 数据层测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run build:web` | 静态产物构建（先 typecheck） |
| `npm run android:apk` | Web 构建 + Capacitor sync + Gradle debug APK |

## 3. 修改边界

| 目录 | 责任 | 禁止 |
| --- | --- | --- |
| `src/shared/` | 领域类型、校验、金额/日期工具、RPC 契约 | 引入 DOM、React、IndexedDB |
| `src/backend/` | 持久化、统计、加密、Worker | 引入 React 或 UI 样式 |
| `src/frontend/` | 页面、组件、交互状态 | 直接打开 IndexedDB、直接调用 Web Crypto |
| `android/` | Capacitor 原生工程 | 在 Web 代码中假定原生 API 一定存在 |

`StorageApi` 是前后端唯一契约。修改契约时必须同时更新：

1. `src/shared/types.ts`
2. `src/backend/engine.ts`
3. `src/backend/storage.worker.ts`
4. 相关测试
5. `Document/architecture.md`

## 4. 测试规范

数据层测试使用 Node 原生 WebCrypto 与 `fake-indexeddb`，不依赖浏览器环境。至少覆盖：

- 金额边界、排序与筛选；
- 月度汇总、分类占比、每日序列；
- 账目与分类/账户 CRUD；
- 启用/关闭加密后的数据完整性；
- 错误口令、密文篡改；
- 导入导出的结构与引用校验；
- 加密状态下的查询、备份与重置；
- 软归档不破坏历史记录。

前端交互改动至少需要 `npm run typecheck`。涉及录入、月份切换、导入导出或加密的改动，应在浏览器中手动验证移动端视口。

## 5. 金额与日期

- 金额只使用整数分 `amountCents`。解析输入用 `parseAmountToCents`，键盘输入用 `applyAmountKey`。
- 不使用 `parseFloat` 或字符串拼接绕过金额工具。
- 账目发生时间保存为 ISO 时间；展示和月份归类使用设备本地时区。
- 月份键格式固定为 `YYYY-MM`，日期键格式固定为 `YYYY-MM-DD`。

## 6. UI 规范

- 设计变量集中在 `src/frontend/styles/tokens.css`；页面 CSS 使用 `--` 变量，不硬编码另一套色板。
- 所有页面适配 320px 起宽度，并处理 `env(safe-area-inset-*)`。
- 触控目标最小 44×44 CSS 像素；焦点状态可见；表单可通过键盘操作。
- 动效只使用 `transform` / `opacity`，尊重 `prefers-reduced-motion`。
- 图标使用 `components/Icon.tsx` 的内联 SVG；不引入外部字体或图标 CDN。
- 弹层需支持 Esc、遮罩点击、焦点管理、body 滚动锁与退出动画。
- 面向用户的中文文案保持简洁、中性，不使用含糊的宣传语代替具体功能说明。

## 7. 性能检查清单

- [ ] 新查询是否在 Worker 内执行，而不是 UI 主线程？
- [ ] 列表是否避免不必要的全量重渲染？
- [ ] 动画是否只触发布局之外的属性？
- [ ] 是否引入常驻定时器、轮询或网络请求？
- [ ] 新增依赖的体积与许可证是否评估？
- [ ] 是否在 360px 视口与低端 Android WebView 上验证滚动与输入？

## 8. 版本

开发版本遵循语义化版本，当前为 `0.1.0-beta`。版本号需同时出现在：

- `package.json`
- `android/app/build.gradle` 的 `versionName`
- 文档标题与变更记录

发布时移除 `-beta`，构建产物与 Git 标签保持一致。

## 9. 提交前检查

```bash
npm run typecheck
npm test
```

不要在未获授权时执行 APK 打包或推送远程仓库。
