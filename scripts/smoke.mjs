import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {assertAdd, assertCommand, assertLaunch, createSmokeEnvironment} from "./smoke-helpers.mjs";

const root = await mkdtemp(path.join(tmpdir(), "piw-smoke-"));
const fixture = await createSmokeEnvironment(root);
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
for (const args of [["--version"], ["--help"], ["list"], ["doctor"]]) {
  const result = assertCommand(process.execPath, [cli, ...args], fixture.environment, `piw ${args.join(" ")}`);
  if (args[0] === "--version" && result.stdout.trim() !== "1.0.1") throw new Error(`piw --version returned ${result.stdout.trim()}`);
}
await assertAdd(process.execPath, [cli], fixture);
await assertLaunch(process.execPath, [cli], fixture);

await writeFile(path.join(fixture.piwHome, "piw.json"), '{"version":3,"profiles":{}}\n');
const future = assertCommand(process.execPath, [cli, "--version"], fixture.environment, "piw --version after future state fixture");
if (future.status !== 0) throw new Error("version command unexpectedly read state");
const list = (await import("node:child_process")).spawnSync(process.execPath, [cli, "list"], {env: fixture.environment, encoding: "utf8"});
if (list.status !== 1 || !list.stderr.includes("newer")) throw new Error("future schema was not rejected");
if (!String(await readFile(path.join(fixture.piwHome, "piw.json"))).includes('"version":3')) throw new Error("future schema was modified");
console.log(`PIW smoke passed in ${root}`);
