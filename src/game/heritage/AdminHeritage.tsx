import { useCallback, useEffect, useState } from "react";
import { Anchor, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { btnMain, btnSoft, input } from "@/game/bank/ui";
import { heritageAdmin, type HeritageAdmin, type Kind } from "./api";
import { heritageStrings, shortAddr } from "./strings";

const KINDS: Kind[] = ["land", "house", "car", "asset", "tower"];
const blank = { chain: "cronos", contract: "", name: "", kind: "land" as Kind, swapTide: 500, allowPlot: true, enabled: false };

/** /admin: the Heritage Port collections, vault and reserve. Changes are for the Founder. */
const AdminHeritage = ({ founder }: { founder: boolean }) => {
  const { language } = useLanguage();
  const t = heritageStrings(language);
  const a = t.admin;
  const { session } = useAccount();
  const [v, setV] = useState<HeritageAdmin | null>(null);
  const [busy, setBusy] = useState(false);
  const [vault, setVault] = useState("");
  const [f, setF] = useState(blank);

  const send = useCallback(async (extra: Record<string, unknown> = {}) => {
    if (!session) return;
    setBusy(true);
    const r = await heritageAdmin(session, extra);
    setBusy(false);
    if (!r.ok) return void toast.error(t.errors[r.error]);
    setV(r.data);
    setVault((x) => x || r.data.vault || "");
  }, [session, t]);
  useEffect(() => {
    void send();
  }, [send]);

  if (!v) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Anchor className="h-5 w-5 text-cyan-300" />{a.title}</h2>
      <p className="text-sm text-muted-foreground">{a.intro}</p>
      <p className="text-xs text-muted-foreground">{a.fee(v.fee)} · {a.wallets(v.wallets)} · {a.district}: {v.district}</p>
      {founder && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[16rem] flex-1 space-y-1 text-sm">
            <span>{a.vault}</span>
            <input className={input} value={vault} onChange={(e) => setVault(e.target.value.trim())} placeholder="0x…" />
          </label>
          <button className={btnMain} disabled={busy} onClick={() => send({ action: "admin_setting", key: "vault_address", address: vault })}>{a.save}</button>
          <button className={btnSoft} disabled={busy} onClick={() => send({ action: "admin_reserve" })}>{a.reserve(v.reserve)}</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {v.collections.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="py-1.5 pr-2">{c.name}<div className="text-xs text-muted-foreground">{c.chain} · {shortAddr(c.contract)} · {t.kinds[c.kind]}</div></td>
                <td className="pr-2 text-xs">{c.kind === "tower" ? "—" : `${t.tide(c.swapTide)}${c.allowPlot ? " / plot" : ""}`}</td>
                <td className="pr-2 text-xs">{c.swapped ?? 0}</td>
                <td>
                  {founder ? (
                    <button className={btnSoft} disabled={busy} onClick={() => send({ action: "admin_collection", chain: c.chain, contract: c.contract, name: c.name, kind: c.kind, swapTide: c.swapTide, allowPlot: c.allowPlot, enabled: !c.enabled })}>
                      {c.enabled ? "On" : "Off"}
                    </button>
                  ) : c.enabled ? "On" : "Off"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {founder && (
        <form className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void send({ action: "admin_collection", ...f }).then(() => setF(blank)); }}>
          <p className="text-sm font-semibold sm:col-span-3">{a.add}</p>
          <select className={input} value={f.chain} onChange={(e) => setF({ ...f, chain: e.target.value })}>
            {v.chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className={`${input} sm:col-span-2`} placeholder={a.contract} value={f.contract} onChange={(e) => setF({ ...f, contract: e.target.value.trim() })} />
          <input className={input} placeholder={a.name} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>
            {KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">{a.swapTide}
            <input className={`${input} w-24`} type="number" min={0} value={f.swapTide} onChange={(e) => setF({ ...f, swapTide: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.allowPlot} onChange={(e) => setF({ ...f, allowPlot: e.target.checked })} />{a.allowPlot}</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />{a.enabled}</label>
          <button className={btnMain} disabled={busy || !f.contract}>{a.save}</button>
        </form>
      )}
      {v.swaps.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-semibold">{a.swaps}</p>
          <ul className="space-y-1 text-xs">
            {v.swaps.map((s) => (
              <li key={s.id}>{s.resident} · {s.collection} #{s.tokenId} · {s.choice} · {t.status[s.status]}{s.plotAddress ? ` · ${s.plotAddress}` : ""}{s.tide ? ` · ${t.tide(s.tide)}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default AdminHeritage;
