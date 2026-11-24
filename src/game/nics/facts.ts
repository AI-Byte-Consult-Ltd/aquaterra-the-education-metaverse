/*
 * Live facts for each question type, read from the same records the rest of
 * the game shows (economy and governance webhooks). Nothing here is invented:
 * if a record cannot be read, the answer is the honest "offline" phrase.
 */
import { fetchLand, fetchWallet, dailyIncome } from "@/game/economy/api";
import { fetchCivic, fetchLaws, fetchProposals, fetchState, type StateInfo } from "@/game/state/api";
import type { Facts, Topic } from "./topics";

export interface FactContext {
  session: string | null;
  name: string | null;
  locale: string;
}

const TOWER = { floors: 108, apartments: 1200, chain: "Cronos" };

export const makeFormat = (locale: string) => {
  const n = (v: number) => v.toLocaleString(locale);
  const plural = (v: number, one: string, many: string, none?: string) => (v === 0 && none ? none : `${n(v)} ${v === 1 ? one : many}`);
  return {
    n,
    tide: (v: number) => `${n(v)} TIDE`,
    pct: (v: number) => `${n(v)}%`,
    bp: (v: number) => `${n(v / 100)}%`,
    plural,
    date: (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }),
  };
};

const param = (s: StateInfo, key: string) => s.params.find((p) => p.key === key)?.value;

/** Facts for one topic; null when a record could not be read. */
export const gatherFacts = async (topic: Topic, ctx: FactContext): Promise<Facts | null> => {
  const f = makeFormat(ctx.locale);
  const { session } = ctx;

  switch (topic) {
    case "greeting":
      return { name: ctx.name || "citizen" };
    case "tower":
      return { floors: f.plural(TOWER.floors, "floor", "floors"), apartments: f.plural(TOWER.apartments, "apartment", "apartments"), chain: TOWER.chain };
    case "travel":
    case "help":
    case "unknown":
      return {};
  }

  if (topic === "wallet" || topic === "my_plots" || topic === "buy_land" || topic === "earn") {
    if (!session) return null;
    const w = await fetchWallet(session);
    if (!w.ok) return null;
    const p = w.data.params ?? {};
    const bp = p.income_bp_per_day;
    const pending = w.data.plots.reduce((s, x) => s + x.pending, 0);
    const plots = f.plural(w.data.plots.length, "plot", "plots", "no plots");
    if (topic === "wallet") return { balance: f.tide(w.data.balance), locked: f.tide(w.data.locked), pending: f.tide(pending), plots };
    if (p.max_plots_per_citizen === undefined || bp === undefined || p.income_cap_days === undefined) return null;
    const maxPlots = f.plural(p.max_plots_per_citizen, "plot", "plots");
    if (topic === "my_plots") {
      const daily = w.data.plots.reduce((s, x) => s + dailyIncome(x.pricePaid, bp), 0);
      const first = [...w.data.plots].sort((a, b) => a.boughtAt.localeCompare(b.boughtAt))[0];
      return {
        plots,
        daily_income: f.tide(daily),
        pending: f.tide(pending),
        max_plots: maxPlots,
        first_plot: first ? `${first.address}, ${first.district}` : "none yet",
      };
    }
    if (p.welcome_grant === undefined) return null;
    const income = { income_pct: f.bp(bp), cap_days: f.plural(p.income_cap_days, "day", "days"), welcome: f.tide(p.welcome_grant) };
    if (topic === "earn") {
      if (p.transfer_fee_bp === undefined) return null;
      return { ...income, transfer_fee_pct: f.bp(p.transfer_fee_bp) };
    }
    const land = await fetchLand(session);
    if (!land.ok) return null;
    return { ...income, max_plots: maxPlots, for_sale: f.plural(Math.max(0, land.data.catalog - land.data.owned.length), "plot", "plots") };
  }

  const st = await fetchState();
  if (!st.ok) return null;
  const s = st.data;
  const taxes = () => {
    const sales = param(s, "sales_tax_pct");
    const land = param(s, "land_tax_pct");
    return sales === undefined || land === undefined ? null : { sales_tax_pct: f.pct(sales), land_tax_pct: f.pct(land) };
  };

  switch (topic) {
    case "about_nics":
    case "council": {
      const ai = s.council.members.find((m) => m.kind === "ai");
      const founder = s.council.members.find((m) => m.kind === "human" && m.title === "Founder");
      if (!ai) return null;
      const total = f.plural(s.council.seats, "seat", "seats");
      if (topic === "about_nics") return { seat: f.n(ai.seat), seats_total: total, council: "Council of First Light" };
      if (!founder) return null;
      return {
        seats_total: total,
        seats_filled: f.n(s.council.filled),
        votes_needed: f.plural(s.council.need, "vote", "votes"),
        nics_seat: f.n(ai.seat),
        founder_seat: f.n(founder.seat),
      };
    }
    case "treasury":
    case "laws": {
      const l = await fetchLaws();
      const t = taxes();
      if (!l.ok || !t) return null;
      if (topic === "treasury") {
        const allocated = l.data.budget.reduce((sum, b) => sum + b.allocated, 0);
        return { ...t, treasury: f.tide(s.treasury), budget_lines: f.plural(l.data.budget.length, "budget line", "budget lines", "none"), budget_allocated: f.tide(allocated) };
      }
      const inForce = l.data.laws.filter((x) => x.inForce).sort((a, b) => b.enactedAt.localeCompare(a.enactedAt));
      return { ...t, laws_in_force: f.plural(inForce.length, "law", "laws", "no laws"), latest_law: inForce[0]?.title ?? "none" };
    }
    case "elections": {
      const e = await fetchProposals(session, "elections");
      const mayorAt = param(s, "mayor_residents");
      const seatAt = param(s, "district_seat_residents");
      if (!e.ok || mayorAt === undefined || seatAt === undefined) return null;
      const open = e.data.proposals.filter((p) => p.status === "voting" || p.status === "signatures").length;
      return {
        open_elections: f.plural(open, "election", "elections", "no elections"),
        residents: f.plural(s.residents, "resident", "residents"),
        assembly_seated: f.n(s.assembly.seated),
        assembly_total: f.n(s.assembly.total),
        mayor_at: f.plural(mayorAt, "resident", "residents"),
        seat_at: f.plural(seatAt, "resident", "residents"),
      };
    }
    case "vote":
    case "home": {
      if (!session) return null;
      const c = await fetchCivic(session);
      if (!c.ok) return null;
      if (topic === "vote") {
        return {
          to_vote: c.data.toVote === 0 ? "nothing" : c.data.toVote === 1 ? "1 vote is" : `${f.n(c.data.toVote)} votes are`,
          open_proposals: f.plural(s.open, "proposal", "proposals", "none"),
          signatures_needed: f.plural(s.signaturesNeeded, "signature", "signatures"),
        };
      }
      const days = param(s, "residence_change_days");
      if (!c.data.home || days === undefined) return null;
      const canMove = !c.data.home.canMoveAt || new Date(c.data.home.canMoveAt).getTime() <= Date.now();
      return { home_district: c.data.home.name, can_move: canMove ? "now" : f.date(c.data.home.canMoveAt!), move_days: f.plural(days, "day", "days") };
    }
  }
  return null;
};
