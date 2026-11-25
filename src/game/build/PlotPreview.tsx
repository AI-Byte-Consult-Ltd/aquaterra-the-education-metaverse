import { useEffect, useRef } from "react";
import type { Plot, World } from "@/game/world/generator";
import type { Built } from "@/game/world/buildings";
import { WorldRenderer } from "@/game/world/renderer";

/**
 * A small 3D look at the selected plot for the map card: the plot raised above its
 * neighbours with its house, assets and vehicles. Drawn only while it changes.
 */
export default function PlotPreview({ world, plot, built, className = "" }: { world: World; plot: Plot; built: Map<number, Built>; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rRef = useRef<WorldRenderer | null>(null);
  const kick = useRef<() => void>(() => {});

  // one renderer for the card's lifetime: building it walks the whole world
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const r = new WorldRenderer(canvas, world, { tower: "First Light Tower" });
    rRef.current = r;
    let raf = 0;
    let until = 0;
    const loop = (time: number) => {
      r.draw(time);
      raf = time < until ? requestAnimationFrame(loop) : 0;
    };
    kick.current = () => {
      until = performance.now() + 700;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const size = () => {
      const rect = wrap.getBoundingClientRect();
      r.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
      kick.current();
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rRef.current = null;
    };
  }, [world]);

  useEffect(() => {
    const r = rRef.current;
    if (!r) return;
    r.selectedPlot = plot.id;
    r.focusTile(plot.anchor.x, plot.anchor.y, plot.tiles.length >= 12 ? 1.6 : plot.tiles.length >= 5 ? 2.2 : 3);
    // the plot sits a little below the middle, so its house has room above
    r.pan(0, 18);
    kick.current();
  }, [plot]);

  useEffect(() => {
    rRef.current?.setBuilt(built);
    kick.current();
  }, [built]);

  return (
    <div ref={wrapRef} className={`relative overflow-hidden rounded-lg bg-[#0b1622] ${className}`}>
      <canvas ref={canvasRef} className="pointer-events-none h-full w-full" aria-hidden="true" />
    </div>
  );
}
