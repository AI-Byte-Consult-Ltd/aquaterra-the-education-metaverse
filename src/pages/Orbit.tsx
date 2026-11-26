import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Coins, History, Loader2, Orbit as OrbitIcon, Package, Pickaxe, Rocket, X } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { useEconomy } from "@/game/economy/EconomyContext";
import { Shell } from "@/game/state/ui";
import { Panel, btnMain, btnSoft } from "@/game/bank/ui";
import { fetchBody, fetchMyOrbit, fetchSky, ipfsUrl, mineAll, sellResource, type BodyView, type MyOrbit, type OrbitError, type Sky } from "@/game/orbit/api";
import { buildSystems, ringRadius, systemPos, type SkySystem } from "@/game/orbit/sky";
import { orbitStrings, type OrbitStrings } from "@/game/orbit/strings";

const RARITY_TONE = ["", "text-slate-300", "text-emerald-300", "text-sky-300", "text-fuchsia-300", "text-amber-300", "text-rose-300"];

/** The animated chart of the Solar System. Tapping a planet selects its system. */
function SkyChart({ systems, selected, onPick, t }: { systems: SkySystem[]; selected: string | null; onPick: (k: string) => void; t: OrbitStrings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const time = useRef(0);
  const sel = useRef(selected);
  sel.current = selected;
  const stars = useMemo(() => Array.from({ length: 220 }, (_, i) => [((i * 7919) % 1000) / 1000, ((i * 104729) % 997) / 997, (i % 5) / 5]), []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let raf = 0;
    let last = performance.now();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const draw = (now: number) => {
      if (!reduce) time.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#050816";
      g.fillRect(0, 0, w, h);
      for (const [x, y, b] of stars) {
        g.fillStyle = `rgba(255,255,255,${0.25 + b * 0.6 * (0.7 + 0.3 * Math.sin(time.current * 2 + x * 40))})`;
        g.fillRect(x * w, y * h, 1 + b, 1 + b);
      }
      const cx = w / 2, cy = h / 2, half = Math.min(w / 2, h / 0.62 / 2) * 0.98;
      // Orbits
      for (const s of systems) {
        const r = ringRadius(s.ring, half);
        g.strokeStyle = s.key === sel.current ? "rgba(253,224,71,0.6)" : "rgba(148,163,184,0.18)";
        g.lineWidth = s.kind === "belt" ? 10 : 1;
        if (s.kind === "belt") g.strokeStyle = "rgba(154,143,134,0.12)";
        g.beginPath();
        g.ellipse(cx, cy, r, r * 0.62, 0, 0, Math.PI * 2);
        g.stroke();
      }
      // Sun
      const sun = g.createRadialGradient(cx, cy, 2, cx, cy, half * 0.09);
      sun.addColorStop(0, "#fff7c2");
      sun.addColorStop(0.4, "#fbbf24");
      sun.addColorStop(1, "rgba(251,146,60,0)");
      g.fillStyle = sun;
      g.beginPath();
      g.arc(cx, cy, half * 0.09, 0, Math.PI * 2);
      g.fill();
      // Systems
      for (const s of systems) {
        const k = Math.max(0.7, half / 320);
        if (s.kind === "belt" || s.kind === "outer") {
          const r = ringRadius(s.ring, half);
          const n = Math.min(90, 20 + s.bodies.length * 2);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + time.current / s.period * Math.PI * 2 + (i % 3) * 0.05;
            const jr = r + ((i * 37) % 9) - 4;
            g.fillStyle = s.kind === "belt" ? "rgba(190,175,160,0.7)" : "rgba(165,180,252,0.55)";
            g.fillRect(cx + Math.cos(a) * jr, cy + Math.sin(a) * jr * 0.62, 1.6, 1.6);
          }
        }
        const p = systemPos(s, time.current, half);
        const x = cx + p.x, y = cy + p.y, rr = s.size * k;
        if (s.key === sel.current) {
          g.strokeStyle = "#fde047";
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x, y, rr + 6, 0, Math.PI * 2);
          g.stroke();
        }
        if (s.key === "Saturn") {
          g.strokeStyle = "rgba(230,207,139,0.7)";
          g.lineWidth = 2;
          g.beginPath();
          g.ellipse(x, y, rr * 1.9, rr * 0.6, -0.3, 0, Math.PI * 2);
          g.stroke();
        }
        const grad = g.createRadialGradient(x - rr / 3, y - rr / 3, 1, x, y, rr);
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(0.25, s.color);
        grad.addColorStop(1, "#111827");
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.fill();
        // Moons as small dots around the planet
        const moons = Math.min(8, s.bodies.length - 1);
        if (s.kind === "planet") {
          for (let i = 0; i < moons; i++) {
            const a = time.current * (0.6 + i * 0.13) + i * 2.1;
            const mr = rr + 4 + i * 2.2;
            g.fillStyle = "rgba(226,232,240,0.85)";
            g.fillRect(x + Math.cos(a) * mr - 0.8, y + Math.sin(a) * mr * 0.8 - 0.8, 1.8, 1.8);
          }
        }
        g.font = `600 ${s.key === sel.current ? 12 : 11}px system-ui, sans-serif`;
        g.textAlign = "center";
        g.fillStyle = s.key === sel.current ? "#fde047" : "rgba(226,232,240,0.85)";
        const label = s.kind === "belt" ? t.belt : s.kind === "outer" ? t.outer : s.key;
        g.fillText(label, x, y + rr + 14);
        if (s.owned > 0) {
          g.fillStyle = "#34d399";
          g.beginPath();
          g.arc(x + rr, y - rr, 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [systems, stars, t]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return;
    const b = c.getBoundingClientRect();
    const w = c.clientWidth, h = c.clientHeight;
    const half = Math.min(w / 2, h / 0.62 / 2) * 0.98;
    const px = e.clientX - b.left - w / 2, py = e.clientY - b.top - h / 2;
    let best: string | null = null, bd = Infinity;
    for (const s of systems) {
      const p = systemPos(s, time.current, half);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bd) { bd = d; best = s.key; }
    }
    if (best && bd < 36) onPick(best);
  };

  return <canvas ref={ref} onClick={click} className="h-[56vh] min-h-[320px] w-full cursor-pointer rounded-2xl border border-indigo-400/30" aria-label={t.title} />;
}

/** /orbit: the sky layer. Planets of the Milky Way Marvels, my claims, daily mining. */
const Orbit = () => {
  const { language } = useLanguage();
  const t = orbitStrings(language);
  const { session, signOut } = useAccount();
  const { refresh } = useEconomy();
  const [sky, setSky] = useState<Sky | null>(null);
  const [me, setMe] = useState<MyOrbit | null>(null);
  const [error, setError] = useState<OrbitError | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [body, setBody] = useState<BodyView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const systems = useMemo(() => (sky ? buildSystems(sky.bodies) : []), [sky]);
  const system = systems.find((s) => s.key === picked) ?? null;

  const fail = useCallback((e: OrbitError) => (e === "session" ? signOut() : toast.error(t.errors[e])), [signOut, t]);

  useEffect(() => {
    void fetchSky().then((r) => (r.ok ? setSky(r.data) : setError(r.error)));
  }, []);
  useEffect(() => {
    if (!session) return;
    void fetchMyOrbit(session).then((r) => (r.ok ? setMe(r.data) : r.error === "session" ? signOut() : setError(r.error)));
  }, [session, signOut]);

  const openBody = async (name: string) => {
    setBody(null);
    const r = await fetchBody(name, session);
    if (r.ok) setBody(r.data);
    else fail(r.error);
  };

  const mine = async () => {
    if (!session) return;
    setBusy("mine");
    const r = await mineAll(session);
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setMe(r.data);
    toast.success(t.mined(r.data.mined ?? 0));
  };
  const sell = async (resource: string) => {
    if (!session) return;
    setBusy("sell:" + resource);
    const r = await sellResource(session, resource);
    setBusy(null);
    if (!r.ok) return fail(r.error);
    setMe(r.data);
    toast.success(t.sold(r.data.sold ?? 0, resource, r.data.tide ?? 0, r.data.taxPct ?? 0));
    void refresh();
  };

  const canMine = !!me?.claims.some((c) => !c.minedToday);

  return (
    <Shell title={t.title} icon={OrbitIcon} back={{ to: "/world", label: t.backToWorld }} accent="text-indigo-300">
      <p className="mb-3 max-w-2xl text-sm text-muted-foreground">{t.intro}</p>
      {error && <p className="mb-4 text-sm text-destructive">{t.errors[error]}</p>}
      {!sky && !error && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {sky && (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{sky.total > 0 ? `${t.stats(sky.total, sky.owned, sky.miners)} · ${t.tapHint}` : t.notLoaded}</p>
            <SkyChart systems={systems} selected={picked} onPick={(k) => { setPicked(k); setBody(null); }} t={t} />
            <div className="flex gap-2 overflow-x-auto pb-1">
              {systems.map((s) => (
                <button key={s.key} type="button" onClick={() => { setPicked(s.key); setBody(null); }}
                  className={`${btnSoft} shrink-0 ${picked === s.key ? "border-amber-300 text-amber-200" : ""}`}>
                  {s.kind === "belt" ? t.belt : s.kind === "outer" ? t.outer : s.key}
                  <span className="text-xs text-muted-foreground">{t.n(s.claims)}</span>
                </button>
              ))}
            </div>
          </div>

          {system && (
            <Panel title={`${system.kind === "belt" ? t.belt : system.kind === "outer" ? t.outer : system.key} · ${t.bodies(system.bodies.length)} · ${t.claims(system.claims)}`} icon={OrbitIcon}>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {system.bodies.map((b) => (
                  <li key={b.name}>
                    <button type="button" onClick={() => void openBody(b.name)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left hover:border-indigo-300 ${body?.name === b.name ? "border-indigo-300 bg-indigo-400/10" : "border-border bg-background/40"}`}>
                      {b.image ? <img src={ipfsUrl(b.image) ?? ""} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-full bg-muted" />}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{b.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{b.type} · <span className={RARITY_TONE[b.top]}>{t.rarity(b.top)}</span></span>
                        <span className="block truncate text-xs text-muted-foreground">{t.claims(b.claims)}{b.owned > 0 ? ` · ${t.home(b.owned)}` : ""} · {b.resources.slice(0, 3).join(", ")}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {body && (
            <Panel title={body.name} icon={Package}>
              <button type="button" aria-label={t.close} onClick={() => setBody(null)} className="float-right -mt-1 rounded p-1 hover:bg-muted"><X className="h-4 w-4" /></button>
              <p className="text-sm font-semibold">{t.resources}</p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {body.resources.map((r) => (
                  <li key={r.resource} className="rounded-full border border-border px-2 py-1">{r.resource}: {t.claims(r.claims)} · {t.perUnit(r.price)}</li>
                ))}
              </ul>
              <ul className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto text-xs sm:grid-cols-4">
                {body.claims.map(([tok, res, rar, owner, mine]) => (
                  <li key={tok} className={`rounded border px-2 py-1 ${mine ? "border-emerald-400 text-emerald-200" : "border-border"}`}>
                    #{tok} · {res} · {rar}
                    <span className="block text-muted-foreground">{mine ? t.yours : owner ?? t.free}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {!session ? (
            <p className="text-sm"><Link to="/login" className="text-primary underline">{t.signIn}</Link></p>
          ) : me && (
            <>
              <Panel title={t.mine} icon={Pickaxe}>
                {me.claims.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noClaims}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" className={btnMain} disabled={!canMine || busy === "mine"} onClick={() => void mine()}>
                        {busy === "mine" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}
                        {t.mineAll}
                      </button>
                      {!canMine && <span className="text-sm text-muted-foreground">{t.resets(me.resetsAt)}</span>}
                    </div>
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {me.claims.map((c) => (
                        <li key={c.tokenId} className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-2">
                          {c.image ? <img src={ipfsUrl(c.image) ?? ""} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : <span className="h-12 w-12 shrink-0 rounded-full bg-muted" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{c.name} <span className="text-xs text-muted-foreground">#{c.tokenId}</span></span>
                            <span className="block truncate text-xs text-muted-foreground">{c.type} of {c.orbits} · {c.rarity}</span>
                            <span className="block truncate text-xs">{t.perDay(c.units, c.resource)}</span>
                          </span>
                          {c.minedToday && <span className="shrink-0 text-xs text-emerald-300">{t.minedToday}</span>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Panel>
              <Panel title={t.hold} icon={Coins}>
                {me.hold.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.holdEmpty}</p>
                ) : (
                  <ul className="space-y-2">
                    {me.hold.map((h) => (
                      <li key={h.resource} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="min-w-[8rem] font-semibold">{h.resource}</span>
                        <span>{t.n(h.units)}</span>
                        <span className="text-muted-foreground">{t.perUnit(h.price)} · {t.worth(h.value)}</span>
                        <button type="button" className={btnSoft} disabled={h.value < 1 || busy === "sell:" + h.resource} onClick={() => void sell(h.resource)}>
                          {busy === "sell:" + h.resource ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                          {t.sell}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {me.log.length > 0 && (
                <Panel title={t.history} icon={History}>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {me.log.map((l, i) => (
                      <li key={i}>{new Date(l.at).toLocaleString("en")}: {l.kind === "mine" ? t.logMine(l.units, l.resource) : t.logSell(l.units, l.resource, l.tide)}</li>
                    ))}
                  </ul>
                </Panel>
              )}
            </>
          )}

          <Panel title={t.bring} icon={Rocket}>
            <p className="text-sm text-muted-foreground">{t.bringNote}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/heritage" className={btnMain}>Heritage Port</Link>
              <span className="text-xs text-muted-foreground">{t.soon}</span>
            </div>
          </Panel>
        </div>
      )}
    </Shell>
  );
};

export default Orbit;
