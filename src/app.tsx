import {render} from "ink";
import React from "react";
import {stat} from "node:fs/promises";
import type {Diagnostic, Entry, PiwStateV1, ValidEntry} from "./domain.js";
import {discoverEntries} from "./registry/discovery.js";
import {ensurePiwHome, getPiwPaths, loadState, saveState, type PiwPaths} from "./state/state.js";
import {resolveProfiles, type ProfileResolution} from "./profiles/resolve.js";
import {commandOutput, compilePiArgs, findExecutable, replaceWithPi, resolvePi} from "./launcher/launcher.js";
import {Selector} from "./tui/selector.js";
import {ConfigApp} from "./tui/config.js";
import {runUpdates} from "./updater/updater.js";
import {createSystemUpdater, detectSystemUpdates, executeSystemUpdate} from "./updater/system.js";

export interface Snapshot {paths: PiwPaths; state: PiwStateV1; fingerprint: string; entries: Entry[]; registryDiagnostics: Diagnostic[]; profiles: ProfileResolution[]}
export async function snapshot(home = process.env.HOME, initialize = true): Promise<Snapshot> {
  if (!home) throw new Error("HOME is not set");
  const paths = initialize ? await ensurePiwHome(home) : getPiwPaths(home); const loaded = await loadState(paths.stateFile); const discovery = await discoverEntries(paths.piwHome);
  return {paths, state: loaded.state, fingerprint: loaded.fingerprint, entries: discovery.entries, registryDiagnostics: discovery.diagnostics, profiles: resolveProfiles(loaded.state, discovery.entries)};
}

export async function launch(profileName: string, passthrough: string[]): Promise<never> {
  const current = await snapshot(); const profile = current.profiles.find((item) => item.name === profileName);
  if (!profile) throw new Error(`Profile "${profileName}" does not exist`);
  if (!profile.available) throw new Error(`Profile "${profileName}" cannot start.\n${profile.diagnostics.map((item) => `  - ${item.message}`).join("\n")}`);
  const pi = await resolvePi(); return replaceWithPi(pi.path, compilePiArgs(profile.entries, passthrough));
}

export function printList(current: Snapshot): void {
  console.log("Entries");
  for (const entry of current.entries) console.log(`${entry.id}\t${entry.kind ?? "unclassified"}\t${entry.status}\t${entry.registryPath}`);
  console.log("\nProfiles");
  for (const profile of current.profiles) console.log(`${profile.name}\t${profile.available ? "ready" : "unavailable"}\t${profile.referencedIds.join(", ")}`);
}

export async function runDoctor(home = process.env.HOME, environment: NodeJS.ProcessEnv = process.env, write: (line: string) => void = console.log): Promise<boolean> {
  write("PIW Doctor");
  if (!home) { write("ERROR HOME is not set"); return true; }
  const paths = getPiwPaths(home);
  let errors = false;
  let state: PiwStateV1 | undefined;
  try {
    if (!(await stat(paths.stateFile)).isFile()) throw new Error("piw.json is not a regular file");
    state = (await loadState(paths.stateFile)).state;
    write(`OK state ${paths.stateFile}`);
  } catch (cause) {
    const message = (cause as NodeJS.ErrnoException).code === "ENOENT" ? "piw.json does not exist" : cause instanceof Error ? cause.message : String(cause);
    write(`ERROR ${message}`);
    errors = true;
  }

  const discovery = await discoverEntries(paths.piwHome);
  for (const diagnostic of discovery.diagnostics) {
    write(`ERROR ${diagnostic.message}`);
    errors = true;
  }
  for (const candidate of discovery.entries) {
    for (const diagnostic of candidate.diagnostics) {
      write(`${diagnostic.severity === "error" ? "ERROR" : "WARN"} ${candidate.id}: ${diagnostic.message}`);
      errors ||= diagnostic.severity === "error";
    }
  }

  if (state) {
    for (const profile of resolveProfiles(state, discovery.entries)) {
      for (const diagnostic of profile.diagnostics) {
        write(`ERROR ${profile.name}: ${diagnostic.message}`);
        errors = true;
      }
    }
  } else {
    write("WARN Profile checks unavailable because piw.json is invalid or missing");
  }

  const find = async (name: string) => findExecutable(name, environment);
  const updater = createSystemUpdater({findExecutable: find, commandOutput});
  for (const candidate of discovery.entries) {
    if (candidate.status !== "valid") continue;
    try {
      const phases = await updater.detect(candidate);
      const manager = phases.length ? phases.map(({manager}) => manager).join("+") : "unmanaged";
      write(`${candidate.id}\t${candidate.kind}\tvalid\t${manager}\t${candidate.registryPath}${candidate.registryPath !== candidate.realPath ? ` -> ${candidate.realPath}` : ""}`);
    } catch (cause) {
      write(`ERROR ${candidate.id}: update detection failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      errors = true;
    }
  }

  if (!await find("git")) write("WARN git not found; Git update phases will be skipped");
  if (!await find("npm")) write("WARN npm not found; npm update phases will be skipped");
  try {
    const pi = await resolvePi(environment);
    write(`OK pi ${pi.version} (${pi.path})`);
  } catch (cause) {
    write(`ERROR ${cause instanceof Error ? cause.message : String(cause)}`);
    errors = true;
  }
  if (!errors) write("OK no problems found");
  return errors;
}

export async function selectProfile(passthrough: string[]): Promise<number> {
  const current = await snapshot();
  if (!current.profiles.length) { console.error("No profiles are configured. Run `piw config` to create one."); return 1; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Profile selection requires a TTY. Use `piw <profile>` for direct launch.");
  return await new Promise((resolve) => {
    const instance = render(<Selector profiles={current.profiles} onSelect={(name) => { instance.unmount(); launch(name, passthrough).catch((error) => { console.error(error.message); resolve(1); }); }} onCancel={() => { instance.unmount(); resolve(0); }} />, {exitOnCtrlC: false, patchConsole: false, alternateScreen: true});
  });
}

export async function configure(): Promise<number> {
  const current = await snapshot();
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("`piw config` requires a TTY");
  return await new Promise((resolve) => {
    const instance = render(<ConfigApp initial={current.state} entries={current.entries} onSave={async (state) => { await saveState(current.paths.stateFile, state, current.fingerprint); instance.unmount(); resolve(0); }} onCancel={() => { instance.unmount(); resolve(0); }} />, {exitOnCtrlC: false, patchConsole: false, alternateScreen: true});
  });
}

export async function updateEntries(current: Snapshot): Promise<boolean> {
  const valid = current.entries.filter((entry): entry is ValidEntry => entry.status === "valid");
  const results = await runUpdates(valid, detectSystemUpdates, executeSystemUpdate);
  console.log("Updating PIW entries\n");
  for (const {entry, steps} of results) {
    console.log(entry.id);
    for (const step of steps) console.log(`  ${step.manager}\t${step.status}${"reason" in step ? `: ${step.reason}` : ""}`);
  }
  const counts = new Map<string, number>();
  for (const {steps} of results) for (const step of steps) counts.set(step.status, (counts.get(step.status) ?? 0) + 1);
  console.log(`\nUpdated: ${counts.get("updated") ?? 0}  Up-to-date: ${counts.get("up-to-date") ?? 0}  Skipped: ${counts.get("skipped") ?? 0}  Unmanaged: ${counts.get("unmanaged") ?? 0}  Failed: ${counts.get("failed") ?? 0}`);
  return (counts.get("failed") ?? 0) > 0;
}
