import { rm } from "node:fs/promises";
import { saves, tasks } from "@pond/schema/db";
import { and, eq } from "drizzle-orm";
import log from "electron-log/main.js";
import { getDb } from "../../db";
import { saveFile } from "../../paths";
import { persistSave } from "../persist-save";
import { resetTasksForSave } from "../pipeline/enqueue";
import { createPendingTasks } from "../pipeline/enqueue-scheduling";
import { withInteractivePriority } from "../pipeline/priority";
import { createQueueGeneration } from "../pipeline/queue-generations";
import { kickReconciler } from "../pipeline/reconciler-client";

export type RefreshOutcome =
  | { ok: true; method: "metadata" | "pipeline-reset" }
  | {
      ok: false;
      reason: "not_found" | "no_url" | "internal_error";
    };

interface RefreshSaveOptions {
  overwrite?: boolean;
}

export async function refreshSave(
  saveId: string,
  opts: RefreshSaveOptions = {},
): Promise<RefreshOutcome> {
  const db = await getDb();
  const rows = await db.select().from(saves).where(eq(saves.id, saveId));
  const current = rows[0];
  if (!current) return { ok: false, reason: "not_found" };
  if (!current.url) return { ok: false, reason: "no_url" };

  try {
    const generationId = await createQueueGeneration({
      kind: "refresh",
      source: current.source,
      scope: { saveIds: [saveId], overwrite: opts.overwrite === true },
    });
    if (opts.overwrite) {
      const existing = current.files ?? [];
      await Promise.all(
        existing.map((f) =>
          rm(saveFile(saveId, f.path), { force: true }).catch(() => {}),
        ),
      );
      db.update(saves)
        .set({ files: [], coverIndex: 0, fileSize: null, mediaUrl: null })
        .where(eq(saves.id, saveId))
        .run();

      db.update(tasks)
        .set({
          payload: withInteractivePriority({ force: true }),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.saveId, saveId), eq(tasks.op, "harvest_metadata")))
        .run();
      await resetTasksForSave(saveId, "user:refresh-overwrite", generationId);
      await persistSave(
        saveId,
        {
          status: "ingesting",
          ingestStartedAt: new Date(),
          ingestCompletedAt: null,
          files: [],
          coverIndex: 0,
          fileSize: null,
          mediaUrl: null,
        },
        { actorReason: "user:refresh-overwrite" },
      );
      kickReconciler();
      return { ok: true, method: "pipeline-reset" };
    }

    const now = new Date();
    const harvest = db
      .update(tasks)
      .set({
        payload: withInteractivePriority({ force: true }),
        status: "pending",
        attempts: 0,
        generationId,
        lastError: null,
        nextRunAt: now,
        updatedAt: now,
      })
      .where(and(eq(tasks.saveId, saveId), eq(tasks.op, "harvest_metadata")))
      .run();

    if ((harvest.changes ?? 0) === 0) {
      // Saves read back from the library folder have no task rows, since
      // tasks live only in the local index. Seed the source's full plan.
      const seeded = createPendingTasks(
        saveId,
        current.source,
        now,
        "user:refresh",
        undefined,
        generationId,
      ).map((row) =>
        row.op === "harvest_metadata"
          ? { ...row, payload: withInteractivePriority({ force: true }) }
          : row,
      );
      const hasTasks = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.saveId, saveId))
        .get();
      if (hasTasks || !seeded.some((row) => row.op === "harvest_metadata")) {
        log.warn("[pond refresh] no harvest_metadata task", saveId);
        return { ok: false, reason: "internal_error" };
      }
      db.insert(tasks).values(seeded).run();
    } else {
      // The new metadata can point at different media; fetch_blobs only
      // downloads what is not on disk yet.
      db.update(tasks)
        .set({
          status: "pending",
          attempts: 0,
          generationId,
          lastError: null,
          nextRunAt: now,
          updatedAt: now,
        })
        .where(and(eq(tasks.saveId, saveId), eq(tasks.op, "fetch_blobs")))
        .run();
    }

    await persistSave(
      saveId,
      {
        status: "ingesting",
        ingestStartedAt: now,
        ingestCompletedAt: null,
      },
      { actorReason: "user:refresh" },
    );
    kickReconciler();
    return { ok: true, method: "metadata" };
  } catch (err) {
    log.error("[pond refresh] reset failed", saveId, err);
    return { ok: false, reason: "internal_error" };
  }
}

export { isSourceConnected, signInToSource } from "./harvest-window";
