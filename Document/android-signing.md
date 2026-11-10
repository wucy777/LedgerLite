# Android 签名与发布

## 构建类型

| 类型 | 命令 | 产物 | 用途 |
| --- | --- | --- | --- |
| debug | `./gradlew assembleDebug` | `app-debug.apk` | 本机调试；调试证书签名、`debuggable=true` |
| release | `./gradlew assembleRelease` | `app-release.apk` | 正式发布；release 密钥签名、不可调试 |

正式版必须是 release 构建。debug 包用的是 SDK 自动生成的调试证书，换机器构建时签名会变，
覆盖安装会失败，也不适合对外分发。

## 密钥库（公开）

本项目按「开源即公开」的约定，**签名密钥随仓库一起公开**：

- `android/app/release.keystore`（PKCS12，RSA 4096，有效期 10000 天）
- `android/keystore.properties`（别名与口令）
- 原始备份另存于本地 `_keys/`（不进仓库，仅本机留档）

> **这不是安全边界。** 任何拿到仓库的人都能用同一密钥签名 APK，Android 会把这种包
> 视为「同一应用的正常更新」。因此本项目的 release 签名只用于保证**升级连续性**
> （换机器、换 CI 也能覆盖安装），不能用来证明来源。
>
> 若将来需要可信分发（应用商店、对外推广），必须更换新密钥并修改 `applicationId`，
> 届时等于发布一个新应用，老用户需要卸载重装。

## 本地构建

`android/app/build.gradle` 依次查找：

1. `android/keystore.properties`（仓库内，默认命中）
2. `../_keys/keystore.properties`（自定义密钥时覆盖）

```powershell
$env:ANDROID_HOME = 'C:\Android\Sdk'
$env:JAVA_HOME = 'C:\Android\JDK21\jdk-21.0.6+7'
cd android
.\gradlew assembleRelease
```

## CI 构建

工作流 `.github/workflows/android.yml` 的行为：

- `android/keystore.properties` 存在 → `assembleRelease`，产出签名正式包。
- 不存在（例如 fork 时删掉了密钥） → 回退 `assembleDebug`，仍可出可安装的包。

想换成自己的密钥：替换 `android/app/release.keystore` 并更新 `android/keystore.properties` 即可，
工作流不需要任何 Secrets。删掉这两个文件则自动回退 debug 构建。

版本号取自 `package.json`；含 `-` 的版本自动标记为 prerelease，正式版自动为 latest。
产物统一命名为 `LedgerLite-<version>.apk`。
