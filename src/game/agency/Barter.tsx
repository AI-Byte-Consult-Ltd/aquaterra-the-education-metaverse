import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { Panel, btnMain, btnSoft, inputBase } from "@/game/bank/ui";
import { cancelBarter, fetchBarter, offerBarter, takeBarter, type AgencyError, type BarterView, type Result } from "./api";
import { agencyStrings } from "./strings";

/** Harvest barter on /farm: crop for crop between residents, taxed by the state. */
export default function Barter({ session, crops, names, barn, onChange, onSession }: {
  session: string | null;
  crops: { key: string; price: number }[];
  names: Record<string, string>;
  barn: { crop: string; units: number }[];
  onChange: () => void;
  onSession: () => void;
}) {
  const { language } = useLanguage();
  const t = agencyStrings(language);
  const b = t.barter;
  const [view, setView] = useState<BarterView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [give, setGive] = useState("");
  const [want, setWant] = useState("");
  const [gu, setGu] = useState("");
  const [wu, setWu] = useState("");

  const load = useCallback(() => void fetchBarter(session).then((r) => r.ok && setView(r.data)), [session]);
  useEffect(load, [load]);

  const fail = (e: AgencyError) => (e === "session" ? onSession() : toast.error(t.errors[e]));
  const act = async (key: string, call: () => Promise<Result<BarterView>>, msg: string) => {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setView(r.data);
    toast.success(msg);
    onChange();
  };
  const name = (c: string) => names[c] ?? c;
  const taxPct = view?.laws.barterTaxPct ?? 5;
  const price = (c: string) => crops.find((x) => x.key === c)?.price ?? 0;
  const myTax = want && Number(wu) > 0 && taxPct > 0 ? Math.max(1, Math.round((Number(wu) * price(want) * taxPct) / 100)) : 0;

  return (
    <Panel title={b.title} icon={ArrowLeftRight}>
      <p className="text-sm text-muted-foreground">{b.intro(taxPct)}</p>
      {session && barn.length > 0 && (
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          if (give && want && Number(gu) > 0 && Number(wu) > 0)
            void act("offer", () => offerBarter(session, give, Number(gu), want, Number(wu)), b.offered).then(() => { setGu(""); setWu(""); });
        }}>
          <label className="flex flex-col gap-1 text-xs">{b.give}
            <span className="flex gap-2">
              <select className={`${inputBase} flex-1`} value={give} onChange={(e) => setGive(e.target.value)}>
                <option value="">—</option>
                {barn.map((x) => <option key={x.crop} value={x.crop}>{name(x.crop)} ({x.units})</option>)}
              </select>
              <input className={`${inputBase} w-20`} inputMode="numeric" aria-label={b.units} placeholder={b.units} value={gu}
                onChange={(e) => setGu(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs">{b.want}
            <span className="flex gap-2">
              <select className={`${inputBase} flex-1`} value={want} onChange={(e) => setWant(e.target.value)}>
                <option value="">—</option>
                {crops.filter((c) => c.key !== give).map((c) => <option key={c.key} value={c.key}>{name(c.key)}</option>)}
              </select>
              <input className={`${inputBase} w-20`} inputMode="numeric" aria-label={b.units} placeholder={b.units} value={wu}
                onChange={(e) => setWu(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} />
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" className={btnMain} disabled={busy !== null || !give || !want || !Number(gu) || !Number(wu)}>
              {busy === "offer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}{b.offer}
            </button>
            {myTax > 0 && <span className="text-xs text-muted-foreground">{b.taxNote(myTax)}</span>}
          </div>
        </form>
      )}
      <p className="text-sm font-semibold">{b.board}</p>
      {!view ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : view.offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{b.empty}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {view.offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2">
              <span>{b.line(o.maker, o.giveUnits, name(o.giveCrop), o.wantUnits, name(o.wantCrop))}</span>
              {session && (o.mine ? (
                <button type="button" className={btnSoft} disabled={busy !== null} onClick={() => void act("c:" + o.id, () => cancelBarter(session, o.id), b.cancelled)}>
                  <X className="h-4 w-4" />{b.cancel}
                </button>
              ) : (
                <button type="button" className={btnMain} disabled={busy !== null} onClick={() => void act("t:" + o.id, () => takeBarter(session, o.id), b.done)}>
                  {busy === "t:" + o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}{b.take(o.takerTax)}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
