# Product Requirements Document

## Background

Large batches of WeChat call recordings need to be uploaded to Qianwen/Tingwu, transcribed, exported as original text Markdown, and saved locally. Manual operation is slow and error-prone.

## Goal

Build a local CLI automation tool that lets the user choose an upload folder, a download folder, and a Qianwen/Tingwu target folder, then completes upload, monitoring, retry, export, and local Markdown saving.

## Target User

The primary user is a local Windows user who already has Qianwen/Tingwu access and wants to batch-process personal audio files.

## User Scenario

The user has a folder of `.aac` recordings and wants each completed transcript saved as a separate `.md` file in a target folder.

## Input

- Local upload folder containing audio files.
- Local download folder for Markdown files.
- Qianwen/Tingwu folder URL.
- Optional browser profile path and polling settings.

## Output

- One Markdown transcript per completed record.
- A console progress report.
- A local state file for retry bookkeeping.

## Core Features

- Browser profile login reuse.
- Batch upload.
- Record status polling.
- Missing file detection by source filename.
- Retry of missing uploads.
- Markdown export with speaker and timestamp options.
- Signed URL download to local disk.

## User Flow

1. Run CLI.
2. Provide upload folder, download folder, and Qianwen folder URL.
3. Log in in the browser if needed.
4. Tool uploads missing audio files.
5. Tool waits until all source files are completed.
6. Tool exports completed records to Markdown.
7. Tool prints final counts.

## MVP Scope

- Windows local CLI.
- Qianwen/Tingwu only.
- Audio files: `.aac`, `.mp3`, `.m4a`, `.wav`, `.mp4`.
- Batch upload limit defaults to 50.
- Export chunk limit defaults to 12.

## Non-goals

- No public SaaS.
- No multi-user account system.
- No database.
- No cross-platform provider support.
- No GUI in first version.

## Future Expansion

- GUI folder picker.
- Packaged desktop app.
- Better failed-job dashboard.
- Multi-folder queue.

## Success Criteria

- User can run one command and process a folder end to end.
- The tool avoids re-uploading records already present in the target folder.
- The tool saves Markdown files locally with expected filenames.
- The tool never stores real credentials in the repository.
