import { z } from "zod";
import {
  embedModelVersion,
  embedSearchQueries,
} from "@/features/enrichment/lib/embeddings";
import { embeddingFor } from "@/features/enrichment/state/embedding-store";
import type { Save } from "@/features/saves/types";
import { unitCosine } from "@/shared/lib/vector";
import type { Enricher } from "../types";

const SUGGESTED_TAGS_VERSION = "suggested-tags@2";
const SCORE_THRESHOLD = 0.3;
const MAX_SUGGESTIONS = 5;
// One embedding call pads every row to the longest name, so a large tag list in a single call outgrows ONNX Runtime's tensor limit.
const VOCAB_BATCH_SIZE = 64;
// Tags are short labels; a longer string is import debris and only pads its batch.
const MAX_TAG_LENGTH = 100;

function suggestedTagsModelVersion(): string {
  return `${SUGGESTED_TAGS_VERSION}:${embedModelVersion()}`;
}

interface VocabEntry {
  name: string;
  vec: Float32Array;
}

const TagRowsSchema = z.array(
  z.object({ name: z.string().optional().catch(undefined) }),
);

let vocabPromise: Promise<VocabEntry[]> | null = null;
let vocabKey = "";

async function getVocab(): Promise<VocabEntry[]> {
  const key = embedModelVersion();
  if (vocabPromise && vocabKey === key) return vocabPromise;
  vocabKey = key;
  vocabPromise = (async () => {
    const rows = TagRowsSchema.parse(await window.pond.query("tags.list", {}));
    const names = rows
      .map((r) => r.name)
      .filter(
        (n): n is string =>
          !!n && n.trim().length > 0 && n.length <= MAX_TAG_LENGTH,
      );
    if (names.length === 0) return [];
    const vecs: Float32Array[] = [];
    for (let i = 0; i < names.length; i += VOCAB_BATCH_SIZE) {
      vecs.push(
        ...(await embedSearchQueries(names.slice(i, i + VOCAB_BATCH_SIZE))),
      );
    }
    return names.flatMap((name, i) => {
      const vec = vecs[i];
      return vec ? [{ name, vec }] : [];
    });
  })();
  vocabPromise.catch(() => {
    vocabPromise = null;
  });
  return vocabPromise;
}

export const suggestedTagsEnricher: Enricher = {
  id: "suggestedTags",
  dependsOn: ["textEmbedding"],
  enabled: (prefs) =>
    prefs?.ai?.enableSuggestedTags === true &&
    prefs?.ai?.semanticSearch === true,
  eligible(save: Save) {
    if (save.status !== "complete" || save.deletedAt != null) return false;
    if (save.suggestedTagsModel === suggestedTagsModelVersion()) return false;
    return save.embeddingModel === embedModelVersion();
  },
  async run(save: Save) {
    const entry = await embeddingFor(save.id);
    if (!entry) return null;
    const vocab = await getVocab();
    const existing = new Set((save.tags ?? []).map((t) => t.toLowerCase()));
    const scored = vocab
      .filter((v) => !existing.has(v.name.toLowerCase()))
      .map((v) => ({ name: v.name, score: unitCosine(entry.vec, v.vec) }))
      .filter((s) => s.score >= SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => s.name);
    const fields = {
      suggestedTags: scored,
      suggestedTagsModel: suggestedTagsModelVersion(),
    };
    return { derived: fields, optimistic: fields };
  },
};
