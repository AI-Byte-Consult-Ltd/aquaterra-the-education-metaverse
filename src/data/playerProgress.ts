// Personal exploration/collection progress for the land map -- entirely
// local to this browser (localStorage), and completely separate from
// parcel ownership/district data in landMap.ts. This never reads or
// writes anything about who "owns" a parcel; it only remembers what this
// visitor has personally found and collected, so unlike a "claim your
// land" mechanic it carries no account-security surface at all -- there's
// nothing here for one visitor to take from another.
import type { Parcel } from "./landMap";
import { DISTRICTS } from "./landMap";

const STORAGE_KEY = "aquaterra_player_progress_v1";
const COLLECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const TOTAL_DISTRICTS = DISTRICTS.length;
export const TOTAL_LANDMARKS = 2; // Bifröst Gate, Yggdrasil's Root -- see LANDMARKS in landMap.ts

export interface PlayerProgress {
  inventory: Record<string, number>;
  lastCollectedAt: Record<string, number>; // parcel id -> timestamp (ms)
  visitedDistricts: string[];
  foundLandmarks: string[]; // parcel ids
}

function emptyProgress(): PlayerProgress {
  return { inventory: {}, lastCollectedAt: {}, visitedDistricts: [], foundLandmarks: [] };
}

export function loadProgress(): PlayerProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    return { ...emptyProgress(), ...JSON.parse(raw) };
  } catch {
    return emptyProgress();
  }
}

function saveProgress(p: PlayerProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private browsing / quota exceeded -- progress just won't persist this session.
  }
}

export function visitParcel(progress: PlayerProgress, parcel: Parcel): PlayerProgress {
  const visitedDistricts = progress.visitedDistricts.includes(parcel.districtId)
    ? progress.visitedDistricts
    : [...progress.visitedDistricts, parcel.districtId];
  const foundLandmarks =
    parcel.type === "landmark" && !progress.foundLandmarks.includes(parcel.id)
      ? [...progress.foundLandmarks, parcel.id]
      : progress.foundLandmarks;
  if (visitedDistricts === progress.visitedDistricts && foundLandmarks === progress.foundLandmarks) return progress;
  const next = { ...progress, visitedDistricts, foundLandmarks };
  saveProgress(next);
  return next;
}

export function canCollect(progress: PlayerProgress, parcel: Parcel): boolean {
  const last = progress.lastCollectedAt[parcel.id];
  return !last || Date.now() - last >= COLLECT_COOLDOWN_MS;
}

// Grants 1-3 of the parcel's resource material to the personal inventory.
// Returns null if this parcel has nothing to collect or is on cooldown.
export function collectResource(progress: PlayerProgress, parcel: Parcel): { progress: PlayerProgress; gained: number } | null {
  if (!parcel.resourceType || !canCollect(progress, parcel)) return null;
  const gained = 1 + Math.floor(Math.random() * 3);
  const next: PlayerProgress = {
    ...progress,
    inventory: { ...progress.inventory, [parcel.resourceType]: (progress.inventory[parcel.resourceType] ?? 0) + gained },
    lastCollectedAt: { ...progress.lastCollectedAt, [parcel.id]: Date.now() },
  };
  saveProgress(next);
  return { progress: next, gained };
}
