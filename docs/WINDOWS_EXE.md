# Windows EXE Usage

## Build

Install dependencies first:

```bat
npm.cmd install
```

Build the executable:

```bat
npm.cmd run build:exe
```

The output file is:

```text
dist\qianwen-audio-md-exporter.exe
```

This project currently includes Playwright's `browsers.json` as a packaged asset because the executable needs it at startup.

## Run

```bat
dist\qianwen-audio-md-exporter.exe ^
  --upload-dir "D:\Desktop\微信电话录音\2026-05\2026-05-10~05-20" ^
  --download-dir "D:\Desktop\微信电话转文字\2026-05-10~05-20" ^
  --folder-url "https://www.qianwen.com/creations/folders/2050003524008270053"
```

If you omit an option, the program will ask for it interactively.

## First Login

The program opens Chrome and reuses a local browser profile. If Qianwen/Tingwu is not logged in yet:

1. Log in manually in the opened Chrome window.
2. Keep the browser window open.
3. The program checks the page quietly and continues automatically after login is detected.

The program does not ask for your password and does not store credentials in the project files.

## Notes

- Chrome must be installed locally.
- The EXE calls your local Chrome; it does not bundle Chrome.
- If Chrome is installed in a non-default location, pass `--chrome-path`.
- The browser profile defaults to `.browser-profile` beside the running directory.
- Use `--dry-run` to verify paths without opening Chrome or uploading files.
- During login, the program does not refresh the page repeatedly; it waits for you to finish logging in.
- To reuse your normal logged-in Chrome profile, run with `--use-system-chrome-profile --chrome-profile-name Default` after closing all normal Chrome windows.
- The project includes `run-2026-06-01-06-02-system-chrome.bat` for system Chrome profile mode.
