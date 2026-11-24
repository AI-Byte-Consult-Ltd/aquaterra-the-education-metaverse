import { Crown } from "lucide-react";
import type { Player } from "./api";

/** Gold badge for Council of First Light members; nothing for ordinary citizens. */
const CouncilBadge = ({ player, label, className = "" }: { player: Player | null | undefined; label: (title: string) => string; className?: string }) => {
  if (!player?.council) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 ${className}`}
    >
      <Crown className="h-3 w-3" />
      {label(player.council.title)}
    </span>
  );
};

export default CouncilBadge;
