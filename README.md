# Qianwen Audio Markdown Exporter

Local CLI automation for uploading audio files to Qianwen/Tingwu and exporting original transcripts as Markdown.

## Problem

Qianwen/Tingwu can transcribe uploaded audio and export original text, but doing this for large folders is repetitive: upload in batches, wait for transcription, retry missing files, select Markdown export, and save each transcript locally.

## Core Features

- Select a local audio upload folder.
- Select a local Markdown download folder.
- Provide a Qianwen/Tingwu target folder URL.
- Reuse a local browser profile for login state.
- Upload audio in batches with the "audio/video quick read" and "multi-person discussion" options.
- Poll Qianwen records until source files are transcribed.
- Retry files that never appear in the target folder.
- Export completed records as original text Markdown with speaker and timestamp enabled.
- Download each record as an individual `.md` file.

## Current Scope

This first GitHub version contains the audio transcription/export workflow only.
The experimental AI summary add-on is kept local for now and is not included in this upload.

## Current Demo Capability

The MVP is a local CLI plus a local browser console. It supports one upload/transcription platform only: Qianwen/Tingwu.

It does not create a public web app, account system, database, or cross-platform automation.

## Install

```bash
npm.cmd install
```

PowerShell may block `npm.ps1` on Windows. Use `npm.cmd` when needed.

## Run

```bash
npm.cmd start -- ^
  --upload-dir "D:\Desktop\微信电话录音\2026-05\2026-05-10~05-20" ^
  --download-dir "D:\Desktop\微信电话转文字\2026-05-10~05-20" ^
  --folder-url "https://www.qianwen.com/creations/folders/2050003524008270053"
```

If any required option is omitted, the CLI asks for it interactively.

## Run As EXE

Build the Windows executable:

```bash
npm.cmd run build:exe
```

Then run:

```bat
dist\qianwen-audio-md-exporter.exe ^
  --upload-dir "D:\Desktop\微信电话录音\2026-05\2026-05-10~05-20" ^
  --download-dir "D:\Desktop\微信电话转文字\2026-05-10~05-20" ^
  --folder-url "https://www.qianwen.com/creations/folders/2050003524008270053"
```

See [docs/WINDOWS_EXE.md](docs/WINDOWS_EXE.md) for details.

## Configuration

Optional environment variables are shown in `.env.example`.

Do not commit real cookies, tokens, account passwords, or browser profile files.

## Project Structure

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md).

## Security And Privacy

This tool automates a logged-in browser session and processes user audio/transcript data locally. It does not ask for account passwords and does not write cookies or tokens into source files.

Browser profile directories, logs, `.env`, and retry state files are ignored by Git. Do not commit real call transcripts, generated Markdown files, API keys, cookies, or tokens.

## Known Limitations

- First version supports only Qianwen/Tingwu.
- It relies on the current Qianwen web UI and internal web requests, so future UI/API changes may require updates.
- The user must log in manually in the automated browser profile when prompted.
- The CLI is intentionally local-only.

## Roadmap

- Add richer retry reports.
- Add resumable export manifests.
- Add screenshots and a packaged executable.

## License

Private project for now. Add a license before public release.
