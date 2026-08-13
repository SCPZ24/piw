import {lstat, mkdir, mkdtemp, readFile, readlink, realpath, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test, vi} from "vitest";
import {
  addPiPackage,
  deriveEntryId,
  resolvePiPackagePath,
  validateNpmPackageName,
  type AddPackageDependencies,
} from "../src/packages/pi-package.js";

describe("npm package identity", () => {
  test.each([
    ["foo", "foo"],
    ["pi-worktree", "pi-worktree"],
    ["@scope/foo", "foo"],
    ["@scope/pi-worktree", "pi-worktree"],
  ])("derives the flat Entry ID for %s", (packageName, entryId) => {
    expect(validateNpmPackageName(packageName)).toBe(true);
    expect(deriveEntryId(packageName)).toBe(entryId);
  });

  test.each([
    "", "npm:foo", "git:foo", "https://example.com/foo", "../foo", "/foo", "foo/bar",
    "@scope", "@", "@scope/foo/bar", "@Scope/foo", "Foo", "foo@1.0.0", "foo%20bar",
    ".foo", "_foo", "@.scope/foo", "@scope/.foo",
  ])("rejects unsupported identity %j", (packageName) => {
    expect(validateNpmPackageName(packageName)).toBe(false);
  });

  test("rejects identities over npm's maximum and basenames outside PIW's ID contract", () => {
    expect(validateNpmPackageName(`@${"s".repeat(210)}/foo`)).toBe(false);
    expect(validateNpmPackageName("foo.bar")).toBe(true);
    expect(() => deriveEntryId("foo.bar")).toThrow(/derived Entry ID/i);
    expect(() => deriveEntryId("a".repeat(65))).toThrow(/derived Entry ID/i);
  });

  test("composes unscoped and scoped managed paths without scanning node_modules", () => {
    expect(resolvePiPackagePath("/home/alice", "foo")).toBe("/home/alice/.pi/agent/npm/node_modules/foo");
    expect(resolvePiPackagePath("/home/alice", "@scope/foo")).toBe("/home/alice/.pi/agent/npm/node_modules/@scope/foo");
    expect(path.isAbsolute(resolvePiPackagePath("relative-home", "foo"))).toBe(true);
  });
});

async function fixture(packageName = "foo") {
  const home = await mkdtemp(path.join(tmpdir(), "piw-add-"));
  const installedPath = resolvePiPackagePath(home, packageName);
  const entryId = deriveEntryId(packageName);
  const registryPath = path.join(home, ".pi", "piw", entryId);
  const install = vi.fn<AddPackageDependencies["installPackage"]>();
  const resolvePi = vi.fn<AddPackageDependencies["resolvePi"]>(async () => ({path: "/fake/pi", version: "0.84.1"}));
  return {home, installedPath, entryId, registryPath, install, resolvePi};
}

describe("add Pi package", () => {
  test("links an already-installed package without resolving or invoking Pi", async () => {
    const f = await fixture();
    await mkdir(f.installedPath, {recursive: true});
    const result = await addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi});
    expect(result).toEqual({status: "linked", entryId: "foo", registryPath: f.registryPath, installedPath: f.installedPath, installedByCommand: false});
    expect(await lstat(f.registryPath)).toSatisfy((info) => info.isSymbolicLink());
    expect(await readlink(f.registryPath)).toBe(f.installedPath);
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  test("asks Pi to install a missing package, verifies it, and creates no state file", async () => {
    const f = await fixture();
    f.install.mockImplementation(async (_piPath, packageName) => {
      expect(packageName).toBe("foo");
      await mkdir(f.installedPath, {recursive: true});
    });
    const result = await addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi});
    expect(result).toMatchObject({status: "linked", installedByCommand: true});
    expect(f.resolvePi).toHaveBeenCalledOnce();
    expect(f.install).toHaveBeenCalledWith("/fake/pi", "foo");
    await expect(readFile(path.join(f.home, ".pi", "piw", "piw.json"))).rejects.toMatchObject({code: "ENOENT"});
  });

  test("is idempotent for any live symlink resolving to the managed directory", async () => {
    const f = await fixture();
    await mkdir(f.installedPath, {recursive: true});
    await mkdir(path.dirname(f.registryPath), {recursive: true});
    await symlink(path.relative(path.dirname(f.registryPath), f.installedPath), f.registryPath);
    const result = await addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi});
    expect(result).toEqual({status: "already-available", entryId: "foo", registryPath: f.registryPath, installedPath: f.installedPath});
    expect(await realpath(f.registryPath)).toBe(await realpath(f.installedPath));
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  test("rejects an idempotent-looking link when the managed target is not a directory", async () => {
    const f = await fixture();
    await mkdir(path.dirname(f.installedPath), {recursive: true});
    await writeFile(f.installedPath, "not a package directory\n");
    await mkdir(path.dirname(f.registryPath), {recursive: true});
    await symlink(f.installedPath, f.registryPath);
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/not a directory/i);
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  test("rejects a case-insensitive root collision before invoking Pi", async () => {
    const f = await fixture();
    const conflicting = path.join(f.home, ".pi", "piw", "Foo");
    await mkdir(conflicting, {recursive: true});
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/case-insensitive.*collision/i);
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
    expect((await lstat(conflicting)).isDirectory()).toBe(true);
  });

  test.each(["directory", "file", "wrong-symlink", "broken-symlink"])("rejects an existing %s before installation", async (kind) => {
    const f = await fixture();
    await mkdir(path.dirname(f.registryPath), {recursive: true});
    if (kind === "directory") await mkdir(f.registryPath);
    if (kind === "file") await writeFile(f.registryPath, "mine\n");
    if (kind === "wrong-symlink") {
      const wrong = path.join(f.home, "wrong");
      await mkdir(wrong);
      await symlink(wrong, f.registryPath);
    }
    if (kind === "broken-symlink") await symlink(path.join(f.home, "missing"), f.registryPath);
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/already exists|broken symlink/i);
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  test("rejects a non-directory managed object without invoking Pi", async () => {
    const f = await fixture();
    await mkdir(path.dirname(f.installedPath), {recursive: true});
    await writeFile(f.installedPath, "not a package directory\n");
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/not a directory/i);
    expect(f.resolvePi).not.toHaveBeenCalled();
  });

  test("rejects a broken symlink in Pi's managed package path without invoking Pi", async () => {
    const f = await fixture();
    await mkdir(path.dirname(f.installedPath), {recursive: true});
    await symlink(path.join(f.home, "missing-package-target"), f.installedPath);
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/not a directory|broken symlink/i);
    expect(f.resolvePi).not.toHaveBeenCalled();
    expect(f.install).not.toHaveBeenCalled();
  });

  test("does not create a broken symlink when Pi succeeds without installing", async () => {
    const f = await fixture();
    f.install.mockResolvedValue(undefined);
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow(/did not create/i);
    await expect(lstat(f.registryPath)).rejects.toMatchObject({code: "ENOENT"});
  });

  test("propagates Pi installation failures without creating a link", async () => {
    const f = await fixture();
    f.install.mockRejectedValue(new Error("Pi install failed with exit code 7"));
    await expect(addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi})).rejects.toThrow("exit code 7");
    await expect(lstat(f.registryPath)).rejects.toMatchObject({code: "ENOENT"});
  });

  test("maps a scoped identity to its scoped store path and basename Entry", async () => {
    const f = await fixture("@scope/name");
    await mkdir(f.installedPath, {recursive: true});
    const result = await addPiPackage("@scope/name", f.home, {installPackage: f.install, resolvePi: f.resolvePi});
    expect(result).toMatchObject({entryId: "name", registryPath: path.join(f.home, ".pi", "piw", "name"), installedPath: path.join(f.home, ".pi", "agent", "npm", "node_modules", "@scope", "name")});
  });

  test("never replaces an Entry when concurrent add calls race to create the link", async () => {
    const f = await fixture();
    await mkdir(f.installedPath, {recursive: true});
    const results = await Promise.allSettled([
      addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi}),
      addPiPackage("foo", f.home, {installPackage: f.install, resolvePi: f.resolvePi}),
    ]);
    expect(results.filter(({status}) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({status}) => status === "rejected")).toHaveLength(1);
    expect(await readlink(f.registryPath)).toBe(f.installedPath);
  });
});
