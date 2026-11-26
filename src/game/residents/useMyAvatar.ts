import { useCallback, useEffect, useState } from "react";
import { fetchMyAvatar, readCachedAvatar, writeCachedAvatar, type MyAvatar } from "./api";

/** The signed-in resident's avatar: from this browser at once, then from the server. */
export function useMyAvatar(session: string | null, email: string | null | undefined) {
  const [avatar, setAvatar] = useState<MyAvatar | null>(() => (email ? readCachedAvatar(email) : null));
  useEffect(() => {
    if (!session || !email) return;
    setAvatar(readCachedAvatar(email));
    let live = true;
    void fetchMyAvatar(session).then((r) => {
      if (!live || !r.ok) return;
      setAvatar(r.data.avatar);
      writeCachedAvatar(email, r.data.avatar);
    });
    return () => {
      live = false;
    };
  }, [session, email]);
  const update = useCallback(
    (a: MyAvatar) => {
      setAvatar(a);
      if (email) writeCachedAvatar(email, a);
    },
    [email],
  );
  return [avatar, update] as const;
}
