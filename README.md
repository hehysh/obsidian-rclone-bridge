# Obsidian Rclone Bridge

> 在 Obsidian 桌面端用本地 `rclone` 做双向同步的轻量包装器，支持多目的地顺序同步，并提供同步摘要。

## 功能
- 多目的地双向同步：为每个 Remote 配置名称、路径、启用开关，顺序执行 `rclone bisync`，单个失败不阻断其他。
- 同步摘要：解析 `rclone` 输出，展示耗时、已传输大小/文件数、校验信息，或提示“已是最新”。
- 快捷入口：左侧 Ribbon 一键同步；状态栏显示同步状态。

## 前置要求
- 已安装 `rclone` 且完成 `rclone config`。
- Obsidian **桌面端**（需 Node/Electron 以调用本地可执行文件）。

## 安装与配置
1. 终端执行 `rclone config`，创建好远程（如 OneDrive/Google Drive）。
2. 将插件放入你的 Vault 插件目录（例如 `E:\Geek\Note\.obsidian\plugins\obsidian-rclone-bridge`），启用并重载。
3. 在插件设置中：
   - 填写 `rclone` 可执行文件绝对路径（如 `C:/rclone/rclone.exe`）。
   - 添加一个或多个 Remote：名称（remote name）、路径（可含冒号，如 `onedrive:my-vault`，或仅 `my-vault` 将自动拼接名称）、启用开关。
4. 点击左侧 Ribbon 触发同步，观察状态栏/通知。

## 开发
- 安装依赖：`npm install`
- 开发热更新：`npm run dev`
  - 请先设置环境变量 `OBSIDIAN_PLUGIN_DIR` 为你的 Vault 插件目录（例如 `D:\MyVault\.obsidian\plugins\obsidian-rclone-bridge`）。
  - 脚本会 watch `main.ts` 并把 `main.js` 与 `manifest.json` 输出到该目录。
- 构建：`npm run build`（输出到仓库根目录 `main.js`）。

## 同步行为说明
- 命令：`rclone bisync <vaultPath> <remoteTarget> --verbose --resync`
- 顺序执行所有已启用的 remotes，避免并发写导致的锁冲突。
- 失败的 remote 会记录错误并继续下一个；完成后汇总通知。

## 贡献与维护
- 更新功能后，请同步更新本文档（新增配置项、脚本、行为变更等）。
- 欢迎提交 Issue/PR，保持简洁、最小依赖，遵循 Obsidian 插件社区规范
