import {mkdtemp, mkdir, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = await mkdtemp(path.join(tmpdir(), "piw-smoke-"));
const home = path.join(root, "home");
await mkdir(path.join(home, ".pi", "piw", "entries"), {recursive: true});
await writeFile(path.join(home, ".pi", "piw", "piw.json"), '{"version":1,"profiles":{}}\n');
const cli = new URL("../dist/cli.js", import.meta.url);
for (const args of [["--version"], ["--help"], ["list"], ["doctor"]]) {
  const result = spawnSync(process.execPath, [cli.pathname, ...args], {env: {...process.env, HOME: home}, encoding: "utf8"});
  if (result.status !== 0) throw new Error(`smoke failed for ${args.join(" ")}: ${result.stderr}`);
}
await writeFile(path.join(home, ".pi", "piw", "piw.json"), '{"version":3,"profiles":{}}\n');
const future = spawnSync(process.execPath, [cli.pathname, "list"], {env: {...process.env, HOME: home}, encoding: "utf8"});
if (future.status !== 1 || !future.stderr.includes("newer")) throw new Error("future schema was not rejected");
if (!String(await readFile(path.join(home, ".pi", "piw", "piw.json"))).includes('"version":3')) throw new Error("future schema was modified");
await writeFile(path.join(home, ".pi", "piw", "piw.json"), '{"version":1,"profiles":{}}\n');
const state = JSON.parse(await readFile(path.join(home, ".pi", "piw", "piw.json"), "utf8"));
if (state.version !== 1) throw new Error("smoke state was corrupted");
console.log(`PIW smoke passed in ${root}`);
