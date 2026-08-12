# piw

A lightweight, filesystem-native profile launcher for [Pi](https://pi.dev/).

PIW owns one file: `~/.pi/piw/piw.json`. Everything else below `~/.pi/piw/` is user-managed. Every non-hidden top-level directory is an Entry, and a profile is simply a set of Entry IDs.

```text
~/.pi/piw/
├── piw.json
├── worktree/                 # extension Entry
│   └── index.ts
├── superpowers/              # skill Entry
│   ├── SKILL.md
│   └── references/
├── review/                   # prompt-template Entry
│   └── review.md
├── tokyo-night/              # theme Entry
│   └── tokyo-night.json
└── frontend-kit/             # Pi package Entry
    ├── package.json
    ├── extensions/
    └── skills/
```

There is no `entries/` layer and no kind-based registry hierarchy. PIW never copies, installs, moves, or deletes Entry content. Use the filesystem, Git, and npm directly to manage it.

## Requirements

- Node.js 22.19.0 or newer
- Pi 0.84.1 or newer
- macOS or Linux

## Install

The final package identity is selected at release time according to `docs/release.md`:

```bash
npm install -g piw
# fallback when the unscoped package is unavailable:
npm install -g @scpz24/piw
```

## Profiles

Create `~/.pi/piw/piw.json` directly or use `piw config`:

```json
{
  "version": 1,
  "profiles": {
    "builder": {
      "entries": [
        "worktree",
        "superpowers",
        "review"
      ]
    }
  }
}
```

PIW recognizes five canonical directory forms:

| Entry | Required root shape | Pi launch argument |
|---|---|---|
| Extension | `index.ts` or `index.js` | `-e <entry>/index.ts\|index.js` |
| Skill | `SKILL.md` | `--skill <entry>` |
| Prompt template | `<entry-id>.md` | `--prompt-template <entry>/<id>.md` |
| Theme | `<entry-id>.json` | `--theme <entry>/<id>.json` |
| Pi package | `package.json#pi` or a convention directory | `-e <entry>` |

Package internals remain opaque to PIW. Pi applies package rules and remains the final authority on every resource's complete semantics.

## Commands

```text
piw                              select a profile interactively
piw builder                      launch a profile directly
piw builder -- --model x/y       pass non-resource arguments to Pi
piw config                       configure profiles
piw list                         inspect Entries and profiles
piw doctor                       run read-only diagnostics
piw update                       run Entry-local Git/npm update phases
```

For a profile run PIW first supplies:

```text
--no-extensions
--no-skills
--no-prompt-templates
--no-themes
```

It then explicitly loads the selected Entries and replaces itself with Pi using `process.execve()`. Resource flags after `--` are rejected, so the profile remains the sole authority over the runtime resource set. Model, provider, session, tool, trust, message, and other non-resource arguments remain pass-through.

`piw update` is intentionally simple. An Entry that is itself a safe Git worktree root may receive `git pull --ff-only`; an Entry with a root `package.json` may receive `npm update`. A Git+npm Entry runs Git first and runs npm only after Git completes safely. PIW stores no updater metadata and PIW itself is updated with npm, not `piw update`.

## Security

PIW performs minimal structural availability checks, not sandboxing or trust verification. Extensions execute with your permissions, skills can direct an agent to act, and Git/npm updates can run manager-defined behavior. Review every Entry before launching or updating it.

The complete v0.1 behavior contract is in [docs/RPD.md](docs/RPD.md); release policy is in [docs/release.md](docs/release.md).
