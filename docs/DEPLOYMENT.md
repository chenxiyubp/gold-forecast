# 安装与源码部署指南

## 1. 选择使用方式

只想使用：下载项目 Release 中的 APK 并安装到 Android 8.0+ 手机。

需要修改：下载仓库源码或用 Git 克隆自己的仓库，在 Windows 构建，再安装 APK。应用本身无需服务器、数据库、数据账号或模型密钥。首次联网获取公开行情与资讯，分析和缓存保存在本机。

## 2. 准备构建环境（Windows）

仓库地址：[chenxiyubp/gold-forecast](https://github.com/chenxiyubp/gold-forecast)。可以选择 Code → Download ZIP，或执行：

```powershell
git clone https://github.com/chenxiyubp/gold-forecast.git
cd gold-forecast
```


1. 安装 Android Studio，在 SDK Manager 中安装 Android SDK Platform 36 和 Build Tools 36.0.0。
2. 准备 JDK 17 或以上。已验证的本地脚本使用 Android Studio 自带的 `jbr`。
3. 安装 Python 3，确认 `python --version` 可执行。
4. 解压源码，进入包含 `build-local.ps1` 的项目目录。

下载源码时不用复制旧版本的 `build/`，但已有用户升级应用必须保留原签名私钥，详见下文。

## 3. 构建 APK（已验证方式）

默认 SDK 位于当前用户的 `AppData/Local/Android/Sdk`，默认 JDK 位于 Android Studio 的 `jbr`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-local.ps1
```

路径不同可明确指定：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-local.ps1 -SdkRoot "D:\Android\Sdk" -JavaHome "C:\Program Files\Android\Android Studio\jbr"
```

脚本调用 Android SDK 编译资源、Java 编译器和 D8，随后对齐并签名。工具安装完成后，这条构建路径不需要下载 Gradle 依赖。成功时显示 `Built and verified`，产物为根目录 `GoldSense-1.3.0.apk`。

构建目录 `build/local/` 包含中间文件和本地签名。默认签名只用于个人测试，不适合直接作为商店正式发行配置。

## 4. 安装与升级

将 APK 传到手机，用文件管理器打开并允许该来源安装应用。也可在安装 Platform Tools 并启用 USB 调试后执行：

```powershell
adb devices
adb install -r .\GoldSense-1.3.0.apk
```

必须使用同一包名和同一签名才能覆盖升级。首次构建生成 `build/local/local-development.keystore`，请离线备份；不要提交到 GitHub。源码仓库不包含签名，别人的首次构建会生成不同签名，无法直接覆盖原作者的安装包。不要为了升级先卸载，除非已经导出记录并接受本地数据丢失。

## 5. Android Studio 路径

仓库也包含标准 Gradle 工程配置（AGP 9.1.0）；未附带 Gradle Wrapper。可用 Android Studio 打开项目并配置兼容 Gradle 版本，现有工程说明为 Gradle 9.3.1。首次同步需要联网获取插件；这条路径未作为当前 APK 的构建验收方式。希望复现当前产物时优先使用上面的本地脚本。

## 6. 启动后的检查

- 设置页检查行情、日线、新闻来源是否获取成功。
- 核对行情时间；休市或分时无报价时应显示最近日线收盘提示。
- 分析页在历史样本不足或数据异常时应说明原因，不应凭空出现预测值。
- 切到后台会暂停定时刷新，重新进入应用按计划检查。
- 断网只能查看缓存和做本地计算，不能获得新价格或新资讯。

## 7. 常见问题

| 问题 | 处理 |
|---|---|
| 找不到 Android 构建工具 | 检查 SDK Platform 36 / Build Tools 36.0.0，或指定 `-SdkRoot` |
| 找不到 Java | 检查 Android Studio 安装目录，指定 `-JavaHome` |
| 找不到 Python | 安装 Python 3 并加入 PATH，重新打开终端 |
| 安装包与已有应用冲突 | 检查签名是否一致；不要随意删除旧版及其数据 |
| 页面空白或功能异常 | 更新 Android System WebView / Chrome，重启应用 |
| 贵金属资讯暂不可用 | 检查设置页；应用会尝试新浪备用入口，两个入口同时失败时保留缓存 |
| 报价没有变化 | 查看源数据时间、是否休市或网络失败；检查频率不代表交易所每次都发布新数据 |

## 8. GitHub 发布

源码托管与手机运行是两回事，上传 GitHub 不需要部署云后端。仓库提交源码、文档与界面截图；APK 推荐放入版本 Release。不要上传 `.keystore`、`.jks`、`local.properties` 或构建缓存。本项目 `.gitignore` 已排除这些文件及 APK。

当前没有后台推送、自动交易、在线账户同步或应用内自动升级服务。安装包使用本地测试签名；正式发行应由维护者设计并保管正式签名流程。
