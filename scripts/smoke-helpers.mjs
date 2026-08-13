import {lstat, mkdir, readFile, readlink, realpath, writeFile} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";

export async function createSmokeEnvironment(root) {
  const home = path.join(root, "home");
  const piwHome = path.join(home, ".pi", "piw");
  const browser = path.join(piwHome, "browser");
  const bin = path.join(root, "bin");
  const argsFile = path.join(root, "pi-args.json");
  const installArgsFile = path.join(root, "pi-install-args.json");
  const installCountFile = path.join(root, "pi-install-count.txt");
  await mkdir(browser, {recursive: true});
  await mkdir(bin, {recursive: true});
  await writeFile(path.join(browser, "index.ts"), "export {};\n");
  await writeFile(path.join(piwHome, "piw.json"), JSON.stringify({version: 1, profiles: {builder: {entries: ["browser"]}}}) + "\n");
  const pi = path.join(bin, "pi");
  await writeFile(pi, `#!${process.execPath}
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
if (process.argv[2] === "--version") { console.log("0.83.0"); process.exit(0); }
if (process.argv[2] === "install") {
  const source = process.argv[3];
  if (source !== "npm:foo") { console.error("unexpected install source"); process.exit(2); }
  writeFileSync(process.env.PIW_FAKE_PI_INSTALL_ARGS, JSON.stringify(process.argv.slice(2)));
  const count = existsSync(process.env.PIW_FAKE_PI_INSTALL_COUNT) ? Number(readFileSync(process.env.PIW_FAKE_PI_INSTALL_COUNT, "utf8")) : 0;
  writeFileSync(process.env.PIW_FAKE_PI_INSTALL_COUNT, String(count + 1));
  const target = path.join(process.env.HOME, ".pi", "agent", "npm", "node_modules", "foo");
  mkdirSync(target, {recursive: true});
  writeFileSync(path.join(target, "package.json"), JSON.stringify({name: "foo", version: "1.0.0", pi: {extensions: ["./index.ts"]}}));
  process.exit(0);
}
writeFileSync(process.env.PIW_FAKE_PI_ARGS, JSON.stringify(process.argv.slice(2)));
`, {mode: 0o755});
  const environment = {
    ...process.env,
    HOME: home,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    PIW_FAKE_PI_ARGS: argsFile,
    PIW_FAKE_PI_INSTALL_ARGS: installArgsFile,
    PIW_FAKE_PI_INSTALL_COUNT: installCountFile,
  };
  return {home, piwHome, browser, argsFile, installArgsFile, installCountFile, environment};
}

export async function assertAdd(command, commandPrefix, fixture) {
  const stateFile = path.join(fixture.piwHome, "piw.json");
  const before = await readFile(stateFile);
  const first = assertCommand(command, [...commandPrefix, "add", "foo"], fixture.environment, "piw add foo");
  if (!first.stdout.includes("Added foo ->")) throw new Error(`piw add did not report creation:\n${first.stdout}`);
  const installed = path.join(fixture.home, ".pi", "agent", "npm", "node_modules", "foo");
  const registryPath = path.join(fixture.piwHome, "foo");
  if (!(await lstat(registryPath)).isSymbolicLink()) throw new Error("piw add did not create a symlink Entry");
  if (await readlink(registryPath) !== installed) throw new Error("piw add did not create the expected absolute symlink target");
  if (JSON.stringify(JSON.parse(await readFile(fixture.installArgsFile, "utf8"))) !== JSON.stringify(["install", "npm:foo"])) throw new Error("fake Pi received wrong install argv");
  if ((await readFile(fixture.installCountFile, "utf8")).trim() !== "1") throw new Error("Pi install was not called exactly once");
  const list = assertCommand(command, [...commandPrefix, "list"], fixture.environment, "piw list after add");
  if (!list.stdout.includes(`foo\tpackage\tvalid\t${registryPath}`)) throw new Error(`piw list did not discover added package:\n${list.stdout}`);
  const doctor = assertCommand(command, [...commandPrefix, "doctor"], fixture.environment, "piw doctor after add");
  if (!doctor.stdout.includes(`foo\tpackage\tvalid\texternal\t${registryPath} -> ${await realpath(installed)}`)) throw new Error(`piw doctor did not report external ownership:\n${doctor.stdout}`);
  const second = assertCommand(command, [...commandPrefix, "add", "foo"], fixture.environment, "idempotent piw add foo");
  if (!second.stdout.includes("foo is already available.")) throw new Error(`second piw add was not idempotent:\n${second.stdout}`);
  if ((await readFile(fixture.installCountFile, "utf8")).trim() !== "1") throw new Error("idempotent piw add reinstalled the package");
  const after = await readFile(stateFile);
  if (!before.equals(after)) throw new Error("piw add modified piw.json");
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
