import { saves } from "@pond/schema/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import log from "electron-log/main.js";
import { getDb } from "../../db";
import { readSave } from "../pipeline/workers/apply";
import {
  fetchSourceIcon,
  hasReadableSourceIcon,
  hasSourceIcon,
} from "../pipeline/workers/source-icon";

const CONCURRENCY = 4;

export async function backfillSourceIcons(): Promise<{
  ok: true;
  written: number;
}> {
  const db = await getDb();
  const rows = db
    .select({ id: saves.id, files: saves.files })
    .from(saves)
    .where(
      and(
        eq(saves.source, "web"),
        inArray(saves.status, ["complete", "failed"]),
        isNull(saves.deletedAt),
      ),
    )
    .all();

  if (rows.length === 0) return { ok: true, written: 0 };

  let candidates = 0;
  let written = 0;
  let cursor = 0;
  const runLane = async (): Promise<void> => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      if (!row) continue;
      try {
        const stored = hasSourceIcon(row.files);
        if (stored && (await hasReadableSourceIcon(row.id, row.files))) {
          continue;
        }
        candidates += 1;
        const save = await readSave(row.id);
        if (!save) continue;
        if (await fetchSourceIcon(row.id, save, { replace: stored })) {
          written += 1;
        }
      } catch (err) {
        log.warn("[pond source-icon-backfill] failed", row.id, err);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, runLane),
  );

  log.info("[pond source-icon-backfill] done", { candidates, written });
  return { ok: true, written };
}
