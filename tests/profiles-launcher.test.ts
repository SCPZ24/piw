import {describe, expect, test, vi} from "vitest";
import type {EntryKind, PiwStateV2, ValidEntry} from "../src/domain.js";
import {resolveProfiles} from "../src/profiles/resolve.js";
import {compilePiArgs, MINIMUM_PI_VERSION} from "../src/launcher/launcher.js";
import {printList} from "../src/app.js";
import {getBuiltinEntries} from "../src/registry/builtins.js";

const entry = (id: string, kind: EntryKind, launchPath: string): ValidEntry => ({source: "filesystem", id, kind, launchPath, status: "valid", registryPath: `/r/${id}`, realPath: `/real/${id}`, diagnostics: []});

test("keeps broken and empty profiles visible", () => {
  const state: PiwStateV2 = {version: 2, profiles: {empty: {entries: []}, broken: {entries: ["missing"]}}};
  expect(resolveProfiles(state, []).map(({name, available}) => ({name, available}))).toEqual([
    {name: "broken", available: false}, {name: "empty", available: true},
  ]);
});

test("uses Pi 1.0.0 as the release baseline", () => {
  expect(MINIMUM_PI_VERSION).toBe("1.0.0");
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
    state: {version: 2, profiles: {}}, fingerprint: "x", registryDiagnostics: [], profiles: [],
    entries: [{source: "filesystem", id: "bad", registryPath: "/home/.pi/piw/bad", realPath: "/home/.pi/piw/bad", status: "invalid", diagnostics: []}],
  });
  expect(output).toHaveBeenCalledWith("bad\tunclassified\tinvalid\t/home/.pi/piw/bad");
  output.mockRestore();
});

test("launch compilation keeps a discovered package symlink's resolved root", () => {
  expect(compilePiArgs([
    {source: "filesystem", id: "pi-worktree", kind: "package", registryPath: "/home/.pi/piw/pi-worktree", realPath: "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree", launchPath: "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree", status: "valid", diagnostics: []},
  ], [])).toEqual([
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", "/home/.pi/agent/npm/node_modules/@narumitw/pi-worktree",
  ]);
});

test("resolves builtins and mixed resources without adding companions or activating tools", () => {
  const profiles = resolveProfiles({version: 2, profiles: {
    mcp: {entries: ["builtin:mcp"]}, empty: {entries: []}, unknown: {entries: ["builtin:future"]},
    mixed: {entries: ["z10", "builtin:tool-search", "z2", "builtin:codemode"]},
  }}, [...getBuiltinEntries(), entry("z10", "extension", "/z10"), entry("z2", "extension", "/z2")]);
  const args = (name: string) => compilePiArgs(profiles.find((p) => p.name === name)!.entries, []);
  const isolation = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"];
  expect(args("mcp")).toEqual([...isolation, "-e", "builtin:mcp"]);
  expect(args("empty")).toEqual(isolation);
  expect(args("mixed")).toEqual([...isolation, "-e", "builtin:codemode", "-e", "builtin:tool-search", "-e", "/z2", "-e", "/z10"]);
  expect(profiles.filter((p) => !p.available).map((p) => p.name)).toEqual(["unknown"]);
  expect(profiles.find((p) => p.name === "unknown")?.diagnostics[0]?.code).toBe("missing-reference");
  for (const builtin of getBuiltinEntries()) expect(compilePiArgs([builtin], [])).toEqual([...isolation, "-e", builtin.id]);
});

test("list displays builtin specifiers rather than filesystem locations", () => {
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    printList({paths: {piwHome: "/unused", stateFile: "/unused/piw.json"}, state: {version: 2, profiles: {}}, fingerprint: "x", registryDiagnostics: [], profiles: [], entries: getBuiltinEntries()});
    expect(output).toHaveBeenCalledWith("builtin:mcp\textension\tvalid\tbuiltin:mcp");
  } finally { output.mockRestore(); }
});
