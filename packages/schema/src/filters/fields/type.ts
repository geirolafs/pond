import { sql } from "drizzle-orm";
import { saves } from "../../db";
import { webTypeKey } from "../../media-type";
import { defineField } from "./descriptor";

const TYPE_PRESETS = [
  { id: "image", label: "Image", value: "image" },
  { id: "video", label: "Video", value: "video" },
  { id: "audio", label: "Audio", value: "audio" },
  { id: "document", label: "Document", value: "document" },
  { id: "font", label: "Font", value: "font" },
  { id: "file", label: "File", value: "file" },
  { id: "link", label: "Website", value: "link" },
  { id: "product", label: "Product", value: "product" },
  { id: "text", label: "Text", value: "text" },
] as const;

export const typeField = defineField({
  id: "type",
  type: "enum",
  label: "Type",
  group: "media",
  presets: TYPE_PRESETS,
  project: (s) =>
    s.source === "web" ? webTypeKey(s) : (s.mediaType ?? "").toLowerCase(),
  sqlProjection: () =>
    sql`case when ${saves.source} = 'web' and json_extract(${saves.rawJson}, '$.capture.extras.product') = 1 then 'product' when ${saves.source} = 'web' then 'link' else lower(coalesce(${saves.mediaType}, '')) end`,
});
