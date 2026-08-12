import {access, mkdir, mkdtemp, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {runDoctor} from "../src/app.js";

async function fakePi(root: string, version = "0.84.1"): Promise<string> {
  const bin = path.join(root, "bin");
  await mkdir(bin, {recursive: true});
  const executable = path.join(bin, "pi");
  await writeFile(executable, `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`, {mode: 0o755});
  return bin;
}

describe("read-only doctor", () => {
  test("reports missing state and Pi while leaving the filesystem untouched", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-doctor-missing-"));
    const lines: string[] = [];
    expect(await runDoctor(home, {PATH: ""}, (line) => lines.push(line))).toBe(true);
    expect(lines.join("\n")).toContain("piw.json does not exist");
    expect(lines.join("\n")).toContain("`pi` was not found on PATH");
    await expect(access(path.join(home, ".pi", "piw"))).rejects.toThrow();
  });

  test("continues registry and tool diagnostics when state is invalid", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-doctor-invalid-"));
    const home = path.join(root, "home");
    const piwHome = path.join(home, ".pi", "piw");
    await mkdir(piwHome, {recursive: true});
    await writeFile(path.join(piwHome, "piw.json"), '{"version":3,"profiles":{}}\n');
    await writeFile(path.join(piwHome, "loose.ts"), "");
    const bin = await fakePi(root);
    const lines: string[] = [];
    expect(await runDoctor(home, {PATH: bin}, (line) => lines.push(line))).toBe(true);
    const output = lines.join("\n");
    expect(output).toContain("newer than this release supports");
    expect(output).toContain("Unsupported root item: loose.ts");
    expect(output).toContain("Profile checks unavailable");
    expect(output).toContain("OK pi 0.84.1");
    expect(output).toContain("WARN git not found");
    expect(output).toContain("WARN npm not found");
  });

  test("reports Entry update phase labels and unavailable profiles", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-doctor-entries-"));
    const home = path.join(root, "home");
    const piwHome = path.join(home, ".pi", "piw");
    await mkdir(piwHome, {recursive: true});
    await writeFile(path.join(piwHome, "piw.json"), JSON.stringify({version: 1, profiles: {broken: {entries: ["missing"]}}}));

    const npmEntry = path.join(piwHome, "npm-entry");
    await mkdir(npmEntry);
    await writeFile(path.join(npmEntry, "index.ts"), "");
    await writeFile(path.join(npmEntry, "package.json"), "{}\n");

    const gitNpmEntry = path.join(piwHome, "git-npm");
    await mkdir(gitNpmEntry);
    await writeFile(path.join(gitNpmEntry, "index.ts"), "");
    await writeFile(path.join(gitNpmEntry, "package.json"), "{}\n");
    await writeFile(path.join(gitNpmEntry, ".git"), "gitdir: /external/worktree\n");

    const unmanaged = path.join(piwHome, "local");
    await mkdir(unmanaged);
    await writeFile(path.join(unmanaged, "index.js"), "");

    const bin = await fakePi(root);
    const lines: string[] = [];
    expect(await runDoctor(home, {PATH: bin}, (line) => lines.push(line))).toBe(true);
    const output = lines.join("\n");
    expect(output).toContain("git-npm\textension\tvalid\tgit+npm");
    expect(output).toContain("npm-entry\textension\tvalid\tnpm");
    expect(output).toContain("local\textension\tvalid\tunmanaged");
    expect(output).toContain('broken: Entry "missing" is missing');
  });

  test("returns success when only optional manager warnings remain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "piw-doctor-ok-"));
    const home = path.join(root, "home");
    const piwHome = path.join(home, ".pi", "piw");
    await mkdir(piwHome, {recursive: true});
    await writeFile(path.join(piwHome, "piw.json"), '{"version":1,"profiles":{}}\n');
    const bin = await fakePi(root);
    const lines: string[] = [];
    expect(await runDoctor(home, {PATH: bin}, (line) => lines.push(line))).toBe(false);
    expect(lines.join("\n")).toContain("OK no problems found");
  });
});
