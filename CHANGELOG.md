# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-11-18

### Changed
- **Zero-config Top Capsule**: Embedded `sidecars/context-monitor/capsule.mjs` directly into the Sidecar (`main.mjs`) so the titlebar status capsule starts **automatically by default** upon plugin installation and enablement on both macOS and Windows — no manual LaunchAgent or Scheduled Task setup required.
- Added a `Capsule: On / Off` (`胶囊: 开 / 关`) toggle button in the side panel top bar, persisted in `prefs.json` (`topCapsule: true` by default).
- Removed obsolete `install-top-capsule.sh` / `install-top-capsule.ps1` installer scripts (kept `uninstall-top-capsule.*` for cleaning up legacy `v1.0.0` background daemons).
- Added sanitized UI screenshots to `README.md` and `README.zh-CN.md`.

## [1.0.0] - 2026-11-18

### Added
- Official Antigravity UI Sidecar (`Context & Tokens`) in the auxiliary pane:
  - Real-time context window usage, remaining budget, and health status (`normal` / `warn` / `critical`).
  - Streaming generation speed (`tok/s`), total generation duration, and TTFT (Time To First Token).
  - Account tier, Prompt/Flow credits, and per-model quota progress bars via local LanguageServer RPC.
  - Session content breakdown (Input, Cache Read, Output, Thinking/Response split, and archived character audit) plus recent 30-step timeline.
  - Global Desktop & CLI token analytics with daily 52-week heatmap, weekly/yearly bars, monthly calendar, cumulative curve, and API reference cost vs. subscription comparison.
- Bilingual UI (`zh-CN` default + `en` switch) with persistent preferences (`lang`, `currency`, `budgetPref`, `subscriptionPreset`, `referenceModel`, `heatmapTheme`). Default currency: `CNY`.
- Optional Titlebar Top Capsule (`top-capsule.mjs`) with macOS (`launchd`) and Windows (`ScheduledTask`) install/uninstall scripts.
- Automated `node --test` suite and GitHub Actions CI workflow.
