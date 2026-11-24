import { Link } from "react-router-dom";
import { Coins } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";
import { useEconomy } from "./EconomyContext";
import { economyStrings } from "./strings";

/** Balance in the header; opens the wallet. */
const TideChip = ({ className = "" }: { className?: string }) => {
  const { language } = useLanguage();
  const t = economyStrings(language);
  const { wallet } = useEconomy();
  const pending = wallet?.plots.reduce((s, p) => s + p.pending, 0) ?? 0;
  return (
    <Link
      to="/wallet"
      title={t.walletTitle}
      aria-label={t.walletTitle}
      className={`relative flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/50 bg-cyan-400/10 px-2.5 text-sm font-semibold text-cyan-200 hover:border-cyan-300 ${className}`}
    >
      <Coins className="h-4 w-4 text-cyan-300" />
      <span className="tabular-nums">{wallet ? wallet.balance.toLocaleString("en") : "…"}</span>
      <span className="hidden text-[11px] font-medium text-cyan-300/80 sm:inline">{t.ticker}</span>
      {pending > 0 && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-background" />}
    </Link>
  );
};

export default TideChip;
