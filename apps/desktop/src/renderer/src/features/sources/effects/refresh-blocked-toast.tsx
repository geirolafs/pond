import { sourceLabel } from "@pond/schema/sources";
import type { WireSyncAction } from "@shared/wire";
import { useEffect } from "react";
import { pool } from "@/features/saves/state/pool";
import { startConnect } from "@/features/sources/lib/create";
import { notify } from "@/shared/lib/toast";

const REFRESH_BLOCKED_TIMEOUT_MS = 10_000;

interface RefreshBlockedDeps {
  notify: typeof notify;
  startConnect: typeof startConnect;
}

const liveDeps: RefreshBlockedDeps = { notify, startConnect };

export function notifyRefreshBlocked(
  action: WireSyncAction,
  deps: RefreshBlockedDeps = liveDeps,
): void {
  if (action.modelName !== "save") return;
  if (action.actorReason !== "pipeline:refresh-blocked") return;
  const source = pool.get(action.modelId)?.source;
  if (!source) return;
  deps.notify({
    id: "refresh-blocked",
    title: `Sign in to ${sourceLabel(source)} to refresh`,
    description:
      "Pond kept the current version. Refresh again after you sign in.",
    action: { label: "Sign in", onClick: () => void deps.startConnect(source) },
    timeout: REFRESH_BLOCKED_TIMEOUT_MS,
  });
}

export function RefreshBlockedToast() {
  useEffect(
    () => window.pond.onSyncAction((action) => notifyRefreshBlocked(action)),
    [],
  );
  return null;
}
