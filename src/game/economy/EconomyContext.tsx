import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "@/game/account/AccountContext";
import { fetchLand, fetchWallet, type LandInfo, type Wallet } from "./api";

export interface PlotOwner {
  name: string;
  mine: boolean;
}

interface EconomyValue {
  wallet: Wallet | null;
  /** Owned plots by id. Plots that are not in the map are free. */
  owners: Map<number, PlotOwner>;
  /** Plots the server sells (land registry size), 0 until loaded. */
  catalog: number;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const EconomyContext = createContext<EconomyValue | null>(null);

const toOwners = (land: LandInfo | null) => new Map((land?.owned ?? []).map(([id, name, mine]) => [id, { name, mine }]));

/** The signed-in resident's wallet and the land registry, refreshed every minute. */
export const EconomyProvider = ({ children }: { children: ReactNode }) => {
  const { session, status, signOut } = useAccount();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [land, setLand] = useState<LandInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!session) {
      setWallet(null);
      return;
    }
    const [w, l] = await Promise.all([fetchWallet(session), fetchLand(session)]);
    if (w.ok) setWallet(w.data);
    else if (w.error === "session") signOut();
    if (l.ok) setLand(l.data);
    setLoaded(true);
  }, [session, signOut]);

  useEffect(() => {
    if (status !== "signed-in") {
      setWallet(null);
      return;
    }
    void refresh();
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [status, refresh]);

  const value = useMemo<EconomyValue>(
    () => ({ wallet, owners: toOwners(land), catalog: land?.catalog ?? 0, loaded, refresh }),
    [wallet, land, loaded, refresh],
  );
  return <EconomyContext.Provider value={value}>{children}</EconomyContext.Provider>;
};

export const useEconomy = () => {
  const ctx = useContext(EconomyContext);
  if (!ctx) throw new Error("useEconomy must be used within EconomyProvider");
  return ctx;
};
