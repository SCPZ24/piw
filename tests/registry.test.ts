import {mkdir, mkdtemp, realpath, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {discoverEntries} from "../src/registry/discovery.js";

describe("entry discovery", () => {
  test("classifies loose resources and directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-registry-"));
    await writeFile(path.join(root, "review.md"), "# Review\n");
    await writeFile(path.join(root, "browser.ts"), "export {};\n");
    await mkdir(path.join(root, "skill"));
    await writeFile(path.join(root, "skill", "SKILL.md"), "---\nname: skill\ndescription: useful\n---\n# Skill\n");
    const entries = await discoverEntries(root);
    expect(entries.map(({id, kind, status}) => ({id, kind, status}))).toEqual([
      {id: "browser", kind: "extension", status: "valid"},
      {id: "review", kind: "prompt", status: "valid"},
      {id: "skill", kind: "skill", status: "valid"},
    ]);
  });

  test("invalidates every case-insensitive collision", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-collision-"));
    await writeFile(path.join(root, "browser.ts"), "");
    await writeFile(path.join(root, "Browser.js"), "");
    const entries = await discoverEntries(root);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === "invalid")).toBe(true);
  });

  test("uses a symlink registry name and resolved target", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "piw-link-"));
    const root = path.join(base, "entries");
    const target = path.join(base, "outside");
    await mkdir(root);
    await mkdir(target);
    await writeFile(path.join(target, "index.js"), "");
    await symlink(target, path.join(root, "linked"));
    const [entry] = await discoverEntries(root);
    expect(entry).toMatchObject({id: "linked", kind: "extension", realPath: await realpath(target), status: "valid"});
  });

  test("rejects a theme missing Pi 0.84.1 required tokens", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-theme-"));
    await writeFile(path.join(root, "thin.json"), JSON.stringify({name: "thin", colors: {accent: "#ffffff"}}));
    const [entry] = await discoverEntries(root);
    expect(entry).toMatchObject({id: "thin", kind: "theme", status: "invalid"});
    expect(entry?.diagnostics[0]?.message).toContain("Missing required color tokens");
  });
});
