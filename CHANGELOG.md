# Changelog

All notable changes to this project will be documented in this file.

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
