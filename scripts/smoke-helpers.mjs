import {mkdir, readFile, realpath, writeFile} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";

export async function createSmokeEnvironment(root) {
  const home = path.join(root, "home");
  const piwHome = path.join(home, ".pi", "piw");
  const browser = path.join(piwHome, "browser");
  const bin = path.join(root, "bin");
  const argsFile = path.join(root, "pi-args.json");
  await mkdir(browser, {recursive: true});
  await mkdir(bin, {recursive: true});
  await writeFile(path.join(browser, "index.ts"), "export {};\n");
  await writeFile(path.join(piwHome, "piw.json"), JSON.stringify({version: 1, profiles: {builder: {entries: ["browser"]}}}) + "\n");
  const pi = path.join(bin, "pi");
  await writeFile(pi, `#!${process.execPath}\nimport {writeFileSync} from "node:fs";\nif (process.argv[2] === "--version") { console.log("0.83.0"); process.exit(0); }\nwriteFileSync(process.env.PIW_FAKE_PI_ARGS, JSON.stringify(process.argv.slice(2)));\n`, {mode: 0o755});
  const environment = {...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`, PIW_FAKE_PI_ARGS: argsFile};
  return {home, piwHome, browser, argsFile, environment};
}

export function assertCommand(command, args, environment, label) {
  const result = spawnSync(command, args, {env: environment, encoding: "utf8"});
  if (result.status !== 0) throw new Error(`${label} failed (${String(result.status)}):\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

export async function assertLaunch(command, commandPrefix, fixture) {
  assertCommand(command, [...commandPrefix, "builder"], fixture.environment, "piw builder");
  const actual = JSON.parse(await readFile(fixture.argsFile, "utf8"));
  const expected = [
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
    "-e", path.join(await realpath(fixture.browser), "index.ts"),
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`fake Pi received wrong argv:\nexpected ${JSON.stringify(expected)}\nactual   ${JSON.stringify(actual)}`);
}
