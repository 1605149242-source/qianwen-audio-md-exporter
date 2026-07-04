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

## `src/qianwen/client.js`

Browser and Qianwen/Tingwu automation logic.

## `src/utils/args.js`

Small CLI argument parser and prompt helpers.

## `src/utils/files.js`

Local file scanning, filename matching, and download filename handling.

## `tests/smoke.js`

Minimal project smoke check for structure and core utility behavior.

## `examples/`

Reserved for example configs and sample outputs.
