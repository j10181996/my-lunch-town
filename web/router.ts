import { useSyncExternalStore, type MouseEvent } from "react";

const listeners = new Set<() => void>();

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", () => listeners.forEach((l) => l()));

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

/** <a {...link("/x")}>：保留原生連結行為，同時走前端路由。 */
export function link(path: string) {
  return {
    href: path,
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(path);
    },
  };
}
