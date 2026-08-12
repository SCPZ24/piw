import {spawn, spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, realpath, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import process from "node:process";

const packageName = "@earendil-works/pi-coding-agent";
const requestedVersion = process.argv[process.argv.indexOf("--pi-version") + 1] ?? process.env.PIW_COMPAT_PI_VERSION;
if (!requestedVersion) throw new Error("Usage: node scripts/pi-compat.mjs --pi-version <version|latest>");

const root = await mkdtemp(path.join(tmpdir(), `piw-pi-${requestedVersion.replaceAll("/", "-")}-`));
const piPrefix = path.join(root, "pi");
const npmCache = path.join(root, "npm-cache");
const install = spawnSync("npm", [
  "install", "--prefix", piPrefix, "--cache", npmCache, "--no-package-lock", "--ignore-scripts",
  "--fetch-retries", "5", "--fetch-retry-mintimeout", "1000", "--fetch-retry-maxtimeout", "10000",
  `${packageName}@${requestedVersion}`,
], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (install.status !== 0) throw new Error(`Could not install real Pi ${requestedVersion}:\n${install.stdout}\n${install.stderr}`);

const piBin = path.join(piPrefix, "node_modules", ".bin", "pi");
const installed = spawnSync(piBin, ["--version"], {encoding: "utf8"});
if (installed.status !== 0) throw new Error(`Real Pi --version failed:\n${installed.stdout}\n${installed.stderr}`);
const installedVersion = installed.stdout.trim();

const home = path.join(root, "home");
const piwHome = path.join(home, ".pi", "piw");
const extension = path.join(piwHome, "extension-test");
const skill = path.join(piwHome, "skill-test");
const prompt = path.join(piwHome, "prompt-test");
const theme = path.join(piwHome, "theme-test");
const packageEntry = path.join(piwHome, "package-test");
const packageExtension = path.join(packageEntry, "extensions");
await Promise.all([extension, skill, prompt, theme, packageExtension].map((directory) => mkdir(directory, {recursive: true})));

const extensionMarker = path.join(root, "extension-loaded");
const packageMarker = path.join(root, "package-loaded");
await writeFile(path.join(extension, "index.ts"), `
import {writeFileSync} from "node:fs";
export default function (pi) {
  writeFileSync(process.env.PIW_COMPAT_EXTENSION_MARKER, "loaded\\n");
  pi.registerCommand("extension-test", {description: "PIW compatibility extension", handler: async () => {}});
}
`);
await writeFile(path.join(skill, "SKILL.md"), "---\nname: skill-test\ndescription: PIW compatibility skill\n---\n\n# Skill test\n");
await writeFile(path.join(prompt, "prompt-test.md"), "---\ndescription: PIW compatibility prompt\n---\n\nCompatibility prompt.\n");

const bundledThemePath = path.join(piPrefix, "node_modules", packageName, "dist", "modes", "interactive", "theme", "dark.json");
const bundledTheme = JSON.parse(await readFile(bundledThemePath, "utf8"));
bundledTheme.name = "theme-test";
await writeFile(path.join(theme, "theme-test.json"), `${JSON.stringify(bundledTheme, null, 2)}\n`);

await writeFile(path.join(packageEntry, "package.json"), `${JSON.stringify({
  name: "piw-compat-package",
  private: true,
  pi: {extensions: ["./extensions/index.ts"]},
}, null, 2)}\n`);
await writeFile(path.join(packageExtension, "index.ts"), `
import {writeFileSync} from "node:fs";
export default function (pi) {
  writeFileSync(process.env.PIW_COMPAT_PACKAGE_MARKER, "loaded\\n");
  pi.registerCommand("package-test", {description: "PIW compatibility package", handler: async () => {}});
}
`);
await writeFile(path.join(piwHome, "piw.json"), `${JSON.stringify({
  version: 1,
  profiles: {
    resources: {entries: ["extension-test", "skill-test", "prompt-test", "theme-test"]},
    package: {entries: ["package-test"]},
  },
}, null, 2)}\n`);

const environment = {...process.env};
for (const name of Object.keys(environment)) {
  if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN|BEARER_TOKEN|ACCESS_TOKEN)$/u.test(name)) delete environment[name];
}
Object.assign(environment, {
  HOME: home,
  PATH: `${path.dirname(piBin)}${path.delimiter}${process.env.PATH ?? ""}`,
  PI_CODING_AGENT_DIR: path.join(root, "pi-agent"),
  PI_OFFLINE: "1",
  PI_TELEMETRY: "0",
  PIW_COMPAT_EXTENSION_MARKER: extensionMarker,
  PIW_COMPAT_PACKAGE_MARKER: packageMarker,
});

const piw = new URL("../dist/cli.js", import.meta.url).pathname;
const doctor = spawnSync(process.execPath, [piw, "doctor"], {cwd: home, env: environment, encoding: "utf8"});
if (doctor.status !== 0) throw new Error(`piw doctor rejected real Pi ${installedVersion}:\n${doctor.stdout}\n${doctor.stderr}`);

async function rpcCommands(profile) {
  const child = spawn(process.execPath, [piw, profile, "--", "--offline", "--mode", "rpc", "--no-session", "--no-context-files"], {
    cwd: home,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end('{"id":"commands","type":"get_commands"}\n');
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`Real Pi ${installedVersion} RPC timed out for ${profile}`)); }, 20_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (status) => { clearTimeout(timer); resolve(status); });
  });
  if (code !== 0) throw new Error(`Real Pi ${installedVersion} failed for profile ${profile} (${String(code)}):\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  const response = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === "commands");
  if (!response?.success) throw new Error(`Real Pi ${installedVersion} did not answer get_commands for ${profile}:\n${stdout}\n${stderr}`);
  return response.data.commands;
}

const resourceCommands = await rpcCommands("resources");
const resourceNames = new Set(resourceCommands.map((command) => command.name));
for (const expected of ["extension-test", "prompt-test", "skill:skill-test"]) {
  if (!resourceNames.has(expected)) throw new Error(`Real Pi ${installedVersion} did not load explicit resource ${expected}`);
}
if (String(await readFile(extensionMarker, "utf8")).trim() !== "loaded") throw new Error("Explicit extension did not initialize");

const packageCommands = await rpcCommands("package");
if (!packageCommands.some((command) => command.name === "package-test")) throw new Error(`Real Pi ${installedVersion} did not load the local package root`);
if (String(await readFile(packageMarker, "utf8")).trim() !== "loaded") throw new Error("Local package extension did not initialize");

console.log(JSON.stringify({
  requested: requestedVersion,
  installed: installedVersion,
  extension: "loaded",
  skill: "loaded",
  prompt: "loaded",
  theme: "accepted",
  package: "loaded",
  isolationFlags: "accepted",
  piwHome: await realpath(piwHome),
}, null, 2));
