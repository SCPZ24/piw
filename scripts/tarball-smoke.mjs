import {execFileSync, spawnSync} from "node:child_process";
import {mkdtemp, mkdir, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "piw-tarball-smoke-"));
const cache = path.join(root, "npm-cache");
const pack = execFileSync("npm", ["pack", "--cache", cache], {encoding: "utf8"}).trim().split("\n").at(-1);
if (!pack) throw new Error("npm pack did not return a tarball");
const prefix = path.join(root, "prefix");
execFileSync("npm", ["install", "--prefix", prefix, "--cache", cache, path.resolve(pack)], {stdio: "inherit"});
const home = path.join(root, "home"); await mkdir(path.join(home, ".pi", "piw", "entries"), {recursive: true});
await writeFile(path.join(home, ".pi", "piw", "piw.json"), '{"version":1,"profiles":{}}\n');
const executable = path.join(prefix, "node_modules", ".bin", "piw");
for (const args of [["--version"], ["--help"], ["list"], ["doctor"]]) {
  const result = spawnSync(executable, args, {env: {...process.env, HOME: home}, encoding: "utf8"});
  if (result.status !== 0) throw new Error(`installed tarball failed ${args.join(" ")}: ${result.stderr}`);
}
console.log(`Exact tarball smoke passed in ${root}`);
