import { useState } from "react";
import { Anchor, Loader2, Lock, Trash2, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Plot, World } from "@/game/world/generator";
import { buildPier, pierSite, pierStep, PIER_NAMES, removePier, setPier, upgradePier, type Pier, type PierAccess, type PierError, type PierRules } from "./piers";

const tide = (n: number) => `${n.toLocaleString("en")} TIDE`;

export const pierText = {
  title: "Pier",
  none: "This plot touches the water: a jetty, a pier or a harbour can stand on its shore, next to the house.",
  levels: ["", "Jetty", "Pier", "Harbour"],
  lengths: ["", "1 tile into the water", "2 tiles into the water", "3 tiles with a wide head for boats"],
  privateNote: (d: number) => `Private: only you moor here. Your boat rides from or to this plot cost ${d}% less.`,
  publicNote: (d: number, cap: number) =>
    `Public: anyone may moor. Visitors pay your mooring fee (up to ${cap} TIDE), less the travel tax to the State Treasury. Your own rides still cost ${d}% less.`,
  private: "Private",
  public: "Public",
  fee: "Mooring fee",
  build: (name: string) => `Build a ${name.toLowerCase()}`,
  upgrade: (name: string) => `Extend to a ${name.toLowerCase()}`,
  cost: (cost: number, permit: number, h: number) => `${tide(cost)} + permit ${tide(permit)} · ${h === 1 ? "1 hour" : `${h} hours`}`,
  materials: "Wood, concrete and steel from your storehouse are used first and are not charged.",
  save: "Save",
  remove: (n: number) => `Remove the pier (${tide(n)})`,
  confirm: "Tap again to confirm",
  building: (min: number) => `Under construction, ready in ${min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`}`,
  visitorsPublic: (fee: number) => (fee > 0 ? `Public pier · mooring ${tide(fee)}` : "Public pier · free mooring"),
  visitorsPrivate: "Private pier: only the owner moors here.",
  done: "Done",
  errors: {
    session: "Your session ended. Sign in again.",
    not_found: "This plot is not in the land registry yet.",
    not_owner: "Only the owner can build here.",
    not_coastal: "A pier needs a plot by the water.",
    occupied: "This plot already has a pier.",
    nothing_here: "There is no pier here.",
    max_level: "This is already a harbour.",
    building: "Wait until the current work is finished.",
    water_owned: "The pier would reach over water another resident owns.",
    insufficient: "Not enough TIDE. Welcome coins can only buy land.",
    amount: "The fee is above the cap of this pier.",
    param: "Wrong value.",
    network: "The construction office did not answer. Try again.",
  } satisfies Record<PierError, string>,
};

interface Props {
  world: World;
  plot: Plot;
  pier: Pier | null;
  rules: PierRules;
  yours: boolean;
  session: string | null;
  /** Show this level on the plot while choosing. */
  onPreview: (level: number | null) => void;
  onChanged: () => Promise<void>;
}

/** Jetty, pier or harbour on a plot by the water: build, extend, private or public, mooring fee. */
export default function PierPanel({ world, plot, pier, rules, yours, session, onPreview, onChanged }: Props) {
  const t = pierText;
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState<string | null>(null);
  const [access, setAccess] = useState<PierAccess>(pier?.access ?? "private");
  const [fee, setFee] = useState<number>(pier?.fee ?? 0);
  if (!pierSite(world, plot)) return null;
  const disc = rules.params.pier_own_discount_pct ?? 50;
  const now = Date.now() / 1000;
  const working = !!pier && pier.readyAt > now;

  if (!yours) {
    if (!pier) return null;
    return (
      <section className="space-y-1 rounded-lg border border-border p-3 text-sm">
        <h3 className="flex items-center gap-1.5 font-semibold">
          <Anchor className="h-4 w-4 text-sky-300" />
          {t.levels[pier.level]}
        </h3>
        <p className="text-xs text-muted-foreground">{pier.access === "public" ? t.visitorsPublic(pier.fee) : t.visitorsPrivate}</p>
      </section>
    );
  }

  const nextLevel = pier ? (pier.level < 3 ? pier.level + 1 : null) : 1;
  const step = nextLevel ? pierStep(nextLevel, rules) : null;
  const cap = pierStep(pier?.level ?? nextLevel ?? 1, rules).cap;
  const go = async (key: string, f: () => Promise<{ ok: boolean; error?: PierError }>) => {
    if (arm !== key) {
      setArm(key);
      return;
    }
    setArm(null);
    setBusy(true);
    const r = await f();
    setBusy(false);
    if (!r.ok) toast.error(t.errors[r.error ?? "network"]);
    else toast.success(t.done);
    onPreview(null);
    await onChanged();
  };

  return (
    <section id="plot-pier" className="space-y-2.5 rounded-lg border border-sky-400/40 bg-sky-400/5 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <Anchor className="h-4 w-4 text-sky-300" />
        {pier ? t.levels[pier.level] : t.title}
      </h3>
      {!pier && <p className="text-xs text-muted-foreground">{t.none}</p>}
      {working && <p className="text-xs text-amber-200">{t.building(Math.max(1, Math.ceil((pier!.readyAt - now) / 60)))}</p>}

      {/* who may moor */}
      <div className="grid grid-cols-2 gap-1.5">
        {(["private", "public"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAccess(a)}
            aria-pressed={access === a}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-sm ${access === a ? "border-sky-300 bg-sky-400/20 text-sky-100" : "border-border text-muted-foreground"}`}
          >
            {a === "private" ? <Lock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
            {a === "private" ? t.private : t.public}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{access === "private" ? t.privateNote(disc) : t.publicNote(disc, cap)}</p>
      {access === "public" && (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>{t.fee}</span>
          <span className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={cap}
              value={fee}
              onChange={(e) => setFee(Math.max(0, Math.min(cap, Math.floor(Number(e.target.value) || 0))))}
              className="h-8 w-16 rounded-md border border-border bg-background px-2 text-right"
            />
            TIDE
          </span>
        </label>
      )}
      {pier && (access !== pier.access || (access === "public" && fee !== pier.fee)) && (
        <button
          disabled={busy || !session}
          onClick={() => void go("set", () => setPier(session!, plot.id, access, access === "public" ? fee : 0))}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-sky-400 text-sm font-semibold text-black hover:bg-sky-300 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {arm === "set" ? t.confirm : t.save}
        </button>
      )}

      {/* build or extend */}
      {nextLevel && step && (
        <div className="space-y-1.5" onMouseEnter={() => onPreview(nextLevel)} onMouseLeave={() => onPreview(null)}>
          <button
            disabled={busy || !session || working}
            onClick={() => {
              onPreview(nextLevel);
              void go("build", () => (pier ? upgradePier(session!, plot.id) : buildPier(session!, plot.id, access, access === "public" ? fee : 0)));
            }}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-sky-400 text-sm font-semibold text-black hover:bg-sky-300 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {arm === "build" ? t.confirm : pier ? t.upgrade(PIER_NAMES[nextLevel]) : t.build(PIER_NAMES[nextLevel])}
          </button>
          <p className="text-xs text-muted-foreground">
            {t.lengths[nextLevel]} · {t.cost(step.cost, step.permit, step.hours)}
          </p>
          <p className="text-xs text-amber-200/90">
            {t.materials}{" "}
            <Link to="/industry" className="underline">
              Industry
            </Link>
          </p>
        </div>
      )}
      {pier && (
        <button
          disabled={busy || !session}
          onClick={() => void go("remove", () => removePier(session!, plot.id))}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-rose-400/50 text-sm text-rose-200 hover:bg-rose-400/10 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {arm === "remove" ? t.confirm : t.remove(rules.params.pier_remove_cost ?? 20)}
        </button>
      )}
    </section>
  );
}
