/*
 * The plan of one tower apartment, read straight from its NFT metadata on IPFS: the image of the
 * NFT is the floor plan. Only for the two Radiant Residences towers, whose metadata folders are known.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ipfsImage } from "./api";

/** Metadata folder of each tower collection (contract in lower case). */
const META: Record<string, string> = {
  "0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869": "QmXwx4cLAbLU3db4VPMynTex8PkV6r7x1DgbrshS7UnAmb",
  "0xb4b898ee60185facc247aadb8d061661590f167f": "QmVEYwNTRJGWajMTTS1RL1YiG3HHQ2QBKjuGFkgK7x7Q5N",
};
export const TOWER_META_BY_ID: Record<string, string> = {
  "first-light": META["0x3720cde69e4e997bbdeaec7b4e7b5f8c3c406869"],
  "second-light": META["0xb4b898ee60185facc247aadb8d061661590f167f"],
};
const GATEWAY = "https://gateway.pinata.cloud/ipfs/";

interface Meta { name: string; image: string | null; traits: [string, string][] }
const cache = new Map<string, Meta | null>();

/** Floor 0 is the ground floor in the NFTs. */
export const floorLabel = (f: number) => (f === 0 ? "Ground" : String(f));

export function towerMetaFolder(contract: string | null | undefined) {
  return contract ? META[contract.toLowerCase()] ?? null : null;
}

export default function ApartmentPreview({ folder, tokenId }: { folder: string; tokenId: string }) {
  const key = `${folder}/${tokenId}`;
  const [meta, setMeta] = useState<Meta | null | undefined>(cache.get(key));
  useEffect(() => {
    if (cache.has(key)) {
      setMeta(cache.get(key));
      return;
    }
    setMeta(undefined);
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(GATEWAY + key, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => {
          const v: Meta | null = m && typeof m === "object"
            ? {
                name: String(m.name ?? ""),
                image: typeof m.image === "string" ? m.image.replace(/^ipfs:\/\//, "") : null,
                traits: (Array.isArray(m.attributes) ? m.attributes : [])
                  .filter((a: { trait_type?: unknown; value?: unknown }) => a && a.trait_type && a.value != null && a.value !== "None")
                  .map((a: { trait_type: unknown; value: unknown }) => [String(a.trait_type).replace(/_/g, " "), String(a.value)] as [string, string])
                  .filter(([k]: [string, string]) => !/district|street|building|staking/i.test(k)),
              }
            : null;
          cache.set(key, v);
          setMeta(v);
        })
        .catch(() => {
          if (!ctl.signal.aborted) setMeta(null);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [key]);

  if (meta === undefined)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading the apartment plan…
      </p>
    );
  if (meta === null) return <p className="text-xs text-muted-foreground">No NFT with this number in the tower.</p>;
  const img = ipfsImage(meta.image);
  return (
    <figure className="overflow-hidden rounded-lg border border-cyan-300/60 bg-background/60">
      {img && <img src={img} alt={meta.name} loading="lazy" className="w-full object-contain" />}
      <figcaption className="space-y-0.5 px-2 py-1.5 text-xs">
        <div className="font-semibold">{meta.name}</div>
        <div className="text-muted-foreground">{meta.traits.map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>
      </figcaption>
    </figure>
  );
}
