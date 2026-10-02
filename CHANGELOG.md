# Changelog

## 2.0.0

- **Breaking:** require Pi >=1.0.0; retain standalone npm CLI distribution, not a Pi plugin or SDK integration.
- Select Pi built-in MCP, Codemode, tool-search, and llama.cpp extensions in profiles without installing filesystem Entries. Loading does not imply tool activation or companion selection; Pi retains control of runtime behavior.
- **Breaking:** new state and explicit configuration saves write schema v2. Existing v1 state loads without disk changes; launch, list, doctor, update, and cancelled configuration never migrate it. Older PIW releases reject v2; retain a v1 copy before saving if downgrade is needed.
- Show built-in sources in config/list/doctor and exclude them from Entry updates. Unknown built-in references remain removable and block only their profiles.
- Verify built-in loading and tool activation independently against Pi 1.0.0 and latest, while retaining all five local resource kinds.

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
