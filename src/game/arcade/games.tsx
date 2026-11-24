/*
 * The five arcade games. Each one only plays: the server built the round,
 * keeps the answers and scores what the player sends at the end.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Gem, Sparkles } from "lucide-react";
import { pickCell, type CrystalsGame, type MazeGame, type QuizGame, type RaceGame, type RangeGame, type Run } from "./api";
import type { ArcadeStrings } from "./strings";

export type Play = { answers?: number[]; path?: string; hits?: [number, number][]; switches?: [number, number][] };

export interface GameProps {
  run: Run;
  session: string;
  t: ArcadeStrings;
  /** The player is done (or time ran out): send this to the server. */
  onFinish: (play: Play) => void;
  onError: (e: string) => void;
}

/** Seconds left until a moment, ticking. */
function useSecondsLeft(until: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250);
    return () => window.clearInterval(id);
  }, [until]);
  return left;
}

/** 3, 2, 1 before a fast game starts, so the player can get ready. */
function useCountdown(from = 3) {
  const [n, setN] = useState(from);
  useEffect(() => {
    if (n <= 0) return;
    const id = window.setTimeout(() => setN(n - 1), 800);
    return () => window.clearTimeout(id);
  }, [n]);
  return n;
}

const Countdown = ({ n }: { n: number }) =>
  n > 0 ? (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/40">
      <span key={n} className="animate-in zoom-in-50 font-display text-7xl font-bold text-fuchsia-200 drop-shadow-[0_0_20px_rgba(255,92,210,0.8)]">{n}</span>
    </div>
  ) : null;

const Bar = ({ left, total }: { left: number; total: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
    <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-cyan-300 transition-all" style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} />
  </div>
);

// ------------------------------------------------------------------- quiz --

export function QuizPlay({ run, t, onFinish }: GameProps) {
  const g = run.game as QuizGame;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [until, setUntil] = useState(() => Date.now() + g.secondsEach * 1000);
  const left = useSecondsLeft(until);
  const done = useRef(false);

  const answer = useCallback(
    (k: number) => {
      if (done.current) return;
      setChosen(k);
      const next = [...answers, k];
      window.setTimeout(() => {
        setChosen(null);
        if (next.length >= g.questions.length) {
          done.current = true;
          onFinish({ answers: next });
        } else {
          setAnswers(next);
          setI(next.length);
          setUntil(Date.now() + g.secondsEach * 1000);
        }
      }, 280);
    },
    [answers, g, onFinish],
  );
  useEffect(() => {
    if (left === 0 && chosen === null) answer(-1);
  }, [left, chosen, answer]);

  const q = g.questions[i];
  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t.questionOf(i + 1, g.questions.length)}</span>
        <span className={left <= 5 ? "font-bold text-rose-300" : ""}>{t.timeLeft(left)}</span>
      </div>
      <Bar left={left} total={g.secondsEach} />
      <h2 className="min-h-[3.5rem] font-display text-xl font-bold md:text-2xl">{q.q}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {q.options.map((o, k) => (
          <button
            key={k}
            disabled={chosen !== null}
            onClick={() => answer(k)}
            className={`min-h-[3.25rem] rounded-lg border px-4 py-3 text-left text-sm font-medium transition ${chosen === k ? "border-cyan-300 bg-cyan-400/20" : "border-border bg-card/60 hover:border-fuchsia-300 hover:bg-fuchsia-400/10"}`}
          >
            <span className="mr-2 font-bold text-fuchsia-300">{"ABCD"[k]}</span>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- crystals --

export function CrystalsPlay({ run, session, t, onFinish, onError }: GameProps) {
  const g = run.game as CrystalsGame;
  const [cells, setCells] = useState<Map<number, { hit: boolean; near: number | null }>>(new Map());
  const [found, setFound] = useState(0);
  const [picksLeft, setPicksLeft] = useState(g.picks);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ hit: boolean; near: number | null } | null>(null);
  const until = useRef(Date.now() + g.seconds * 1000).current;
  const left = useSecondsLeft(until);
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish({});
  }, [onFinish]);
  useEffect(() => {
    if (left === 0) finish();
  }, [left, finish]);

  const dig = async (c: number) => {
    if (busy || cells.has(c) || done.current) return;
    setBusy(true);
    const r = await pickCell(session, run.run, c);
    setBusy(false);
    if (!r.ok) {
      if (r.error === "done") finish();
      else onError(r.error);
      return;
    }
    setCells((m) => new Map(m).set(c, { hit: r.data.hit, near: r.data.near }));
    setLast({ hit: r.data.hit, near: r.data.near });
    setFound(r.data.found);
    setPicksLeft(r.data.picksLeft);
    if (r.data.picksLeft <= 0 || r.data.found >= g.crystals) window.setTimeout(finish, 600);
  };

  const heat = (d: number | null) => (d === null ? "" : d <= 1 ? "bg-orange-500/50 text-orange-50" : d === 2 ? "bg-amber-500/35 text-amber-50" : d === 3 ? "bg-sky-500/30 text-sky-50" : "bg-indigo-500/25 text-indigo-100");
  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-cyan-200">{t.found(found, g.crystals)}</span>
        <span className="text-muted-foreground">{t.digsLeft(picksLeft)} · {t.timeLeft(left)}</span>
      </div>
      <div className="grid gap-1 rounded-xl border border-border bg-[radial-gradient(circle_at_30%_20%,rgba(120,80,200,0.25),transparent_60%),linear-gradient(180deg,#1b1430,#0d0a1c)] p-2" style={{ gridTemplateColumns: `repeat(${g.size}, minmax(0, 1fr))` }}>
        {Array.from({ length: g.size * g.size }, (_, c) => {
          const s = cells.get(c);
          return (
            <button
              key={c}
              aria-label={`cell ${c + 1}`}
              onClick={() => void dig(c)}
              disabled={!!s || busy}
              className={`flex aspect-square items-center justify-center rounded-md border text-xs font-bold transition ${
                s ? (s.hit ? "border-cyan-200 bg-cyan-300/30" : `border-transparent ${heat(s.near)}`) : "border-white/10 bg-white/5 hover:border-fuchsia-300/70 hover:bg-fuchsia-400/10"
              }`}
            >
              {s?.hit ? <Gem className="h-1/2 w-1/2 text-cyan-100 drop-shadow-[0_0_6px_rgba(120,240,255,0.9)]" /> : s ? s.near : ""}
            </button>
          );
        })}
      </div>
      <p className="min-h-[1.25rem] text-center text-sm text-muted-foreground">{last ? (last.hit ? "✦" : last.near !== null ? t.near(last.near) : "") : t.controls.crystals}</p>
    </div>
  );
}

// ------------------------------------------------------------------- maze --

export function MazePlay({ run, t, onFinish }: GameProps) {
  const g = run.game as MazeGame;
  const n = g.size;
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [trail, setTrail] = useState<Set<number>>(new Set([0]));
  const path = useRef("");
  const until = useRef(Date.now() + g.seconds * 1000).current;
  const left = useSecondsLeft(until);
  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish({ path: path.current });
  }, [onFinish]);
  useEffect(() => {
    if (left === 0) finish();
  }, [left, finish]);

  const step = useCallback(
    (d: "U" | "R" | "D" | "L") => {
      if (done.current) return;
      setPos((p) => {
        const c = g.cells[p.y * n + p.x];
        const bit = { U: 1, R: 2, D: 4, L: 8 }[d];
        if (!(c & bit)) return p;
        const q = { x: p.x + (d === "R" ? 1 : d === "L" ? -1 : 0), y: p.y + (d === "D" ? 1 : d === "U" ? -1 : 0) };
        path.current += d;
        setTrail((s) => new Set(s).add(q.y * n + q.x));
        if (q.x === n - 1 && q.y === n - 1) window.setTimeout(finish, 150);
        return q;
      });
    },
    [g, n, finish],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const m: Record<string, "U" | "R" | "D" | "L"> = { ArrowUp: "U", ArrowRight: "R", ArrowDown: "D", ArrowLeft: "L", w: "U", d: "R", s: "D", a: "L" };
      const d = m[e.key] ?? m[e.key.toLowerCase()];
      if (d) {
        e.preventDefault();
        step(d);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [step]);
  // swipe
  const touch = useRef<{ x: number; y: number } | null>(null);

  const wall = "2px solid rgba(255,120,220,0.85)";
  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t.controls.maze}</span>
        <span className={left <= 10 ? "font-bold text-rose-300" : ""}>{t.timeLeft(left)}</span>
      </div>
      <Bar left={left} total={g.seconds} />
      <div
        className="grid touch-none select-none rounded-lg bg-[#0b0f26] p-1 shadow-[0_0_30px_rgba(255,80,200,0.2)]"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const s = touch.current;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
          step(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U");
        }}
      >
        {g.cells.map((c, i) => {
          const x = i % n;
          const y = (i / n) | 0;
          const me = pos.x === x && pos.y === y;
          const exit = x === n - 1 && y === n - 1;
          return (
            <div
              key={i}
              className={`relative aspect-square ${trail.has(i) ? "bg-fuchsia-500/15" : ""}`}
              style={{ borderTop: c & 1 ? undefined : wall, borderRight: c & 2 ? undefined : wall, borderBottom: c & 4 ? undefined : wall, borderLeft: c & 8 ? undefined : wall }}
            >
              {exit && <Sparkles className="absolute inset-[18%] h-[64%] w-[64%] animate-pulse text-cyan-200" />}
              {me && <span className="absolute inset-[22%] rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(120,240,255,1)]" />}
            </div>
          );
        })}
      </div>
      <div className="mx-auto grid w-36 grid-cols-3 gap-1 md:hidden">
        <span />
        <PadButton onClick={() => step("U")} icon={ArrowUp} />
        <span />
        <PadButton onClick={() => step("L")} icon={ArrowLeft} />
        <PadButton onClick={() => step("D")} icon={ArrowDown} />
        <PadButton onClick={() => step("R")} icon={ArrowRight} />
      </div>
    </div>
  );
}

const PadButton = ({ onClick, icon: Icon }: { onClick: () => void; icon: typeof ArrowUp }) => (
  <button onClick={onClick} className="flex h-11 items-center justify-center rounded-md border border-border bg-card/70 active:bg-fuchsia-400/20">
    <Icon className="h-5 w-5" />
  </button>
);

// ------------------------------------------------------------------ range --

export function RangePlay({ run, t, onFinish }: GameProps) {
  const g = run.game as RangeGame;
  const count = useCountdown();
  const t0 = useRef(performance.now());
  const hits = useRef<[number, number][]>([]);
  const [hitIds, setHitIds] = useState<Set<number>>(new Set());
  const [now, setNow] = useState(0);
  const done = useRef(false);
  useEffect(() => {
    if (count > 0) return;
    t0.current = performance.now();
    let raf = 0;
    const loop = () => {
      const ms = performance.now() - t0.current;
      setNow(ms);
      if (ms > g.duration + 300) {
        if (!done.current) {
          done.current = true;
          onFinish({ hits: hits.current });
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [g, onFinish, count]);
  const hit = (id: number) => {
    const ms = Math.round(performance.now() - t0.current);
    if (hitIds.has(id)) return;
    hits.current.push([id, ms]);
    setHitIds((s) => new Set(s).add(id));
  };
  const live = count > 0 ? [] : g.schedule.filter((x) => now >= x.t && now <= x.t + g.window && !hitIds.has(x.id));
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-cyan-200">{t.hits(hitIds.size, g.targets)}</span>
        <span className="text-muted-foreground">{t.timeLeft(Math.max(0, Math.ceil((g.duration - (count > 0 ? 0 : now)) / 1000)))}</span>
      </div>
      <Bar left={g.duration - now} total={g.duration} />
      <div className="relative aspect-[4/3] w-full touch-none select-none overflow-hidden rounded-xl border border-border bg-[radial-gradient(ellipse_at_center,#1a1f4a,#070816)]">
        <Countdown n={count} />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:40px_40px]" />
        {live.map((x) => {
          const life = 1 - (now - x.t) / g.window;
          return (
            <button
              key={x.id}
              aria-label="light"
              onPointerDown={(e) => {
                e.preventDefault();
                hit(x.id);
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ left: `${x.x * 100}%`, top: `${x.y * 100}%`, width: 64, height: 64 }}
            >
              <span className="absolute inset-0 rounded-full border-2 border-fuchsia-300" style={{ transform: `scale(${0.45 + 0.55 * life})`, opacity: 0.9 }} />
              <span className="absolute inset-[30%] rounded-full bg-cyan-200 shadow-[0_0_18px_6px_rgba(120,240,255,0.8)]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- race --

export function RacePlay({ run, t, onFinish }: GameProps) {
  const g = run.game as RaceGame;
  const count = useCountdown();
  const canvas = useRef<HTMLCanvasElement>(null);
  const lane = useRef(1);
  const switches = useRef<[number, number][]>([]);
  const t0 = useRef(performance.now());
  const started = useRef(false);
  const done = useRef(false);
  const [row, setRow] = useState(0);
  const rocks = useRef(new Map(g.rocks.map(([r, l]) => [r, new Set(l)]))).current;

  const steer = useCallback(
    (d: -1 | 1) => {
      if (done.current || started.current === false) return;
      const nl = lane.current + d;
      if (nl < 0 || nl > 2) return;
      // a turn takes effect on the next row, exactly as the server replays it
      const r = Math.floor((performance.now() - t0.current) / g.tick) + 1;
      const sw = switches.current;
      const last = sw[sw.length - 1];
      const before = sw.length > 1 ? sw[sw.length - 2][1] : 1;
      // a turn and its undo on the same row cancel out; the server takes no more switches than rows
      if (last && last[0] === r && before === nl) sw.pop();
      else if (sw.length < g.rows) sw.push([r, nl]);
      else return;
      lane.current = nl;
    },
    [g.tick, g.rows],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") {
        e.preventDefault();
        steer(-1);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") {
        e.preventDefault();
        steer(1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [steer]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let checked = -1;
    let shown = lane.current;
    if (count === 0) {
      t0.current = performance.now();
      started.current = true;
    }
    const loop = () => {
      // during the countdown the course stands still at its start
      const ms = started.current ? performance.now() - t0.current : 0;
      const pos = ms / g.tick;
      const cur = Math.floor(pos);
      // check each row once, when the boat enters it
      while (started.current && checked < cur && checked < g.rows - 1 && !done.current) {
        checked++;
        const laneAt = laneOn(switches.current, checked);
        if (rocks.get(checked)?.has(laneAt)) {
          done.current = true;
          onFinish({ switches: switches.current });
        }
      }
      if (started.current && !done.current && cur >= g.rows) {
        done.current = true;
        onFinish({ switches: switches.current });
      }
      setRow(Math.min(cur, g.rows));
      // draw
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sea = ctx.createLinearGradient(0, 0, 0, H);
      sea.addColorStop(0, "#08304f");
      sea.addColorStop(1, "#0a5d7a");
      ctx.fillStyle = sea;
      ctx.fillRect(0, 0, W, H);
      const lw = W / 3;
      const rh = Math.max(28, H / 9);
      const boatY = H - rh * 1.4;
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.setLineDash([10, 14]);
      for (let l = 1; l < 3; l++) {
        ctx.beginPath();
        ctx.moveTo(l * lw, 0);
        ctx.lineTo(l * lw, H);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // waves
      ctx.strokeStyle = "rgba(170,240,255,0.16)";
      for (let k = -1; k < H / 30 + 1; k++) {
        const y = ((k * 30 + (pos * rh) % 30) + 30) % (H + 30);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, y + Math.sin(x / 26 + k) * 3);
        ctx.stroke();
      }
      // rocks ahead
      for (let r = Math.max(0, cur - 2); r < Math.min(g.rows, cur + Math.ceil(H / rh) + 2); r++) {
        const y = boatY - (r - pos) * rh;
        const set = rocks.get(r);
        if (set)
          for (const l of set) {
            const cx = l * lw + lw / 2;
            ctx.fillStyle = "#3a4152";
            ctx.beginPath();
            ctx.ellipse(cx, y, lw * 0.3, rh * 0.36, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#59617a";
            ctx.beginPath();
            ctx.ellipse(cx - lw * 0.06, y - rh * 0.08, lw * 0.16, rh * 0.18, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,255,255,0.35)";
            ctx.beginPath();
            ctx.ellipse(cx, y + rh * 0.1, lw * 0.36, rh * 0.42, 0, 0.2, Math.PI - 0.2);
            ctx.stroke();
          }
        if (r === g.rows - 1) {
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          for (let x = 0; x < W; x += 16) ctx.fillRect(x, y - rh / 2 - 6, 8, 6);
        }
      }
      // boat glides to its lane
      shown += (lane.current - shown) * 0.35;
      const bx = shown * lw + lw / 2;
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.moveTo(bx - lw * 0.12, boatY + rh * 0.45);
      ctx.lineTo(bx, boatY + rh * 1.2);
      ctx.lineTo(bx + lw * 0.12, boatY + rh * 0.45);
      ctx.fill();
      ctx.fillStyle = "#ff5cd2";
      ctx.beginPath();
      ctx.moveTo(bx, boatY - rh * 0.55);
      ctx.quadraticCurveTo(bx + lw * 0.18, boatY, bx + lw * 0.12, boatY + rh * 0.45);
      ctx.lineTo(bx - lw * 0.12, boatY + rh * 0.45);
      ctx.quadraticCurveTo(bx - lw * 0.18, boatY, bx, boatY - rh * 0.55);
      ctx.fill();
      ctx.fillStyle = "#8ff3ff";
      ctx.fillRect(bx - lw * 0.04, boatY - rh * 0.1, lw * 0.08, rh * 0.25);
      if (!done.current) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [g, rocks, onFinish, count]);

  return (
    <div className="mx-auto w-full max-w-md space-y-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{t.controls.race}</span>
        <span className="font-semibold text-cyan-200">
          {row} / {g.rows}
        </span>
      </div>
      <div className="relative">
        <canvas ref={canvas} className="h-[60vh] max-h-[560px] w-full rounded-xl border border-border" />
        <Countdown n={count} />
        <button aria-label="left" onPointerDown={() => steer(-1)} className="absolute inset-y-0 left-0 w-1/2" />
        <button aria-label="right" onPointerDown={() => steer(1)} className="absolute inset-y-0 right-0 w-1/2" />
      </div>
    </div>
  );
}

/** Lane on a row after the turns made so far, the way the server replays them. */
function laneOn(sw: [number, number][], row: number) {
  let lane = 1;
  for (const [r, l] of sw) {
    if (r > row) break;
    if (Math.abs(l - lane) === 1) lane = l;
  }
  return lane;
}

export const GAMES = { quiz: QuizPlay, crystals: CrystalsPlay, maze: MazePlay, range: RangePlay, race: RacePlay } as const;
