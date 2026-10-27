import type { Save } from "@pond/schema/db";
import type { RawJson } from "@pond/schema/raw";
import type { TxSaveFile } from "@pond/schema/tx";
import log from "electron-log/main.js";
import { z } from "zod";
import { fetchSourceIconToTxFile } from "../../../lib/blob";
import { persistSave } from "../../persist-save";
import type { WriteFileArgs } from "./apply";

const SOURCE_ICON_KIND = "source_icon";

const FaviconUrlSchema = z.string().min(1).optional().catch(undefined);

export function hasSourceIcon(files: Save["files"]): boolean {
  return (files ?? []).some((f) => f.kind === SOURCE_ICON_KIND);
}

export async function fetchSourceIcon(
  saveId: string,
  save: Save,
): Promise<boolean> {
  if (hasSourceIcon(save.files)) return false;

  const fetched = await fetchFirstIcon(faviconUrls(save));
  if (!fetched) return false;
  const { iconUrl, file: tx } = fetched;
  const iconFile: WriteFileArgs = {
    kind: SOURCE_ICON_KIND,
    filename: tx.filename,
    bytes: Buffer.from(tx.bytes),
    sourceUrl: iconUrl,
  };
  if (tx.mimeType) iconFile.mimeType = tx.mimeType;

  await persistSave(
    saveId,
    {},
    {
      actorReason: "pipeline:source-icon",
      newFiles: [iconFile],
    },
  );
  log.info("[pond pipeline:source-icon] wrote", saveId);
  return true;
}

async function fetchFirstIcon(
  urls: string[],
): Promise<{ iconUrl: string; file: TxSaveFile } | null> {
  for (const iconUrl of urls) {
    const outcome = await fetchSourceIconToTxFile(iconUrl);
    if ("file" in outcome) return { iconUrl, file: outcome.file };
  }
  return null;
}

function faviconUrls(save: Save): string[] {
  const urls = [
    scrapedFaviconUrl(save.rawJson),
    fallbackFaviconUrl(save.url),
  ].filter((url): url is string => url !== null);
  return [...new Set(urls)];
}

function scrapedFaviconUrl(rawJson: RawJson | null): string | null {
  return FaviconUrlSchema.parse(rawJson?.capture?.extras?.faviconUrl) ?? null;
}

function fallbackFaviconUrl(saveUrl: string): string | null {
  try {
    const host = new URL(saveUrl).hostname;
    if (!host) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return null;
  }
}
