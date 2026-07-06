# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

- Initial project documentation.
- CLI MVP plan for Qianwen/Tingwu audio upload and Markdown export.
- CLI entry point with interactive prompts and option parsing.
- Qianwen/Tingwu browser automation client.
- Local file scanner, retry state support, and Markdown export downloader.
- Smoke check for project structure and core utility behavior.
- Windows executable build script and usage guide.
- Local browser console for the audio transcription/export workflow.
- Visible one-click Windows launcher for non-technical users.

### Changed

- GitHub upload scope now includes the transcription web console while keeping the experimental AI summary add-on local-only.

### Deprecated

- Nothing yet.

### Removed

- Nothing yet.

### Fixed

- Count failed upload submissions toward the retry limit, and retry stale in-progress records after the cooldown instead of leaving them active forever.

### Security

- Added `.env.example` and ignored local browser profile paths.
- Ignored local logs, browser profiles, generated outputs, cookies, tokens, and local state so they are not committed by accident.
