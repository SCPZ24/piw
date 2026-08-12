import {render} from "ink";
import React from "react";
import type {Entry, PiwStateV1} from "./domain.js";
import {discoverEntries} from "./registry/discovery.js";
import {ensurePiwHome, getPiwPaths, loadState, saveState, type PiwPaths} from "./state/state.js";
import {resolveProfiles, type ProfileResolution} from "./profiles/resolve.js";
import {compilePiArgs, replaceWithPi, resolvePi} from "./launcher/launcher.js";
import {Selector} from "./tui/selector.js";
import {ConfigApp} from "./tui/config.js";
import {runUpdates} from "./updater/updater.js";
import {classifySystemUpdate, executeSystemUpdate} from "./updater/system.js";

export interface Snapshot {paths: PiwPaths; state: PiwStateV1; fingerprint: string; entries: Entry[]; profiles: ProfileResolution[]}
export async function snapshot(home = process.env.HOME, initialize = true): Promise<Snapshot> {
  if (!home) throw new Error("HOME is not set");
  const paths = initialize ? await ensurePiwHome(home) : getPiwPaths(home); const loaded = await loadState(paths.stateFile); const entries = await discoverEntries(paths.registryRoot);
  return {paths, state: loaded.state, fingerprint: loaded.fingerprint, entries, profiles: resolveProfiles(loaded.state, entries)};
}

export async function launch(profileName: string, passthrough: string[]): Promise<never> {
  const current = await snapshot(); const profile = current.profiles.find((item) => item.name === profileName);
  if (!profile) throw new Error(`Profile "${profileName}" does not exist`);
  if (!profile.available) throw new Error(`Profile "${profileName}" cannot start.\n${profile.diagnostics.map((item) => `  - ${item.message}`).join("\n")}`);
  const pi = await resolvePi(); return replaceWithPi(pi.path, compilePiArgs(profile.entries, passthrough));
}

export function printList(current: Snapshot): void {
  console.log("Entries");
  for (const entry of current.entries) console.log(`${entry.id}\t${entry.kind}\t${entry.status}\t${entry.registryPath}`);
  console.log("\nProfiles");
  for (const profile of current.profiles) console.log(`${profile.name}\t${profile.available ? "ready" : "unavailable"}\t${profile.referencedIds.join(", ")}`);
}

export async function printDoctor(current: Snapshot): Promise<boolean> {
  let errors = false; console.log("PIW Doctor");
  for (const entry of current.entries) for (const item of entry.diagnostics) { console.log(`${item.severity === "error" ? "ERROR" : "WARN"} ${entry.id}: ${item.message}`); errors ||= item.severity === "error"; }
  for (const profile of current.profiles) for (const item of profile.diagnostics) { console.log(`ERROR ${profile.name}: ${item.message}`); errors = true; }
  try { const pi = await resolvePi(); console.log(`OK pi ${pi.version} (${pi.path})`); } catch (error) { console.log(`ERROR ${(error as Error).message}`); errors = true; }
  if (!errors) console.log("OK no problems found"); return errors;
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
  const results = await runUpdates(current.entries.filter((entry) => entry.status === "valid"), classifySystemUpdate, executeSystemUpdate);
  console.log("Updating PIW entries\n");
  for (const {entry, outcome} of results) console.log(`${entry.id}\t${outcome.manager}\t${outcome.status}${"reason" in outcome ? `: ${outcome.reason}` : ""}`);
  const counts = new Map<string, number>(); for (const result of results) counts.set(result.outcome.status, (counts.get(result.outcome.status) ?? 0) + 1);
  console.log(`\nUpdated: ${counts.get("updated") ?? 0}  Up-to-date: ${counts.get("up-to-date") ?? 0}  Skipped: ${counts.get("skipped") ?? 0}  Unmanaged: ${counts.get("unmanaged") ?? 0}  Failed: ${counts.get("failed") ?? 0}`);
  return (counts.get("failed") ?? 0) > 0;
}
