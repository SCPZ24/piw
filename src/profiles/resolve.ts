import {naturalCompare, type Diagnostic, type Entry, type PiwStateV1} from "../domain.js";

export interface ProfileResolution {
  name: string;
  entries: Entry[];
  referencedIds: string[];
  available: boolean;
  diagnostics: Diagnostic[];
}

export function resolveProfiles(state: PiwStateV1, entries: Entry[]): ProfileResolution[] {
  const usable = new Map(entries.filter((entry) => entry.status === "valid").map((entry) => [entry.id, entry]));
  const invalid = new Map(entries.filter((entry) => entry.status === "invalid").map((entry) => [entry.id, entry]));
  return Object.entries(state.profiles).map(([name, profile]) => {
    const resolved: Entry[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const id of profile.entries) {
      const found = usable.get(id);
      if (found) resolved.push(found);
      else if (invalid.has(id)) diagnostics.push({severity: "error", code: "invalid-reference", message: `Entry "${id}" is invalid`, entryId: id, profileName: name});
      else diagnostics.push({severity: "error", code: "missing-reference", message: `Entry "${id}" is missing`, entryId: id, profileName: name});
    }
    return {name, entries: resolved.sort((a, b) => naturalCompare(a.id, b.id)), referencedIds: [...profile.entries], available: diagnostics.length === 0, diagnostics};
  }).sort((a, b) => naturalCompare(a.name, b.name));
}
