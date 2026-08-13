import {mkdir, mkdtemp, realpath, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {discoverEntries} from "../src/registry/discovery.js";

async function registry(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "piw-registry-"));
}

async function entry(root: string, id: string): Promise<string> {
  const directory = path.join(root, id);
  await mkdir(directory);
  return directory;
}

describe("directory-only Entry discovery", () => {
  test("classifies every canonical loose Entry and records exact launch paths", async () => {
    const root = await registry();
    const browser = await entry(root, "browser");
    await writeFile(path.join(browser, "index.ts"), "export {};\n");
    await writeFile(path.join(browser, "package.json"), '{"dependencies":{"x":"1.0.0"}}\n');

    const superpowers = await entry(root, "superpowers");
    await writeFile(path.join(superpowers, "SKILL.md"), "---\nname: superpowers\ndescription: useful\nmetadata:\n  extra: accepted\n---\n# Skill\n");
    await mkdir(path.join(superpowers, "references"));

    const review = await entry(root, "review");
    await writeFile(path.join(review, "review.md"), "# Review\n");

    const theme = await entry(root, "tokyo-night");
    await writeFile(path.join(theme, "tokyo-night.json"), JSON.stringify({name: "Tokyo Night", colors: {accent: "#fff"}}));

    const result = await discoverEntries(root);
    const realBrowser = await realpath(browser);
    const realReview = await realpath(review);
    const realSuperpowers = await realpath(superpowers);
    const realTheme = await realpath(theme);
    expect(result.diagnostics).toEqual([]);
    expect(result.entries.map(({id, kind, status, launchPath}) => ({id, kind, status, launchPath}))).toEqual([
      {id: "browser", kind: "extension", status: "valid", launchPath: path.join(realBrowser, "index.ts")},
      {id: "review", kind: "prompt", status: "valid", launchPath: path.join(realReview, "review.md")},
      {id: "superpowers", kind: "skill", status: "valid", launchPath: realSuperpowers},
      {id: "tokyo-night", kind: "theme", status: "valid", launchPath: path.join(realTheme, "tokyo-night.json")},
    ]);
  });

  test("classifies package manifests with globs without resolving targets", async () => {
    const root = await registry();
    const foo = await entry(root, "foo");
    await writeFile(path.join(foo, "package.json"), JSON.stringify({pi: {extensions: ["extensions/*.ts", "!extensions/legacy.ts"]}}));
    const result = await discoverEntries(root);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({id: "foo", kind: "package", status: "valid", launchPath: await realpath(foo)});
  });

  test("classifies an empty convention directory as an opaque package and gives package precedence", async () => {
    const root = await registry();
    const foo = await entry(root, "foo");
    await mkdir(path.join(foo, "skills"));
    await writeFile(path.join(foo, "index.ts"), "export {};\n");
    await writeFile(path.join(foo, "SKILL.md"), "not validated inside package\n");
    const result = await discoverEntries(root);
    expect(result.entries[0]).toMatchObject({id: "foo", kind: "package", status: "valid", launchPath: await realpath(foo)});
  });

  test("ignores state and hidden items but diagnoses loose root files", async () => {
    const root = await registry();
    await writeFile(path.join(root, "piw.json"), '{"version":1,"profiles":{}}\n');
    await writeFile(path.join(root, ".DS_Store"), "ignored");
    await mkdir(path.join(root, ".hidden"));
    await writeFile(path.join(root, "browser.ts"), "export {};\n");
    const result = await discoverEntries(root);
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({severity: "error", code: "unsupported-root-item", path: path.join(root, "browser.ts")}),
    ]);
  });

  test("uses a symlink basename as ID and rejects symlinks to files", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "piw-link-"));
    const root = path.join(base, "registry");
    const target = path.join(base, "pi-worktree");
    const file = path.join(base, "loose.ts");
    await mkdir(root);
    await mkdir(target);
    await writeFile(path.join(target, "index.js"), "");
    await writeFile(file, "");
    await symlink(target, path.join(root, "worktree"));
    await symlink(file, path.join(root, "bad"));
    const result = await discoverEntries(root);
    expect(result.entries.find(({id}) => id === "worktree")).toMatchObject({
      id: "worktree", kind: "extension", realPath: await realpath(target), launchPath: path.join(await realpath(target), "index.js"), status: "valid",
    });
    expect(result.entries.find(({id}) => id === "bad")).toMatchObject({id: "bad", status: "invalid"});
  });

  test("discovers an absolute Pi-store symlink as an opaque package Entry", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "piw-added-package-"));
    const root = path.join(base, ".pi", "piw");
    const target = path.join(base, ".pi", "agent", "npm", "node_modules", "@narumitw", "pi-worktree");
    await mkdir(root, {recursive: true});
    await mkdir(target, {recursive: true});
    await writeFile(path.join(target, "package.json"), JSON.stringify({name: "@narumitw/pi-worktree", pi: {extensions: ["./src/index.ts"]}}));
    const registryPath = path.join(root, "pi-worktree");
    await symlink(target, registryPath);

    const result = await discoverEntries(root);

    expect(result.entries).toEqual([{
      id: "pi-worktree",
      registryPath,
      realPath: await realpath(target),
      status: "valid",
      kind: "package",
      launchPath: await realpath(target),
      diagnostics: [],
    }]);
  });

  test("invalidates broken links, unclassified Entries, kind ambiguity, and dual extension entrypoints", async () => {
    const root = await registry();
    await symlink(path.join(root, "missing-target"), path.join(root, "broken"));
    await entry(root, "empty");
    const ambiguous = await entry(root, "ambiguous");
    await writeFile(path.join(ambiguous, "index.ts"), "");
    await writeFile(path.join(ambiguous, "SKILL.md"), "---\nname: a\ndescription: a\n---\n");
    const dual = await entry(root, "dual");
    await writeFile(path.join(dual, "index.ts"), "");
    await writeFile(path.join(dual, "index.js"), "");
    const result = await discoverEntries(root);
    for (const id of ["ambiguous", "broken", "dual", "empty"]) {
      expect(result.entries.find((candidate) => candidate.id === id)?.status).toBe("invalid");
    }
    expect(result.entries.find(({id}) => id === "ambiguous")?.diagnostics[0]?.code).toBe("ambiguous-entry");
    expect(result.entries.find(({id}) => id === "dual")?.diagnostics[0]?.code).toBe("ambiguous-extension");
    expect(result.entries.find(({id}) => id === "empty")?.diagnostics[0]?.code).toBe("unclassified-entry");
  });

  test("rejects invalid UTF-8 text and only requires minimal skill/theme structure", async () => {
    const root = await registry();
    const prompt = await entry(root, "prompt");
    await writeFile(path.join(prompt, "prompt.md"), Buffer.from([0xc3, 0x28]));
    const skill = await entry(root, "skill");
    await writeFile(path.join(skill, "SKILL.md"), "---\nname: skill\n---\n");
    const theme = await entry(root, "theme");
    await writeFile(path.join(theme, "theme.json"), JSON.stringify({name: "theme", colors: {accent: "anything"}}));
    const result = await discoverEntries(root);
    expect(result.entries.find(({id}) => id === "prompt")?.status).toBe("invalid");
    expect(result.entries.find(({id}) => id === "skill")?.status).toBe("invalid");
    expect(result.entries.find(({id}) => id === "theme")?.status).toBe("valid");
  });

  test("retains the canonical kind when its launch target has the wrong file type", async () => {
    const root = await registry();
    const extension = await entry(root, "extension");
    await mkdir(path.join(extension, "index.ts"));
    const prompt = await entry(root, "prompt");
    await mkdir(path.join(prompt, "prompt.md"));
    const result = await discoverEntries(root);
    expect(result.entries.find(({id}) => id === "extension")).toMatchObject({kind: "extension", status: "invalid"});
    expect(result.entries.find(({id}) => id === "prompt")).toMatchObject({kind: "prompt", status: "invalid"});
  });

  test("invalidates every case-insensitive directory collision", async () => {
    const root = await registry();
    const first = await entry(root, "browser");
    await writeFile(path.join(first, "index.ts"), "");
    let second: string;
    try { second = await entry(root, "Browser"); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") return;
      throw cause;
    }
    await writeFile(path.join(second, "index.ts"), "");
    const result = await discoverEntries(root);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.every((candidate) => candidate.status === "invalid")).toBe(true);
  });
});
