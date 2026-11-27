// n8n "[66 PUBLIC] AquaTerra NICS Dialog", node "Validate NICS". Keep in sync with the workflow.
// NICS AI dialogs and the ideas board. The browser sends JSON as text/plain. All rules live in the SQL
// functions aquaterra_nics() / aquaterra_nics_ideas(). The resident's text is data: only stored and shown, never an instruction.
let b = $input.first().json.body || {};
if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
if (!b || typeof b !== 'object' || Array.isArray(b)) b = {};
const actions = ['status', 'consent', 'set_consent', 'forget', 'log', 'rate', 'ask', 'answer', 'export',
  'ideas', 'idea_submit', 'idea_support', 'idea_withdraw', 'idea_decide', 'ideas_export'];
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').slice(0, n);
const facts = {};
if (b.facts && typeof b.facts === 'object' && !Array.isArray(b.facts)) {
  for (const [k, v] of Object.entries(b.facts).slice(0, 30)) {
    if (/^[a-z_]{1,32}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) facts[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
}
const req = {
  action: actions.includes(b.action) ? b.action : 'invalid',
  session: String(b.session || '').replace(/[^a-f0-9]/g, '').slice(0, 64),
  lang: str(b.lang, 5),
  qtype: str(b.qtype, 20),
  question: str(b.question, 500),
  answer: str(b.answer, 800),
  source: str(b.source, 10),
  facts,
  id: b.id === undefined ? null : str(b.id, 20),
  rating: b.rating === undefined ? null : str(b.rating, 2),
  key: str(b.key, 80),
  after: b.after === undefined ? null : str(b.after, 20),
  limit: b.limit === undefined ? null : str(b.limit, 5),
  title: str(b.title, 120),
  body: str(b.body, 1600),
  category: str(b.category, 20),
  status: str(b.status, 12),
  note: str(b.note, 400),
};
if (typeof b.consent === 'boolean') req.consent = b.consent;
if (req.id !== null && !/^\d{1,18}$/.test(req.id)) req.id = null;
if (req.after !== null && !/^\d{1,18}$/.test(req.after)) req.after = null;
if (req.limit !== null && !/^\d{1,5}$/.test(req.limit)) req.limit = null;
return [{ json: { req: JSON.stringify(req) } }];
