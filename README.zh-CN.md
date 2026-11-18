<div align="center">

<img src="assets/logo.svg" alt="Context & Token Monitor Logo" width="64" height="64" />

# Antigravity 上下文与 Token 实时监控插件 (`Context & Token Monitor`)

在 Antigravity 客户端侧边栏与窗口顶部标题栏实时查看当前会话的上下文窗口占用、缓存命中率、生成速度、TTFT，以及桌面端与 CLI 的历史 Token 统计与参考费用对比。

[English](./README.md) | **简体中文**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![Platform: macOS & Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](#平台支持)

</div>

---

## 界面预览

**窗口顶部状态胶囊（可选增强）**

![窗口顶部状态胶囊](./assets/screenshots/top-capsule.png)

**侧边栏监控面板（当前会话 & Token 一览）**

*（注：以下截图中的个人会话名称与具体数值已作脱敏马赛克处理；实际面板右上角支持一键切换 `中文 / EN`。）*

<table>
  <tr>
    <th width="50%">当前会话监控与模型配额</th>
    <th width="50%">Token 一览与订阅对比</th>
  </tr>
  <tr>
    <td valign="top"><img src="./assets/screenshots/live-panel.png" alt="当前会话面板" width="100%" /></td>
    <td valign="top"><img src="./assets/screenshots/token-overview.png" alt="Token 一览面板" width="100%" /></td>
  </tr>
</table>

---

## 核心功能

### 1. 官方 Sidecar 侧边栏面板 (`Context & Tokens`)
零第三方运行时依赖（仅依赖 Node.js 内置模块与 Antigravity `sidecar_sdk`），原生集成于客户端辅助面板：
- **核心上下文用量**：实时追踪当前对话已用 Token 与窗口上限（支持 `自动` / `200K` / `983K` / `1M` / `2M`），带健康状态警示（正常 / `≥75%` 偏高 / `≥90%` 临近上限）与下轮基线预估。
- **生成速度与首字延迟**：实时计算流式输出速度（`tok/s`）、总耗时与 TTFT（首字延迟），并区分思考 Token（Thinking）与正文回复 Token。
- **账号套餐与模型配额**：通过本机 LanguageServer RPC 读取当前套餐档位、Prompt/Flow Credits 以及各模型组剩余配额百分比与重置时间。
- **会话拆解与步骤时间线**：展示服务端累计 Input / Cache Read / Output、本地归档字符分布，以及最近 30 步模型请求时间线。
- **桌面端 + CLI 全局 Token 一览**：自动聚合桌面端与 CLI 的历史 `transcript.jsonl` 日志：
  - 提供 52 周每日热力图、周柱状图、月度日历、年度 12 月柱状图及累计曲线（支持 4 套配色主题）。
  - 支持 API 参考等值金额与订阅套餐（Google AI Plus / Pro / Ultra / 自定义实付）对比。
  - 默认币种为 **人民币 (`CNY`)**，支持切换 `USD / EUR / GBP / HKD / TWD / JPY`。
  - 支持点击最近活跃会话进行离线历史预览。
- **中 / 英双语切换**：默认界面语言为**简体中文**，顶部工具栏支持一键切换 **中文 / EN** 并持久化保存。

### 2. 窗口顶部状态胶囊（安装即默认开启）
安装并启用插件后**开箱即用，无需运行任何额外自启脚本**，自动在客户端顶部标题栏注入紧凑胶囊条（`Context: 已用/上限(百分比) || 模型配额 || 输出速度 || 当前会话合计`）。悬停可查看详细统计，点击可一键展开/收起右侧 `Context & Tokens` 面板；您也可以随时在侧边栏右上角点击 `胶囊: 开 / 关` 一键切换显示。

> **架构说明**：侧边栏与内置顶部胶囊（`sidecars/context-monitor/capsule.mjs`）均由 Antigravity 托管的 Sidecar 进程统一启动，随插件启用/禁用自动启停；顶部胶囊仅连接本机 `127.0.0.1` 的 `DevToolsActivePort` 端口。

---

## 架构概览

```mermaid
flowchart LR
  LS["Antigravity LanguageServer (127.0.0.1)"] -->|"GetUserStatus / GetCascadeTrajectorySteps"| Sidecar["sidecars/context-monitor/main.mjs"]
  Logs["本地 transcript.jsonl (桌面端 & CLI)"] -->|"降级读取与历史聚合"| Sidecar
  Sidecar -->|"辅助面板 Web UI"| Panel["Context & Tokens 侧边栏"]
  Sidecar -->|"内置 capsule.mjs (127.0.0.1 CDP)"| Window["Antigravity 窗口标题栏"]
```

---

## 环境要求

- **Antigravity 客户端**（支持桌面端，并可同时统计 CLI 会话）
- **Node.js >= 22.0.0**（Antigravity 内置 Sidecar 已提供 Node 24+ 运行时；本地开发测试需 Node >= 22）

---

## 安装方式

### 方式一：通过 Antigravity CLI 一键安装（推荐）

```bash
git clone https://github.com/llaolaol/antigravity-context-monitor.git
agy plugin install ./antigravity-context-monitor
```

### 方式二：手动拷贝安装

1. 克隆或下载本仓库源码。
2. 将仓库目录复制（或软链接）到全局插件目录并命名为 `context-monitor`：
   - **macOS**：`~/.gemini/config/plugins/context-monitor/`
   - **Windows**：`%USERPROFILE%\.gemini\config\plugins\context-monitor\`
3. 在 Antigravity 插件管理页面确认已启用 **Context & Token Monitor**，**顶部状态胶囊**与 **`Context & Tokens` 侧边栏面板**均会自动生效。

> **从 v1.0.0 升级提示**：如果您此前手动执行过旧版 `install-top-capsule.sh` 或 `install-top-capsule.ps1`，请执行一次 `./uninstall-top-capsule.sh`（macOS）或 `.\uninstall-top-capsule.ps1`（Windows）清理旧版后台守护任务，避免重复进程。

---

### 平台支持

| 组件 | macOS | Windows | Linux |
| :--- | :---: | :---: | :---: |
| 官方 Sidecar 面板 (`sidecars/context-monitor`) | 支持 | 支持 | 暂未实测 |
| 内置顶部状态胶囊 (`capsule.mjs`) | 支持 | 支持 | 实验性（`~/.config/Antigravity`） |

---

## 隐私安全与免责声明

- **100% 本地运行**：所有统计计算、日志扫描与偏好配置均在本地完成（偏好与运行日志保存在 `~/.gemini/antigravity/sidecar_data/context-monitor/`），不会向任何外部服务器上传您的对话记录、Token 数据或账号信息。
- **参考金额声明**：界面中的金额估算基于内置公开 API 参考单价与静态汇率换算，仅用于消费趋势与订阅性价比的横向对比参考，不代表实际账单结算金额。

---

## 本地开发与测试

```bash
# 运行全部单元测试（需 Node.js >= 22）
npm test

# 使用官方 CLI 严格校验插件清单
agy plugin validate . --strict
```

---

## 开源协议

[MIT](./LICENSE) © 2026 llaolaol
