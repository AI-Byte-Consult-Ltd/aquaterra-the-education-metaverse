import { useEffect, useRef } from "react";
import { drawAvatar, type Avatar } from "./avatars";

/** A small live canvas with one avatar standing on a disc of light. */
const AvatarPreview = ({ avatar, size = 64, className = "" }: { avatar: Avatar; size?: number; className?: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const av = useRef(avatar);
  av.current = avatar;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = size * dpr;
    c.height = size * dpr;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const frame = (time: number) => {
      // scale so a figure (about 52 px tall at zoom 2) fills the box
      const zoom = 2;
      const fit = size / 72;
      ctx.setTransform(dpr * zoom * fit, 0, 0, dpr * zoom * fit, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawAvatar(ctx, size / (2 * zoom * fit), (size * 0.88) / (zoom * fit), zoom * fit, av.current, still ? 0 : time, { size: av.current.style === "drop" ? 0.72 : 1 });
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  useEffect(() => {
    // a still picture must redraw when the choice changes
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const z = (2 * size) / 72;
      ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawAvatar(ctx, size / (2 * z), (size * 0.88) / z, z, avatar, 0, { size: avatar.style === "drop" ? 0.72 : 1 });
    }
  }, [avatar, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} className={className} aria-hidden />;
};

export default AvatarPreview;
