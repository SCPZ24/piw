import {execFileSync} from "node:child_process";
import {mkdir, mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {assertCommand, assertLaunch, createSmokeEnvironment} from "./smoke-helpers.mjs";

const root = await mkdtemp(path.join(tmpdir(), "piw-tarball-smoke-"));
const cache = path.join(root, "npm-cache");
const tarballs = path.join(root, "tarballs");
await mkdir(tarballs);
const pack = execFileSync("npm", ["pack", "--cache", cache, "--pack-destination", tarballs], {encoding: "utf8"}).trim().split("\n").at(-1);
if (!pack) throw new Error("npm pack did not return a tarball");
const prefix = path.join(root, "prefix");
execFileSync("npm", [
  "install", "--prefix", prefix, "--cache", cache, "--ignore-scripts",
  "--fetch-retries", "5", "--fetch-retry-mintimeout", "1000", "--fetch-retry-maxtimeout", "10000", "--fetch-timeout", "60000",
  path.join(tarballs, pack),
], {stdio: "inherit"});
const fixture = await createSmokeEnvironment(root);
const executable = path.join(prefix, "node_modules", ".bin", "piw");
for (const args of [["--version"], ["--help"], ["list"], ["doctor"]]) {
  const result = assertCommand(executable, args, fixture.environment, `installed piw ${args.join(" ")}`);
  if (args[0] === "--version" && result.stdout.trim() !== "1.0.0") throw new Error(`installed piw --version returned ${result.stdout.trim()}`);
}
await assertLaunch(executable, [], fixture);
console.log(`Exact tarball smoke passed in ${root}`);
