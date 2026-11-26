import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Crown, Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAccount } from "@/game/account/AccountContext";
import { fetchPlayers, isStaff, type AccountError, type PlayerRow } from "@/game/account/api";
import { accountLocale, accountStrings } from "@/game/account/strings";
import AdminEconomy from "@/game/economy/AdminEconomy";
import { AdminTreasury } from "@/game/bank/ui";
import AdminBuild from "@/game/build/AdminBuild";
import AdminExchange from "@/game/exchange/AdminExchange";
import AdminHeritage from "@/game/heritage/AdminHeritage";

/** Founder and admins: who has entered the world. The server checks the role too. */
const Admin = () => {
  const { language } = useLanguage();
  const t = accountStrings(language);
  const { player, session, signOut } = useAccount();
  const [data, setData] = useState<{ total: number; newToday: number; players: PlayerRow[] } | null>(null);
  const [error, setError] = useState<AccountError | null>(null);

  const load = useCallback(() => {
    if (!session) return;
    setError(null);
    fetchPlayers(session).then((r) => {
      if (r.ok) setData(r.data);
      else if (r.error === "session") signOut();
      else setError(r.error);
    });
  }, [session, signOut]);
  useEffect(load, [load]);

  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(accountLocale(language), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  const denied = (player && player.role && !isStaff(player)) || error === "forbidden";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center gap-2 px-4 py-3">
        <Link to="/profile" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t.profile}
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16">
        <h1 className="font-display text-2xl font-bold">{t.adminTitle}</h1>
        <p className="mb-5 text-sm text-muted-foreground">{t.adminIntro}</p>

        {denied ? (
          <p className="text-sm text-destructive">{t.errors.forbidden}</p>
        ) : error ? (
          <p className="text-sm text-destructive">
            {t.errors[error]} <button onClick={load} className="text-primary hover:underline">{t.retry}</button>
          </p>
        ) : !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>
        ) : (
          <>
            <div className="mb-4 flex gap-3">
              <div className="rounded-xl border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">{t.total}</div>
                <div className="font-display text-2xl font-bold">{data.total.toLocaleString(accountLocale(language))}</div>
              </div>
              <div className="rounded-xl border border-border px-4 py-3">
                <div className="text-xs text-muted-foreground">{t.newToday}</div>
                <div className="font-display text-2xl font-bold">{data.newToday.toLocaleString(accountLocale(language))}</div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t.colName}</th>
                    <th className="px-3 py-2 font-medium">{t.colEmail}</th>
                    <th className="px-3 py-2 font-medium">{t.colRole}</th>
                    <th className="px-3 py-2 font-medium">{t.colJoined}</th>
                    <th className="px-3 py-2 font-medium">{t.colLastSeen}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.email} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{p.displayName || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.email}</td>
                      <td className="px-3 py-2">
                        {p.council ? (
                          <span className="inline-flex items-center gap-1 text-amber-300"><Crown className="h-3.5 w-3.5" />{t.councilBadge(p.council.title)}</span>
                        ) : (
                          t.roles[p.role ?? "citizen"]
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{when(p.createdAt)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{when(p.lastLoginAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!denied && player && isStaff(player) && (
          <section className="mt-10 border-t border-border pt-6">
            <AdminEconomy founder={player.role === "founder"} />
          </section>
        )}
        {!denied && player && isStaff(player) && (
          <section className="mt-10 border-t border-border pt-6">
            <AdminTreasury />
          </section>
        )}
        {!denied && player && isStaff(player) && (
          <section className="mt-10 border-t border-border pt-6">
            <AdminBuild founder={player.role === "founder"} />
          </section>
        )}
        {!denied && player && isStaff(player) && (
          <section className="mt-10 border-t border-border pt-6">
            <AdminExchange founder={player.role === "founder"} />
          </section>
        )}
        {!denied && player && isStaff(player) && (
          <section className="mt-10 border-t border-border pt-6">
            <AdminHeritage founder={player.role === "founder"} />
          </section>
        )}
      </main>
    </div>
  );
};

export default Admin;
