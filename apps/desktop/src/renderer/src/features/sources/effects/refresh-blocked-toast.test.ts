import type { Source } from "@pond/schema/db";
import type { WireSyncAction } from "@shared/wire";
import { beforeEach, expect, it } from "vitest";
import { normalise } from "@/features/saves/lib/reconcile";
import { pool } from "@/features/saves/state/pool";
import type { NotifyOptions } from "@/shared/lib/toast";
import { notifyRefreshBlocked } from "./refresh-blocked-toast";

let notices: NotifyOptions[] = [];
let connects: Source[] = [];
const deps = {
  notify: (options: NotifyOptions) => {
    notices.push(options);
    return options.id;
  },
  startConnect: async (source: Source) => {
    connects.push(source);
  },
};

function action(overrides: Partial<WireSyncAction> = {}): WireSyncAction {
  return {
    id: 1,
    batchId: null,
    modelName: "save",
    modelId: "post",
    action: "U",
    data: { status: "complete" },
    prevData: null,
    actor: "system",
    actorReason: "pipeline:refresh-blocked",
    createdAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  notices = [];
  connects = [];
  pool.clear();
  const save = normalise({
    id: "post",
    title: "A post",
    url: "https://www.instagram.com/p/abc/",
    source: "instagram",
  });
  if (!save) throw new Error("Invalid save fixture");
  pool.upsert(save);
});

it("asks the user to sign in to the save's source", () => {
  notifyRefreshBlocked(action(), deps);
  expect(notices).toHaveLength(1);
  expect(notices[0]?.title).toBe("Sign in to Instagram to refresh");
  notices[0]?.action?.onClick();
  expect(connects).toEqual(["instagram"]);
});

it("stays quiet for blocks that did not come from a refresh", () => {
  notifyRefreshBlocked(
    action({ actorReason: "pipeline:blocked-keep-files" }),
    deps,
  );
  expect(notices).toEqual([]);
});

it("stays quiet for saves that are not loaded", () => {
  notifyRefreshBlocked(action({ modelId: "missing" }), deps);
  expect(notices).toEqual([]);
});
