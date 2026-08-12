import {describe, expect, test} from "vitest";
import type {Entry, PiwStateV1} from "../src/domain.js";
import {resolveProfiles} from "../src/profiles/resolve.js";
import {compilePiArgs} from "../src/launcher/launcher.js";

const entry = (id: string, kind: Entry["kind"], status: Entry["status"] = "valid"): Entry => ({id, kind, status, registryPath: `/r/${id}`, realPath: `/real/${id}`, diagnostics: []});

test("keeps broken and empty profiles visible", () => {
  const state: PiwStateV1 = {version: 1, profiles: {empty: {entries: []}, broken: {entries: ["missing"]}}};
  expect(resolveProfiles(state, []).map(({name, available}) => ({name, available}))).toEqual([
    {name: "broken", available: false}, {name: "empty", available: true},
  ]);
});

describe("compilePiArgs", () => {
  test("isolates discovery and maps every Entry kind", () => {
    expect(compilePiArgs([
      entry("z", "package"), entry("a", "extension"), entry("b", "skill"), entry("c", "prompt"), entry("d", "theme"),
    ], ["--offline"])).toEqual([
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
      "-e", "/real/a", "--skill", "/real/b", "--prompt-template", "/real/c", "--theme", "/real/d", "-e", "/real/z", "--offline",
    ]);
  });
});
