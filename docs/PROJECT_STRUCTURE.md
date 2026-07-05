# Project Structure

## `README.md`

Project overview, install instructions, usage examples, limitations, and security notes.

## `docs/PRD.md`

Product definition: target user, user flow, MVP scope, non-goals, and success criteria.

## `docs/TECH_ARCHITECTURE.md`

Implementation design: modules, data flow, browser automation, export requests, storage, and error handling.

## `docs/PROJECT_STRUCTURE.md`

Explains the purpose of project directories and key files.

## `docs/DEV_LOG.md`

Records development decisions and changes after each work stage.

## `docs/WINDOWS_EXE.md`

Explains how to build and run the Windows executable.

## `CHANGELOG.md`

User-facing change history.

## `src/cli.js`

CLI entry point. Parses options, prompts for missing paths, validates inputs, and calls the Qianwen automation client.

## `src/web.js`

Local browser console for the audio transcription/export workflow. It exposes the form, progress dashboard, and local HTTP API for starting, stopping, previewing, and monitoring transcription jobs.

## `src/qianwen/client.js`

Browser and Qianwen/Tingwu automation logic.

## `src/utils/args.js`

Small CLI argument parser and prompt helpers.

## `src/utils/files.js`

Local file scanning, filename matching, and download filename handling.

## `tests/smoke.js`

Minimal project smoke check for structure and core utility behavior.

## `open-web-ui.vbs`

Windows double-click launcher for the local browser console.

## `open-web-ui.bat`

Windows batch launcher used by `open-web-ui.vbs`.

## `start-web-ui.ps1`

PowerShell launcher for the local browser console.

## `examples/`

Reserved for example configs and sample outputs.
