# Technical Architecture

## Overall Architecture

The project is a local Node.js CLI that combines browser automation and same-session web requests.

```text
CLI input
  -> local file scanner
  -> Playwright browser session
  -> Qianwen/Tingwu upload UI
  -> Qianwen record API polling
  -> export task API
  -> signed URL downloader
  -> local Markdown files
```

## Modules

- `src/cli.js`: Parses CLI options, prompts for missing values, orchestrates the workflow.
- `src/qianwen/client.js`: Owns browser launch, Qianwen navigation, upload, polling, export, and download.
- `src/utils/files.js`: File scanning, title normalization, filename parsing, and safe local writes.
- `src/utils/args.js`: Lightweight argument parsing and interactive prompts.

## Technology Stack

- Node.js ESM.
- `playwright-core` for browser automation.
- Native `fetch`, `fs`, `path`, and `readline`.

## Data Flow

1. Local audio files are scanned and mapped by filename without extension.
2. Qianwen record list is queried from the logged-in browser context.
3. Missing local titles are uploaded through the web UI.
4. Completed records are exported through the Qianwen export task request.
5. Returned signed URLs are downloaded to the target folder.

## Input And Output Format

Input:

- Local audio files.
- Qianwen folder URL.

Output:

- Markdown transcript files named by Qianwen export metadata.
- Console progress logs.

## Interface Design

CLI options:

- `--upload-dir`
- `--download-dir`
- `--folder-url`
- `--profile-dir`
- `--chrome-path`
- `--batch-size`
- `--export-batch-size`
- `--poll-interval`
- `--max-retries`
- `--retry-cooldown-minutes`
- `--use-system-chrome-profile`
- `--chrome-profile-name`
- `--dry-run`

## File Storage

Markdown is written to the selected download folder. Browser login state is stored in a local profile folder, ignored by Git.

## Database

No database is required for the MVP.

## API

No official public API is assumed. The tool uses web requests available inside the logged-in browser session.

## Login And Authorization

The user logs in manually in the automated browser when needed. The tool does not collect passwords.

Two browser profile modes are supported:

- Dedicated local profile: safer for automation and can stay separate from normal Chrome.
- System Chrome profile: reuses the user's normal Chrome login state, but requires normal Chrome windows to be closed before launch.

## Code Responsibilities

Code handles upload, polling, retry, export, and download logic. AI is not used inside this MVP.

## Error Handling

- Missing folders fail fast.
- Login failure asks the user to log in manually.
- Upload retries are capped and protected by a cooldown so the same file is not re-uploaded repeatedly while Qianwen is still processing.
- Export polling has a timeout.
- Download errors are reported with the affected record.

## Expansion Points

- GUI wrapper around CLI options.
- Multi-folder job queue.
- Export manifest and resume mode.
