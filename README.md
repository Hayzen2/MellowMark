# MellowMark v3.2 — LaTeX + Markdown workspace

A local-first **Vue 3 + Tailwind CSS 4 + Electron** desktop Markdown and LaTeX editor. Windows releases bundle Tectonic and download LaTeX support files only when a document needs them.

## What's new in v3.2

- **New file / New folder buttons now open a real Vue dialog.** The v3 UI used `window.prompt()`; Electron's renderer does not implement it reliably. You can create `main.tex`, `references.bib`, `chapters/part.tex`, and folders and see useful validation errors directly in the popup.
- **Smaller Windows installer.** It contains the Tectonic executable but no multi-gigabyte TeX archive. Tectonic downloads missing support files as needed and reuses them from a persistent local cache.
- **LaTeX resource settings.** View or open the cache folder, clear cached packages, and enable offline-only compilation.
- **Sharper PDF preview with source navigation.** Rendering uses the display's pixel ratio, and clicking compiled text jumps to its source line.
- **Build-time compiler verification.** `npm run package:win` prepares the pinned executable and refuses to build an incomplete Windows installer.
- **Prettier:** Repository-wide configuration, `npm run format`, `npm run format:check`, opt-in Git pre-commit enforcement, plus a **Prettier** toolbar button for Markdown documents (`Ctrl+Shift+F`). LaTeX formatting is not provided by Prettier: formatting `.tex` macros automatically would need a separate TeX-aware formatter.
- Existing project explorer, multi-file compilation, PDF export, resizable split layout, multiple tabs, detached windows, pink themes, and auto-update support remain.

## Requirements to develop

- Node.js 22+ and npm
- Windows 10/11 x64 to build the **Windows installer**
- Internet on the **build machine** to download the pinned Tectonic executable. End users need internet the first time a document requires uncached TeX resources.

## Run the app in development

```bash
npm install
npm run dev
```

On Windows x64, `npm run dev` automatically prepares the small Tectonic executable if needed, so you do not need to install a separate LaTeX distribution. If the download fails, Markdown-only development can still launch; rerun `npm run prepare:tex:win` when connected. Other operating systems may use a system-installed compiler. The **packaged Windows app** uses its bundled Tectonic executable.

## Make the Windows installer

From a Windows PowerShell terminal:

```powershell
npm install
npm run package:win
```

This pipeline performs:

1. `prepare:tex:win` — download the official Windows x64 Tectonic 0.17.0 zip and **check its pinned SHA-256**, then extract `tectonic.exe`.
2. `verify:tex:win` — check the executable against its recorded SHA-256 and fail if it is missing or modified.
3. Build the Vite app.
4. Build a Windows NSIS installer with `electron-builder`, including the files via `extraResources`.

The resulting installer is under `release/`. It contains an uninstaller, the MellowMark icon, app files, Tectonic and its verification manifest. No MiKTeX or TeX Live setup is needed on the **end user's** machine.

**Important:** The **source ZIP** intentionally does **not** include the Tectonic Windows binary. It is fetched on the build machine. Build with an Internet connection.

### Using a pre-prepared compiler

Place the official Tectonic 0.17.0 Windows x64 `tectonic.exe` at `vendor/tectonic/win32-x64/tectonic.exe` before packaging. The installer does not need or include a TeX bundle.

## How compilation works

The Windows app invokes Tectonic locally and lets it fetch missing support files from its default bundle service:

```text
tectonic.exe -X compile --untrusted --keep-logs --outdir "<temp output>" main.tex
```

When you click **Compile PDF**, MellowMark copies project files to a temporary directory, overlays unsaved edits from open tabs, sets `TECTONIC_CACHE_DIR` to the app's persistent user-data cache, and runs Tectonic with SyncTeX enabled. Missing support files download on first use; subsequent compilations can reuse them offline. Turn on **Settings → LaTeX resources → Offline-only** to prohibit downloads, or clear the cache there. The PDF preview renders at the display's device-pixel ratio; click rendered text to open and select its source line. **Export PDF** uses the same local compiler. Compilation errors include Tectonic's log so missing packages or source errors can be diagnosed. TeX itself is not a hardened sandbox—compile only documents you trust.

## Files and tabs

Open a `.tex` project folder with **Open folder**. Use the project panel **New file** button (now with a real dialog) to add files, **New folder** to add subdirectories, **Import** to attach images, `.bib`, `.sty`, etc., and **… → Set as main** to choose the compilation root. Use **New Markdown / LaTeX tabs** in the tab bar. **Pop out split** opens a new window with both source and preview, and detached edits synchronize across windows. Markdown can be previewed immediately; LaTeX must be compiled to create its preview. Existing files stay on disk.

## Prettier

```bash
npm run format          # Format supported source code and config files
npm run format:check    # Check without changing files
npm run hooks:enable    # After git init; block commits until formatting passes
```

The optional `.githooks/pre-commit` uses `npm run format:check`. If you're using a fresh ZIP folder, run `git init`, `npm install`, `npm run format` and `npm run hooks:enable` before your first commit. The formatting check is intended to run on a Prettier-formatted working tree.

In the Markdown editor, use **Prettier** from the formatting toolbar or **Ctrl+Shift+F** to format the current Markdown document. It does not automatically overwrite your source; edits remain subject to Save. LaTeX editing is preserved as typed to avoid unsafe rewriting of macros or TeX layout instructions.

## Updates and uninstall

As in v3, the NSIS installer registers an uninstaller, and **Settings → Uninstall** can invoke it from an installed Windows release. Reinstalling a newer compatible version using the same `appId` upgrades the previous version in place. Automatic in-app updates require the distributor to configure `MELLOWMARK_UPDATE_URL` at package time and publish `latest.yml`, setup EXE and blockmap artifacts on HTTPS. No update endpoint is included in this source project.

## Checks

```bash
npm run test:unit  # Project file safeguards and compiler asset detection
npm run check      # JavaScript static checks + unit tests + Vite build
npm run verify:tex:win  # Verify bundled compiler before packaging
```

## Directory layout

```text
build/                           installer/app icons
electron/main.cjs                Electron windows, IPC, packaging behavior
electron/offline-tex.cjs         bundled compiler discovery + verification
electron/projects.cjs            project management + LaTeX compilation
electron/preload.cjs             isolated renderer bridge
scripts/prepare-offline-tex.mjs  prepare the Windows Tectonic executable
scripts/verify-offline-tex.cjs   verify the compiler before packaging
src/App.vue                      tabs, file creation popup, Tailwind UI
src/markdown-format.js           lazy-loaded Markdown Prettier command
src/components/PdfPreview.vue   compiled PDF viewer
src/render.js                    Markdown and KaTeX math rendering
src/style.css                    Tailwind entry/theme and rich output styles
tests/                           Node built-in unit tests
vendor/tectonic/win32-x64/       .exe (not checked into source)
```

## Licensing

MellowMark application code: MIT. Tectonic's source license is MIT. TeX support files are fetched from Tectonic's bundle service at runtime and retain their respective licenses; MellowMark does not redistribute the full support archive.
