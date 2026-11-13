# Windows x64 Tectonic compiler

The *published Windows installer* contains `tectonic.exe`, `manifest.json` and
notices in its `resources/tex/` directory. LaTeX support files are downloaded
by Tectonic as needed and cached in the user's MellowMark data directory.

Run `npm run prepare:tex:win` on a connected Windows build machine to fetch
Tectonic 0.17.0 (pinned archive checksum), then `npm run package:win`. The
packaging command fails if the compiler is missing or invalid. End users do
not need TeX Live or MiKTeX.

For offline builds, place the official `tectonic.exe` in this folder and
provide a verified copy of the binary before running the build.

This directory's binary files are excluded from source ZIP and git.
