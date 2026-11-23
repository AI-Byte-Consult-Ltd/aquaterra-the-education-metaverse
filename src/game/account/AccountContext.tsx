import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { endSession, fetchMe, readStored, STORAGE_EVENT_KEY, writeStored, type Player, type StoredAccount } from "./api";

type Status = "checking" | "guest" | "signed-in";

interface AccountContextValue {
  status: Status;
  player: Player | null;
  session: string | null;
  signIn: (a: StoredAccount) => void;
  updatePlayer: (p: Player) => void;
  signOut: () => void;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export const AccountProvider = ({ children }: { children: ReactNode }) => {
  const [account, setAccount] = useState<StoredAccount | null>(readStored);
  // A stored session is trusted for display right away and confirmed with the server in the background.
  const [status, setStatus] = useState<Status>(() => (readStored() ? "checking" : "guest"));

  const apply = useCallback((a: StoredAccount | null) => {
    writeStored(a);
    setAccount(a);
    setStatus(a ? "signed-in" : "guest");
  }, []);

  useEffect(() => {
    const stored = readStored();
    if (!stored) return;
    let cancelled = false;
    fetchMe(stored.session).then((r) => {
      if (cancelled) return;
      if (r.ok) apply({ session: stored.session, player: r.data.player });
      else if (r.error === "session") apply(null);
      // Network trouble: keep the stored session, the server checks it again on the next visit.
      else setStatus("signed-in");
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_EVENT_KEY) return;
      const a = readStored();
      setAccount(a);
      setStatus(a ? "signed-in" : "guest");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<AccountContextValue>(
    () => ({
      status,
      player: account?.player ?? null,
      session: account?.session ?? null,
      signIn: apply,
      updatePlayer: (p) => account && apply({ session: account.session, player: p }),
      signOut: () => {
        if (account) void endSession(account.session);
        apply(null);
      },
    }),
    [status, account, apply],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};

export const useAccount = () => {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
};
