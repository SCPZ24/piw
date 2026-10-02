# piw

English | [中文](README_CN.md)

An ultra-lightweight [Pi](https://pi.dev/) profile launcher, distributed as a standalone npm CLI—not a Pi extension.

Pi discovers local resources, configured packages, and built-in extensions. piw disables automatic resource discovery and explicitly loads the resources selected by a profile.

piw lets you group Pi plugins with different capabilities into separate Pi profiles. Each profile is a preset combination of Pi runtime features.

## Installation

```bash
npm install -g @scpz24/piw
```

Requirements:

- Node.js ≥ 22.19.0
- Pi ≥ 1.0.0
- macOS / Linux

## Usage

### Launch

```bash
piw
```

Select a profile to launch Pi with the corresponding configuration.

Alternatively, launch a profile directly:

```bash
piw <profile>
```

### Add an Entry

Pi supports five types of runtime components:

- Extensions
- Themes
- Prompt templates
- Skills
- Packages (bundles containing the four component types above)

piw treats each component as an Entry. Local Entries are directories or directory symlinks under `~/.pi/piw`; built-in Entries need no filesystem artifacts.

How to add Entries:

For extensions, themes, prompt templates, and skills, **place each resource in its own directory under `~/.pi/piw`**, as shown below.

For packages, piw does not place npm packages directly in this directory. Instead, it uses `pi install` to install the package in Pi's package directory, then creates an **Entry as a symbolic link** to it.

To add a package:

```bash
piw add <package_name>
```

piw first checks whether Pi has already installed the package. If not, it installs the package before automatically creating the symbolic link.

Example `piw/` directory structure:

```text
~/.pi/piw/
├── piw.json
├── worktree/
│   └── index.ts
├── superpowers/
│   └── SKILL.md
├── review/
│   └── review.md
├── tokyo-night/
│   └── tokyo-night.json
└── [symlink] pi-web-access
```

`piw.json` is the only state file maintained by piw. It records which Entries belong to each profile.

### Configuration

Run:

```bash
piw config
```

to open the profile control panel.
You can add or remove profiles here.

Select and press `Enter` to go into a profile's detail panel, where you can select which features the profile should include.


### Pi built-in extensions

The same configuration list includes `builtin:mcp`, `builtin:codemode`, `builtin:tool-search`, and `builtin:llama.cpp`, labelled **Pi built-in**. New profiles select none. Selecting one only loads that extension; it does not select companions or activate tools. Empty profiles load no managed resources.

Pi controls tool activation, MCP configuration, credentials, and model behavior. For example, after selecting `builtin:codemode` in a `research` profile:

```bash
piw research -- --tools read,bash,edit,write,codemode
```

`--tools` replaces Pi's entire tool selection. `--exclude-tools` also passes through unchanged. Resource options such as `-e` cannot bypass the profile; select built-ins in `piw config` instead. `piw list` shows their literal IDs, `piw doctor` labels them as built-ins, and `piw update` excludes them. Update Pi itself to update its built-ins.

### State compatibility

PIW 2.0 requires Pi ≥ 1.0.0. It reads existing v1 `piw.json` files without changing their bytes or profile membership. New state and explicit configuration saves use v2, which adds `builtin:` references while still storing only Entry IDs. Launching, listing, diagnosing, updating Entries, or cancelling configuration does not rewrite v1 state.

Older PIW releases reject v2 state. Before saving with PIW 2.0, keep a copy of your v1 state if you need to downgrade. Unknown built-in references remain visible and removable in configuration and prevent only the affected profile from launching.
