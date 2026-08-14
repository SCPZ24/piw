# piw

English | [中文](README_CN.md)

An ultra-lightweight [Pi](https://pi.dev/) profile manager.

Pi stores all plugins in `~/.pi/agent/extensions/` and `~/.pi/agent/npm`. When Pi is started with the default `pi` command, it loads every plugin, even if some of them are not needed for the current task.

piw lets you group Pi plugins with different capabilities into separate Pi profiles. Each profile is a preset combination of Pi runtime features.

## Installation

```bash
npm install -g @scpz24/piw
```

Requirements:

- Node.js ≥ 22.19.0
- Pi ≥ 0.83.0
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

piw treats every component as an Entry and stores it in `~/.pi/piw`.

How to add Entries:

For extensions, themes, prompt templates, and skills, **place them directly in `~/.pi/piw`**.

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
