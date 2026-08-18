"use client";

import { useEffect } from "react";

function clearSessionOnUnload() {
  const url = "/api/auth/logout";
  try {
    void fetch(url, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "text/plain" },
    });
    return;
  } catch {
    // Fall through to sendBeacon.
  }

  try {
    navigator.sendBeacon?.(url);
  } catch {
    // Best-effort only during unload.
  }
}

/**
 * Clears the admin session when the tab fully unloads (close / hard navigation).
 * Skips bfcache (`pagehide` with `persisted`) and does not run on client-side route changes.
 */
export function SessionEndOnClose() {
  useEffect(() => {
    const onPageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      clearSessionOnUnload();
    };

    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}
