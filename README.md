<div align="center">

<img src="assets/logo.svg" alt="Context & Token Monitor Logo" width="64" height="64" />

# Context & Token Monitor for Antigravity

Real-time context window usage, cache hit rate, generation speed, TTFT, and Desktop/CLI token analytics right inside Antigravity.

**English** | [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js >= 22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![Platform: macOS & Windows](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](#platform-support)

</div>

---

## Preview

**Titlebar Top Capsule (Optional)**

![Titlebar Top Capsule](./assets/screenshots/top-capsule.png)

**Sidecar Panel (`Live Session` & `Token Overview`)**

*(Note: Personal session titles and numeric values in the screenshots below are mosaicked for privacy; the UI also supports a 1-click `中文 / EN` switcher.)*

<table>
  <tr>
    <th width="50%">Live Session &amp; Model Quotas</th>
    <th width="50%">Token Overview &amp; Cost Comparison</th>
  </tr>
  <tr>
    <td valign="top"><img src="./assets/screenshots/live-panel.png" alt="Live Session Panel" width="100%" /></td>
    <td valign="top"><img src="./assets/screenshots/token-overview.png" alt="Token Overview Panel" width="100%" /></td>
  </tr>
</table>

---

## Features

### 1. Official Sidecar Panel (`Context & Tokens`)
Runs natively in Antigravity's auxiliary pane with zero third-party runtime dependencies:
- **Live Context Budget**: Tracks active context tokens vs. window limit (`Auto`, `200K`, `983K`, `1M`, `2M`) with health indicators (`normal` / `warn >=75%` / `critical >=90%`) and next-turn baseline estimation.
- **Speed & Latency**: Measures streaming output speed (`tok/s`), total generation duration, and TTFT (Time To First Token), plus thinking vs. response token split.
- **Account & Model Quotas**: Reads active tier, Prompt/Flow credits, and remaining per-model quota percentages via local LanguageServer RPC.
- **Session Breakdown & Step Timeline**: Inspects cumulative Input / Cache Read / Output tokens, archived character distribution, and the last 30 planner steps.
- **Desktop & CLI Token Overview**: Aggregates historical `transcript.jsonl` logs across both Antigravity Desktop and CLI with:
  - 52-week daily heatmap, weekly bar chart, monthly calendar, 12-month bar chart, and cumulative curve (4 color themes).
  - Reference API cost estimation vs. subscription plans (`CNY` default + `USD`, `EUR`, `GBP`, `HKD`, `TWD`, `JPY`).
  - Clickable recent conversations list for offline preview.
- **Bilingual UI (`中文` / `EN`)**: Defaults to Simplified Chinese (`zh-CN`) and `CNY`, with an instant 1-click language & currency switcher in the top bar (persisted locally).

### 2. Optional Titlebar Top Capsule (`top-capsule.mjs`)
An optional background helper that injects a compact pill into Antigravity's window titlebar (`Context: 50.0K/1.05M(4.8%) || Model Quota || 120 tok/s || Session Cost`). Clicking the capsule toggles the right-hand `Context & Tokens` side panel.

> **Note**: The Sidecar panel uses the official Antigravity Sidecar SDK. The Top Capsule is an **optional** local enhancement that connects to Antigravity's local `127.0.0.1` Chrome DevTools port (`DevToolsActivePort`).

---

## Architecture

```mermaid
flowchart LR
  LS["Antigravity LanguageServer (127.0.0.1)"] -->|"GetUserStatus / GetCascadeTrajectorySteps"| Sidecar["sidecars/context-monitor/main.mjs"]
  Logs["Local transcript.jsonl (Desktop & CLI)"] -->|"Fallback & Historical Overview"| Sidecar
  Sidecar -->|"Aux Pane Web UI"| Panel["Context & Tokens Panel"]
  Sidecar -->|"GET /api/metrics"| Capsule["top-capsule.mjs (Optional)"]
  Capsule -->|"127.0.0.1 CDP DOM Pill"| Window["Antigravity Window Titlebar"]
```

---

## Prerequisites

- **Antigravity** (Desktop, or Desktop + CLI)
- **Node.js >= 22.0.0** (required for native global `WebSocket` and `AbortSignal.timeout`)

---

## Installation

### Option 1: Install via Antigravity CLI (Recommended)

```bash
git clone https://github.com/llaolaol/antigravity-context-monitor.git
agy plugin install ./antigravity-context-monitor
```

### Option 2: Manual Installation

1. Clone or download this repository.
2. Copy the folder to your Antigravity global plugins directory as `context-monitor`:
   - **macOS**: `~/.gemini/config/plugins/context-monitor/`
   - **Windows**: `%USERPROFILE%\.gemini\config\plugins\context-monitor\`
3. Enable **Context & Token Monitor** on the Antigravity Customizations / Plugins page and open the `Context & Tokens` side panel.

---

## Optional: Enable the Titlebar Top Capsule

The Top Capsule reads Antigravity's `DevToolsActivePort` file (`127.0.0.1` local CDP) and displays live metrics in the titlebar.

### macOS

```bash
chmod +x install-top-capsule.sh uninstall-top-capsule.sh
./install-top-capsule.sh
```

To disable and remove the LaunchAgent:

```bash
./uninstall-top-capsule.sh
```

### Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File .\install-top-capsule.ps1
```

To disable and remove the Scheduled Task:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-top-capsule.ps1
```

### Platform Support

| Component | macOS | Windows | Linux |
| :--- | :---: | :---: | :---: |
| Official Sidecar Panel (`sidecars/context-monitor`) | Yes | Yes | Untested (expected compatible) |
| Top Capsule Daemon (`top-capsule.mjs`) | Yes | Yes | Not officially supported in v1.0 |
| Auto-start Scripts (`install-top-capsule.*`) | Yes (`launchd`) | Yes (Scheduled Task) | — |

---

## Privacy & Disclaimers

- **100% Local Execution**: All metrics, history aggregation, and preferences are computed and stored locally (`~/.gemini/antigravity/sidecar_data/context-monitor/`). No conversation content, usage logs, or account data ever leave your machine.
- **Reference Cost Disclaimer**: Estimated currency amounts are calculated from built-in public reference API rate tables and static exchange rates for relative comparison only. Actual billing depends on your provider plan and official invoices.

---

## Development & Testing

```bash
# Run all unit tests (Node >= 22)
npm test

# Validate Antigravity plugin manifest
agy plugin validate . --strict
```

---

## License

[MIT](./LICENSE) © 2026 llaolaol
