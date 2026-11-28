import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAccount } from "@/game/account/AccountContext";
import { sendHit } from "./api";

/** Counts one page view per route change. No cookies, nothing stored in the browser. */
const VisitTracker = () => {
  const { pathname } = useLocation();
  const { session } = useAccount();
  useEffect(() => {
    const t = window.setTimeout(() => sendHit(pathname, session), 400);
    return () => window.clearTimeout(t);
    // the session only labels the view; a sign-in on the same page is not a new view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
};

export default VisitTracker;
