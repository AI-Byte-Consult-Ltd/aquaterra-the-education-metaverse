import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "@/game/account/AccountContext";
import { fetchDistricts, fetchState, propose, type Kind, type Post } from "@/game/state/api";
import { Shell, useLoad, useStateT } from "@/game/state/ui";

const KINDS: Kind[] = ["resolution", "set_param", "budget", "building", "skyscraper", "new_district", "district_merge", "district_split", "strategy", "charter", "appoint_director", "dismiss"];
const POSTS: Post[] = ["president", "treasury", "works", "civic"];

const input = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-primary";

/** Write a proposal. The server checks every field again and decides whether it needs signatures. */
const ProposePage = () => {
  const { t } = useStateT();
  const { session, signOut } = useAccount();
  const navigate = useNavigate();
  const state = useLoad(fetchState, []);
  const districts = useLoad(fetchDistricts, []);
  const [kind, setKind] = useState<Kind>("resolution");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((o) => ({ ...o, [k]: e.target.value }));
  const ds = districts.data?.districts ?? [];
  const params = state.data?.params ?? [];
  const param = params.find((p) => p.key === f.key);

  const payload = (): Record<string, unknown> => {
    switch (kind) {
      case "set_param": return { key: f.key, value: f.value };
      case "budget": return { amount: f.amount, ...(f.district ? { district: f.district } : {}) };
      case "building":
      case "skyscraper": return { district: f.district, address: f.address, floors: f.floors };
      case "new_district": return { name: f.name, land: f.land, climate: f.climate };
      case "district_merge": return { district: f.district, into: f.into, name: f.name };
      case "district_split": return { district: f.district };
      case "appoint_director": return { post: f.post, name: f.name };
      case "dismiss":
        return f.office === "director" ? { office: "director", post: f.post } : f.office === "mayor" ? { office: "mayor", district: f.district } : { office: f.office, seat: f.seat };
      default: return {};
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setBusy(true);
    const r = await propose(session, kind, title, body, payload());
    setBusy(false);
    if (r.ok) navigate(`/state/p/${r.data.proposal.id}`);
    else if (r.error === "session") signOut();
    else toast.error(t.errors[r.error]);
  };

  const districtSelect = (k: string, label: string, only?: (d: (typeof ds)[number]) => boolean) => (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select value={f[k] ?? ""} onChange={set(k)} className={input}>
        <option value="">{t.chooseDistrict}</option>
        {ds.filter(only ?? (() => true)).map((d) => <option key={d.id} value={d.id}>{d.name} · {d.land}</option>)}
      </select>
    </label>
  );
  const text = (k: string, label: string, type = "text", extra: Record<string, unknown> = {}) => (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input type={type} value={f[k] ?? ""} onChange={set(k)} className={input} {...extra} />
    </label>
  );

  return (
    <Shell title={t.proposeTitle} icon={Plus} back={{ to: "/state", label: t.backToState }} accent="text-primary">
      {state.data && <p className="mb-5 max-w-2xl text-sm text-muted-foreground">{t.proposeIntro(state.data.signaturesNeeded)}</p>}
      <form onSubmit={submit} className="max-w-2xl space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t.kindLabel}</span>
          <select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setF({}); }} className={input}>
            {KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
          </select>
          <span className="block text-xs text-muted-foreground">{t.kindHelp[kind]}</span>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t.titleLabel}</span>
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={input} required minLength={5} />
        </label>

        {kind === "set_param" && (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">{t.paramLabel}</span>
              <select value={f.key ?? ""} onChange={set("key")} className={input}>
                <option value="">…</option>
                {params.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            {param && text("value", `${t.valueLabel} (${t.current(param.value, param.min, param.max)})`, "number", { min: param.min, max: param.max, step: "any" })}
          </>
        )}
        {kind === "budget" && (<>{text("amount", t.amountLabel, "number", { min: 1, step: 1 })}{districtSelect("district", `${t.districtLabel} (optional)`)}</>)}
        {(kind === "building" || kind === "skyscraper") && (
          <>{districtSelect("district", t.districtLabel)}{text("address", t.addressLabel)}{text("floors", t.floorsLabel, "number", kind === "building" ? { min: 11, max: 39 } : { min: 40, max: 1200 })}</>
        )}
        {kind === "new_district" && (<>{text("name", t.districtNameLabel)}{text("land", t.landLabel)}{text("climate", t.climateLabel)}</>)}
        {kind === "district_merge" && (
          <>{districtSelect("district", t.districtLabel, (d) => !d.governedBy)}{districtSelect("into", t.intoLabel, (d) => !d.governedBy)}{text("name", t.newNameLabel)}</>
        )}
        {kind === "district_split" && districtSelect("district", t.districtLabel, (d) => !!d.governedBy)}
        {kind === "appoint_director" && (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">{t.postLabel}</span>
              <select value={f.post ?? ""} onChange={set("post")} className={input}>
                <option value="">…</option>
                {POSTS.map((p) => <option key={p} value={p}>{t.posts[p]}</option>)}
              </select>
            </label>
            {text("name", t.citizenLabel)}
          </>
        )}
        {kind === "dismiss" && (
          <>
            <label className="block space-y-1 text-sm">
              <span className="text-muted-foreground">{t.officeLabel}</span>
              <select value={f.office ?? ""} onChange={set("office")} className={input}>
                <option value="">…</option>
                <option value="director">{t.chambers.directorate}</option>
                <option value="mayor">{t.mayor}</option>
                <option value="councillor">{t.chambers.council}</option>
                <option value="deputy">{t.deputy}</option>
              </select>
            </label>
            {f.office === "director" && (
              <select value={f.post ?? ""} onChange={set("post")} className={input}>
                <option value="">…</option>
                {POSTS.map((p) => <option key={p} value={p}>{t.posts[p]}</option>)}
              </select>
            )}
            {f.office === "mayor" && districtSelect("district", t.districtLabel, (d) => !!d.mayor)}
            {(f.office === "councillor" || f.office === "deputy") && text("seat", t.seatLabel, "number", { min: 1 })}
          </>
        )}

        <label className="block space-y-1 text-sm">
          <span className="text-muted-foreground">{t.bodyLabel}</span>
          <textarea value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} rows={6} className="w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus:border-primary" />
        </label>
        <button disabled={busy} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? t.submitting : t.submit}
        </button>
      </form>
    </Shell>
  );
};

export default ProposePage;
