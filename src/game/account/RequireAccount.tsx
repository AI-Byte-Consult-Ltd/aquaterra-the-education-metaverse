import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAccount } from "./AccountContext";

/**
 * Shows its children to signed-in players and sends guests to /login, then back
 * here. A stored session is shown at once while the server confirms it.
 */
const RequireAccount = ({ children }: { children: ReactNode }) => {
  const { status } = useAccount();
  const location = useLocation();
  if (status === "guest") {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
};

export default RequireAccount;
