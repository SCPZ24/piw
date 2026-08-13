import {describe, expect, test, vi} from "vitest";
import type {EntryKind, PiwStateV1, ValidEntry} from "../src/domain.js";
import {resolveProfiles} from "../src/profiles/resolve.js";
import {compilePiArgs, MINIMUM_PI_VERSION} from "../src/launcher/launcher.js";
import {printList} from "../src/app.js";

const entry = (id: string, kind: EntryKind, launchPath: string): ValidEntry => ({id, kind, launchPath, status: "valid", registryPath: `/r/${id}`, realPath: `/real/${id}`, diagnostics: []});

test("keeps broken and empty profiles visible", () => {
  const state: PiwStateV1 = {version: 1, profiles: {empty: {entries: []}, broken: {entries: ["missing"]}}};
  expect(resolveProfiles(state, []).map(({name, available}) => ({name, available}))).toEqual([
    {name: "broken", available: false}, {name: "empty", available: true},
  ]);
});

test("uses Pi 0.83.0 as the release baseline", () => {
  expect(MINIMUM_PI_VERSION).toBe("0.83.0");
});

describe("compilePiArgs", () => {
  test("isolates discovery and maps every Entry kind", () => {
    expect(compilePiArgs([
      entry("z", "package", "/real/z"),
      entry("a", "extension", "/real/a/index.ts"),
      entry("b", "skill", "/real/b"),
      entry("c", "prompt", "/real/c/c.md"),
      entry("d", "theme", "/real/d/d.json"),
    ], ["--offline"])).toEqual([
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", "/real/a/index.ts", "--skill", "/real/b", "--prompt-template", "/real/c/c.md", "--theme", "/real/d/d.json", "-e", "/real/z", "--offline",
    ]);
  });
});

test("list labels an invalid Entry without a classified kind", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  printList({
    paths: {piwHome: "/home/.pi/piw", stateFile: "/home/.pi/piw/piw.json"},
    state: {version: 1, profiles: {}}, fingerprint: "x", registryDiagnostics: [], profiles: [],
    entries: [{id: "bad", registryPath: "/home/.pi/piw/bad", realPath: "/home/.pi/piw/bad", status: "invalid", diagnostics: []}],
  });
  expect(output).toHaveBeenCalledWith("bad\tunclassified\tinvalid\t/home/.pi/piw/bad");
  output.mockRestore();
});

test("launch compilation keeps a discovered package symlink's resolved root", () => {
  expect(compilePiArgs([
    {id: "pi-worktree", kind: "package", registryPath: "/home/.pi/piw/pi-worktree", realPath: "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree", launchPath: "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree", status: "valid", diagnostics: []},
  ], [])).toEqual([
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree",
  ]);
});
