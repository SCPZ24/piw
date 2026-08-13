# Changelog

## 1.0.1

- Add `piw add <npm-package>` to install missing Pi packages through Pi and expose them as symlink Entries.
- Treat every top-level symlink Entry as externally managed and skip its target during `piw update`.
- Report external ownership in `piw doctor` and extend isolated source/tarball smoke coverage.

## 1.0.0

- Flat filesystem-native Entry registry under `~/.pi/piw/`.
- Directory-only extension, skill, prompt, theme, and package Entries.
- Profile selector and profile configuration TUI.
- Explicit Pi resource isolation and process-replacing launch.
- Safe Git/npm Entry updater phases.
- Read-only doctor and list diagnostics.
- npm-only distribution.
