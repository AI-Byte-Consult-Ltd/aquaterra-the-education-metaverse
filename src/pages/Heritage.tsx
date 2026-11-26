import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Anchor, Check, Copy, Loader2, Repeat, Sparkles, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft, input } from "@/game/bank/ui";
import {
  ipfsImage,
  cancelSwap, confirmSwap, fetchHeritageMe, linkChallenge, linkWallet, startSwap, unlinkWallet,
  type HeritageError, type HeritageMe, type Swap,
} from "@/game/heritage/api";
import { connectWallet, hasWalletApp, metamaskLink, signText } from "@/game/heritage/wallet";
import { heritageStrings, shortAddr } from "@/game/heritage/strings";
import { RAINBOW_CONTRACT, TOTAL as RAINBOW_TOTAL, landName } from "@/game/rainbowland/grid";

const statusColour: Record<Swap["status"], string> = {
  open: "text-amber-300", done: "text-emerald-300", rejected: "text-red-300", cancelled: "text-muted-foreground",
};

/** /heritage: link wallets, swap old AquaTerra NFTs for a Heritage plot or Tide. */
const Heritage = () => {
  const { language } = useLanguage();
  const t = heritageStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [me, setMe] = useState<HeritageMe | null>(null);
  const [error, setError] = useState<HeritageError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search] = useSearchParams();
  const [colId, setColId] = useState<number | null>(null);
  // /heritage?token=5601 comes from a Rainbowland cell
  const [token, setToken] = useState(() => (search.get("token") ?? "").replace(/\D/g, "").slice(0, 78));
  const [choice, setChoice] = useState<"plot" | "tide">("plot");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const r = await fetchHeritageMe(session);
    if (r.ok) {
      setMe(r.data);
      setError(null);
    } else if (r.error === "session") signOut();
    else setError(r.error);
  }, [session, signOut]);
  useEffect(() => {
    void load();
  }, [load]);

  const fail = (e: HeritageError) => (e === "session" ? signOut() : toast.error(t.errors[e]));

  const link = async () => {
    if (!session) return;
    setBusy("link");
    try {
      const a = await connectWallet();
      if (!a.ok) return fail(a.error);
      const c = await linkChallenge(session, a.value);
      if (!c.ok) return fail(c.error);
      const s = await signText(a.value, c.data.message);
      if (!s.ok) return fail(s.error);
      const r = await linkWallet(session, c.data.message, s.value);
      if (!r.ok) return fail(r.error);
      toast.success(t.linked);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, call: () => Promise<{ ok: boolean; error?: HeritageError; data?: { swap: Swap } }>, done?: (s: Swap) => void) => {
    setBusy(key);
    const r = await call();
    setBusy(null);
    if (!r.ok) {
      fail(r.error ?? "network");
      void load();
      return;
    }
    if (r.data?.swap && done) done(r.data.swap);
    await load();
    void refresh();
  };

  const cols = me?.collections ?? [];
  const rainbowCol = cols.find((c) => c.contract === RAINBOW_CONTRACT);
  const col = cols.find((c) => c.id === colId) ?? (search.get("token") ? rainbowCol : undefined) ?? cols[0] ?? null;
  const rainbow = col?.contract === RAINBOW_CONTRACT;
  const rainbowToken = rainbow && token !== "" && Number(token) < RAINBOW_TOTAL ? Number(token) : null;
  const isTower = col?.kind === "tower";
  const isPlanet = col?.kind === "planet";
  const listed = col?.listed ? col.items ?? [] : null;
  const item = listed?.find((i) => i.tokenId === token.replace(/^0+(?=\d)/, "")) ?? null;
  const plotOk = !listed && !isTower && !isPlanet && !!col?.allowPlot && (me?.reserve ?? 0) > 0;
  const pick = plotOk ? choice : "tide";
  const evmChains = new Set((me?.chains ?? []).filter((c) => c.family === "evm" && c.enabled).map((c) => c.id));
  const chainName = (id: string) => me?.chains.find((c) => c.id === id)?.name ?? id;

  return (
    <Shell title={t.title} icon={Anchor} accent="text-cyan-300">
      <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {!me && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {error && <p className="text-sm text-destructive">{t.errors[error]}</p>}
      {me && (
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title={t.wallets} icon={WalletIcon}>
            {me.wallets.length === 0 && <p className="text-sm text-muted-foreground">{t.noWallets}</p>}
            {me.wallets.map((w) => (
              <div key={w.address} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-mono">{shortAddr(w.address)}</span>
                <button className={btnSoft} disabled={!!busy} onClick={() => run(`u${w.address}`, () => unlinkWallet(session!, w.address) as never)}>{t.unlink}</button>
              </div>
            ))}
            {hasWalletApp() ? (
              <button className={btnMain} disabled={!!busy} onClick={link}>
                {busy === "link" ? <Loader2 className="h-4 w-4 animate-spin" /> : <WalletIcon className="h-4 w-4" />}
                {busy === "link" ? t.linking : t.link}
              </button>
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>{t.noWalletApp}</p>
                <a className={btnSoft} href={metamaskLink()}>{t.openInMetamask}</a>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
              {me.chains.map((c) => (
                <span key={c.id} className={`rounded-full border px-2 py-0.5 ${c.enabled ? "border-cyan-400/50 text-cyan-200" : "border-border text-muted-foreground"}`}>
                  {c.name}{c.enabled ? "" : ` · ${t.chainSoon}`}
                </span>
              ))}
            </div>
          </Panel>

          <Panel title={t.newSwap} icon={Repeat}>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {t.facts(me.fee, me.district, me.reserve, me.swapped).map((f) => (
                <div key={f.k} className="rounded-lg bg-muted/40 px-2 py-1.5">
                  <dt className="text-muted-foreground">{f.k}</dt>
                  <dd className="font-semibold">{f.v}</dd>
                </div>
              ))}
            </dl>
            {!me.open ? (
              <p className="text-sm text-muted-foreground">{t.closed}</p>
            ) : cols.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noCollections}</p>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!col) return;
                  void run("swap", () => startSwap(session!, col.id, token.trim(), pick), (s) => {
                    toast.success(s.status === "open" ? t.opened : t.status[s.status]);
                    setToken("");
                  });
                }}
              >
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">{t.collection}</span>
                  <select className={input} value={col?.id ?? ""} onChange={(e) => setColId(Number(e.target.value))}>
                    {cols.map((c) => (
                      <option key={c.id} value={c.id} disabled={!evmChains.has(c.chain)}>
                        {c.name} · {t.kinds[c.kind]} · {chainName(c.chain)}{evmChains.has(c.chain) ? "" : ` (${t.chainSoon})`}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span className="font-medium">{t.tokenId}</span>
                  <input className={input} inputMode="numeric" value={token} onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 78))} placeholder="1234" />
                  <span className="block text-xs text-muted-foreground">{t.tokenHint}</span>
                </label>
                {listed ? (
                  <div className="space-y-1.5 text-sm">
                    <p className="text-xs text-muted-foreground">{t.listedNote}</p>
                    <ul className="max-h-48 space-y-1 overflow-y-auto">
                      {listed.map((i) => (
                        <li key={i.tokenId}>
                          <button type="button" disabled={i.taken} onClick={() => setToken(i.tokenId)}
                            className={`w-full rounded-lg border px-2 py-1.5 text-left disabled:opacity-40 ${item?.tokenId === i.tokenId ? "border-cyan-300 bg-cyan-400/10" : "border-border"}`}>
                            <span className="font-medium">{i.title}</span>
                            <span className="block text-xs text-muted-foreground">{t.gives(i.gives, i.tide, i.tiles)}{i.place ? ` · ${i.place}` : ""}{i.taken ? ` · ${t.taken}` : ""}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {token !== "" && !item && <p className="text-xs text-destructive">{t.notListed}</p>}
                  </div>
                ) : isPlanet ? (
                  <p className="rounded-lg border border-indigo-300 bg-indigo-400/10 px-2 py-2 text-sm">{t.getPlanet} <Link to="/orbit" className="underline">Orbit</Link></p>
                ) : isTower ? (
                  <p className="rounded-lg border border-cyan-300 bg-cyan-400/10 px-2 py-2 text-sm">{t.getApartment(col!.name)}</p>
                ) : (
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <button type="button" disabled={!plotOk} onClick={() => setChoice("plot")}
                    className={`rounded-lg border px-2 py-2 text-left disabled:opacity-40 ${pick === "plot" ? "border-cyan-300 bg-cyan-400/10" : "border-border"}`}>
                    {rainbow ? (rainbowToken != null ? t.getRainbow(landName(rainbowToken)) : t.getRainbow("LAND (x, y)")) : t.getPlot(me.district)}
                  </button>
                  <button type="button" disabled={!col || col.swapTide <= 0} onClick={() => setChoice("tide")}
                    className={`rounded-lg border px-2 py-2 text-left disabled:opacity-40 ${pick === "tide" ? "border-cyan-300 bg-cyan-400/10" : "border-border"}`}>
                    {t.getTide(col?.swapTide ?? 0)}
                  </button>
                </div>
                )}
                <button className={`${btnMain} w-full`} disabled={!!busy || !token || me.wallets.length === 0 || (!!listed && !item)}>
                  {busy === "swap" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy === "swap" ? t.checking : t.start(me.fee)}
                </button>
                <p className="text-xs text-muted-foreground">
                  {t.feeFree(me.feeFree)} {me.feeFree < me.fee && <Link to="/wallet" className="text-cyan-300 underline">{t.buyTide}</Link>}
                </p>
              </form>
            )}
            <p className="text-xs text-muted-foreground">{t.feeRule}</p>
          </Panel>

          {(me.companions?.length ?? 0) > 0 && (
            <Panel title={t.companions} icon={Sparkles} className="md:col-span-2">
              <p className="text-xs text-muted-foreground">{t.companionNote}</p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {me.companions!.map((c) => (
                  <li key={c.token} className="overflow-hidden rounded-lg border border-border">
                    {ipfsImage(c.image) && <img src={ipfsImage(c.image)!} alt={c.name} loading="lazy" className="aspect-square w-full object-cover" />}
                    <div className="px-2 py-1.5 text-xs">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-muted-foreground">{[c.pantheon, c.domain].filter(Boolean).join(" · ")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {me.swaps.length > 0 && (
            <Panel title={t.mySwaps} icon={Anchor} className="md:col-span-2">
              <ul className="space-y-3">
                {me.swaps.map((s) => (
                  <li key={s.id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{s.collection} #{s.tokenId}</span>
                      <span className={statusColour[s.status]}>{t.status[s.status]}</span>
                    </div>
                    {s.status === "done" && <p className="mt-1 text-emerald-200">{s.choice === "planet" ? <Link to="/orbit" className="underline">{t.gotPlanet(s.tokenId)}</Link> : s.apartment ? t.gotApartment(s.apartment.towerName, s.apartment.number, s.apartment.floor) : s.plotAddress ? t.gotPlot(s.plotAddress) : t.gotTide(s.tide)}</p>}
                    {s.status === "open" && me.vault && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-muted-foreground">{t.sendTo}</p>
                        <div className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{me.vault}</code>
                          <button className={btnSoft} onClick={() => { void navigator.clipboard?.writeText(me.vault!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copied ? t.copied : t.copy}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t.sendHelp(chainName(s.chain))}</p>
                        <div className="flex flex-wrap gap-2">
                          <button className={btnMain} disabled={!!busy} onClick={() => run(`c${s.id}`, () => confirmSwap(session!, s.id), (x) => x.status === "done" && toast.success(t.received))}>
                            {busy === `c${s.id}` && <Loader2 className="h-4 w-4 animate-spin" />}{t.confirm}
                          </button>
                          <button className={btnSoft} disabled={!!busy} onClick={() => run(`x${s.id}`, () => cancelSwap(session!, s.id), () => toast.success(t.cancelled))}>{t.cancel}</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title={t.collections} icon={Anchor} className="md:col-span-2">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {t.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            <p className="text-xs text-muted-foreground">{t.towerNote}</p>
          </Panel>
        </div>
      )}
    </Shell>
  );
};

export default Heritage;
