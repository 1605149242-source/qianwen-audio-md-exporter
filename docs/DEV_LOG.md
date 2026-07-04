# Development Log

## 2026-06-02

### Completed

- Converted the manual Qianwen/Tingwu workflow into a project plan.
- Defined a local CLI MVP.
- Created core documentation required by the project protocol.
- Implemented the first CLI automation flow.
- Added browser login reuse, upload, record polling, export task polling, and Markdown download code.
- Added a smoke check for documentation and core utility behavior.
- Verified the CLI in dry-run mode against the current `2026-05-10~05-20` source folder; it detected 148 audio files and parsed the Qianwen folder id.
- Added a Windows EXE build script using `@yao-pkg/pkg`.
- Added Windows executable usage documentation.
- Built `dist/qianwen-audio-md-exporter.exe`.
- Fixed EXE packaging by explicitly including `node_modules/playwright-core/browsers.json`.
- Verified the EXE in dry-run mode against the current source folder; it detected 148 audio files and parsed the Qianwen folder id.
- Changed login waiting behavior so the program does not repeatedly refresh the browser while the user is logging in.
- Added a clearer error if the login browser window is closed before login completes.
- Added upload retry cooldown to prevent repeated uploads while Qianwen records are still appearing.
- Added system Chrome profile mode for users who want to reuse their normal logged-in Chrome account.
- Replaced the Chinese-path batch launcher with ASCII batch files that call JS launchers using Unicode escapes.
- Added automatic Qianwen folder creation/reuse based on the Markdown download folder basename.
- Added existing-record organization: source-matched records outside the target folder are moved into the target folder before upload.
- Added `--skip-upload` mode for safe organization without uploading new files.
- Added failed-record detection so the tool stops clearly instead of waiting forever when only failed records remain.
- Ran safe organization for `2026-06-01~06-02`: reused Qianwen folder `2050003524008270156`; found 14 matching records there, with 9 successful and 5 failed; 2 local files were still missing from the target folder.
- Improved retry behavior: failed and missing recordings are uploaded again with a maximum of 3 attempts under the new `uploadAttemptsV2` state field, ignoring old retry counts created by earlier buggy runs.
- Improved Markdown export behavior: successful records are exported only when their local non-empty `_原文.md` file is not already present.
- Ran the improved flow for `2026-06-01~06-02`: exported 11 Markdown files without duplicate export; submitted retry attempts for remaining missing/failed candidates; one retried file entered queued status.
- Changed long-running behavior: default retry limit is now 5, retry cooldown is 20 minutes, and polling interval is 20 minutes.
- Changed completion condition: the program exits only when every local recording has either a downloaded Markdown file or has reached the retry limit and is abandoned.
- Added final summary counts for successful downloads, failed abandoned tasks, active tasks, and total recordings.

### Why

The user wants a reusable automation program, not a one-off script. The project should be maintainable and safe to evolve into a GUI later.

### Modules Affected

- Project documentation.
- Initial package configuration.
- `src/cli.js`
- `src/qianwen/client.js`
- `src/utils/args.js`
- `src/utils/files.js`
- `tests/smoke.js`
- `docs/WINDOWS_EXE.md`
- `package.json`
- `scripts/run-2026-06-01-06-02.js`
- `scripts/run-2026-06-01-06-02-system-chrome.js`
- `scripts/organize-2026-06-01-06-02.js`

### PRD Mapping

- Supports MVP definition, user flow, security boundaries, and success criteria.

### Architecture Impact

- Establishes Node.js + Playwright as the initial implementation path.

### Open Issues

- Qianwen web UI/API may change.
- Long-running upload jobs need careful retry and progress handling.
- The EXE has been dry-run verified, but a real browser-backed upload/export run should still be tested on a small folder before heavy use.
- Browser profile reuse can conflict with already-running Chrome sessions; a dedicated profile per job is recommended for now.
- System Chrome profile mode requires all normal Chrome windows to be closed before launch.
- Direct control of the default system Chrome profile is blocked by current Chrome remote-debugging restrictions; dedicated profiles remain the stable path.

### Next Step

- Run a real browser-backed job on a small folder or resume the current second folder job.
- Add a GUI wrapper after the CLI flow is stable.
