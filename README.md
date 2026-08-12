# piw

A lightweight profile registry and launcher for [Pi](https://pi.dev/).

PIW keeps resource profiles without creating another Pi Agent Home. Entries remain user-managed files under `~/.pi/piw/entries/`; PIW owns only `~/.pi/piw/piw.json`.

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

## Registry and profiles

```text
~/.pi/piw/
├── entries/
│   ├── browser.ts
│   ├── review.md
│   ├── superpowers -> /path/to/package
│   └── theme.json
└── piw.json
```

```json
{
  "version": 1,
  "profiles": {
    "builder": {
      "entries": ["browser", "review", "superpowers"]
    }
  }
}
```

Use `piw config` to edit profiles. PIW discovers loose extensions, skills, prompt templates, themes, and Pi packages. It never copies or installs Entry content.

## Commands

```text
piw                              select a profile interactively
piw builder                     launch a profile directly
piw builder -- --model x/y      pass non-resource arguments to Pi
piw config                      configure profiles
piw list                        inspect Entries and profiles
piw doctor                      run read-only diagnostics
piw update                      update conservatively proven Git/npm Entries
```

PIW disables Pi's automatic extension, skill, prompt-template, and theme discovery for a profile run, explicitly loads the selected Entries, then replaces itself with Pi using `process.execve()`. Resource flags after `--` are rejected so the profile remains authoritative.

`piw update` updates registered Entries only. Update PIW itself with npm.

## Security

PIW performs structural validation, not sandboxing or trust verification. Pi extensions execute with your permissions and skills may direct an agent to perform arbitrary actions. Review every registered resource before launching it.

The complete v0.1 behavior contract is in [docs/RPD.md](docs/RPD.md); release policy is in [docs/release.md](docs/release.md).
