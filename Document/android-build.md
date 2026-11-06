# Android 构建

版本：1.0.0-beta

## 1. 前置环境

| 工具 | 版本 |
| --- | --- |
| JDK | 21 |
| Android SDK Platform | 36 |
| Android Build Tools | 与 AGP 8.13 兼容的版本 |
| Node.js | 22.12+ |
| Capacitor | 8.6 |

将 SDK 路径写入 `android/local.properties`（该文件不提交）：

```properties
sdk.dir=<ANDROID_SDK_PATH>
```

Windows 路径中的反斜杠需要转义，例如 `C\:\\Android\\Sdk`。也可以设置 `ANDROID_HOME`。

## 2. Debug 构建

```bash
npm ci
npm run android:apk
```

等价步骤：

```bash
npm run build:web
npx cap sync android
cd android
gradlew.bat assembleDebug   # Windows
./gradlew assembleDebug     # macOS / Linux
```

产物：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 3. Release 构建

Release 构建需要独立签名配置。推荐使用 Android Studio 的 **Build → Generate Signed App Bundle / APK**，或通过环境变量提供 keystore 信息，不要把 keystore、口令或签名配置提交到仓库。

基础流程：

```bash
npm run build:web
npx cap sync android
cd android
gradlew.bat bundleRelease
```

发布前检查：

- `versionCode` 每次发布递增，`versionName` 与项目版本一致；
- 使用 release keystore 签名；
- 关闭 WebView 调试；
- 在真实 Android 设备上验证安装、解锁、导入导出与离线启动；
- 确认安装包不包含 `dist/` 之外的多余静态资源。

## 4. 原生工程说明

- 应用 ID：`app.ledgerlite`
- 应用名：简账
- `minSdkVersion`：24（Android 7.0）
- `targetSdkVersion` / `compileSdkVersion`：36
- Android 自动备份关闭：`android:allowBackup="false"`
- 明文网络流量关闭：`network_security_config.xml`
- 启动主题使用品牌深绿背景与本地图标资源

修改 `capacitor.config.ts`、应用 ID、主题或图标后需要重新执行 `npx cap sync android`。

## 5. 构建体积与运行要求

- 无第三方 UI 框架、图表库或远程字体。
- Web 资源由 Vite 压缩后复制到 `android/app/src/main/assets/public/`。
- 首次启动后所有页面和数据均在本地，不依赖网络。
- 数据层与加密运行在 Web Worker；UI 主线程只负责渲染与输入。

## 6. 本仓库的构建状态

本仓库提供可构建的 Capacitor Android 工程与脚本。构建产物（APK/AAB）不提交到版本控制。执行构建前应确认本地 Android SDK 与签名配置符合上述要求。
