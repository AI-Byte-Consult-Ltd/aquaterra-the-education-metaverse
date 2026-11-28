-- AquaTerra visitor counter: no cookies, no IP stored. One-off migration, safe to run twice.
-- API: aquaterra_visits(req) behind n8n "[76 PUBLIC] AquaTerra Visits" (POST /webhook/aquaterra-visits).
--   hit   : one page view. The browser sends path, referrer host, utm source, time zone, language, device.
--           n8n adds ip + user agent only to build the daily visitor key; neither is stored.
--   stats : founder/admin only. Day / 7 days / 30 days, 14-day series, top pages, sources, time zones, devices.
-- Visitor key = md5(salt | day | ip | ua): the same person counts once per day, and keys of different days
-- cannot be linked to each other or back to the IP.

CREATE TABLE IF NOT EXISTS aquaterra_visit_salt (id int PRIMARY KEY DEFAULT 1 CHECK (id = 1), salt text NOT NULL);
INSERT INTO aquaterra_visit_salt (id, salt) VALUES (1, md5(random()::text || clock_timestamp()::text))
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS aquaterra_visits (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  visitor text NOT NULL,
  path text NOT NULL,
  ref text,          -- referrer host of the first page in a visit (null = direct / own site)
  src text,          -- utm_source
  tz text,           -- browser time zone, e.g. Europe/Sofia (country hint without IP lookup)
  lang text,         -- browser language, e.g. ru
  device text,       -- mobile | tablet | desktop
  resident boolean NOT NULL DEFAULT false,  -- signed in at the moment
  own boolean NOT NULL DEFAULT false        -- founder, admin or Council member: shown apart
);
CREATE INDEX IF NOT EXISTS aquaterra_visits_day ON aquaterra_visits (day);

CREATE OR REPLACE FUNCTION aquaterra_visits(req jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  me text; my_role text; is_own boolean := false; v text; d date := (now() AT TIME ZONE 'UTC')::date;
  res jsonb;
BEGIN
  IF coalesce(req->>'session', '') <> '' THEN
    SELECT s.email, p.role INTO me, my_role FROM aquaterra_sessions s JOIN aquaterra_players p ON p.email = s.email
    WHERE s.token_hash = encode(sha256(convert_to(req->>'session', 'UTF8')), 'hex') AND s.expires_at > now();
  END IF;

  IF req->>'action' = 'hit' THEN
    IF me IS NOT NULL THEN
      is_own := my_role IN ('founder', 'admin') OR EXISTS (SELECT 1 FROM aquaterra_council c WHERE c.email = me);
    END IF;
    SELECT md5(s.salt || '|' || d || '|' || coalesce(req->>'ip', '') || '|' || coalesce(req->>'ua', ''))
      INTO v FROM aquaterra_visit_salt s;
    -- a runaway tab or a script: at most 300 views per visitor per day
    IF (SELECT count(*) FROM aquaterra_visits WHERE day = d AND visitor = v) >= 300 THEN
      RETURN jsonb_build_object('ok', true);
    END IF;
    INSERT INTO aquaterra_visits (day, visitor, path, ref, src, tz, lang, device, resident, own)
    VALUES (d, v, left(coalesce(nullif(req->>'path', ''), '/'), 120), nullif(left(req->>'ref', 80), ''),
            nullif(left(req->>'src', 40), ''), nullif(left(req->>'tz', 40), ''), nullif(left(req->>'lang', 12), ''),
            CASE WHEN req->>'device' IN ('mobile', 'tablet', 'desktop') THEN req->>'device' END,
            me IS NOT NULL, is_own);
    RETURN jsonb_build_object('ok', true);
  END IF;

  IF req->>'action' = 'stats' THEN
    IF me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'session', 'status', 401); END IF;
    IF my_role NOT IN ('founder', 'admin') THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'status', 403); END IF;
    -- a visitor key that was signed in as one of us that day is ours for the whole day
    WITH x AS (SELECT * FROM aquaterra_visits a WHERE a.day > d - 30
               AND NOT EXISTS (SELECT 1 FROM aquaterra_visits o WHERE o.own AND o.day = a.day AND o.visitor = a.visitor)),
    w AS (SELECT * FROM x WHERE day > d - 7),
    per AS (SELECT n, jsonb_build_object('views', count(x.id), 'visitors', count(DISTINCT visitor),
                     'residents', count(DISTINCT visitor) FILTER (WHERE resident)) AS j
            FROM (VALUES (1), (7), (30)) k(n) LEFT JOIN x ON x.day > d - k.n GROUP BY n),
    top AS (SELECT kind, jsonb_agg(jsonb_build_object('key', key, 'visitors', vis, 'views', views) ORDER BY vis DESC, views DESC) AS j
            FROM (SELECT kind, key, count(DISTINCT visitor) AS vis, count(*) AS views,
                         row_number() OVER (PARTITION BY kind ORDER BY count(DISTINCT visitor) DESC, count(*) DESC) AS rn
                  FROM (SELECT 'pages' AS kind, path AS key, visitor FROM w
                        UNION ALL (SELECT DISTINCT ON (visitor, day) 'sources', coalesce(src, ref, '(direct)'), visitor
                                   FROM w ORDER BY visitor, day, at)
                        UNION ALL SELECT 'zones', coalesce(tz, '(unknown)'), visitor FROM w
                        UNION ALL SELECT 'devices', coalesce(device, '(unknown)'), visitor FROM w
                        UNION ALL SELECT 'languages', coalesce(lang, '(unknown)'), visitor FROM w) u
                  GROUP BY kind, key) t
            WHERE rn <= 12 GROUP BY kind)
    SELECT jsonb_build_object('ok', true,
      'today', (SELECT j FROM per WHERE n = 1), 'week', (SELECT j FROM per WHERE n = 7), 'month', (SELECT j FROM per WHERE n = 30),
      'own_week', (SELECT count(*) FROM aquaterra_visits WHERE day > d - 7 AND own),
      'since', (SELECT min(at) FROM aquaterra_visits),
      'days', (SELECT jsonb_agg(jsonb_build_object('day', g::date, 'views', (SELECT count(*) FROM x WHERE x.day = g::date),
                 'visitors', (SELECT count(DISTINCT visitor) FROM x WHERE x.day = g::date)) ORDER BY g)
               FROM generate_series(d - 13, d, interval '1 day') g),
      'top', coalesce((SELECT jsonb_object_agg(kind, j) FROM top), '{}'::jsonb),
      'recent', coalesce((SELECT jsonb_agg(r ORDER BY r->>'at' DESC) FROM (
                  SELECT jsonb_build_object('at', at, 'path', path, 'source', coalesce(src, ref), 'tz', tz, 'device', device,
                           'resident', resident) AS r
                  FROM x ORDER BY at DESC LIMIT 25) q), '[]'::jsonb))
    INTO res;
    RETURN res;
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'invalid', 'status', 400);
END $fn$;
