import { useEffect, useState } from "react";

/** Plot id → [address, district], from the land registry the build writes (much faster than generating the world). */
export type Registry = Map<number, { address: string; district: string }>;

let cache: Promise<Registry> | null = null;

const load = () =>
  (cache ??= fetch(`${import.meta.env.BASE_URL}land-registry.json`)
    .then((r) => r.json())
    .then((j: { plots: [number, string, string, number, number][] }) => new Map(j.plots.map(([id, address, district]) => [id, { address, district }])))
    .catch(() => {
      cache = null;
      return new Map() as Registry;
    }));

export function useRegistry() {
  const [reg, setReg] = useState<Registry | null>(null);
  useEffect(() => {
    let on = true;
    void load().then((r) => on && setReg(r));
    return () => {
      on = false;
    };
  }, []);
  return reg;
}

export const mapLink = (address: string | undefined) => (address ? `/world?at=${encodeURIComponent(address)}` : "/world");

/** "7 Ember Highway, First Light City", without repeating a district the address already names. */
export const placeName = (p: { address: string; district: string } | undefined) =>
  !p ? "" : p.address.includes(p.district) ? p.address : `${p.address}, ${p.district}`;
