import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

// Link files are a few hundred bytes; anything larger is a real document.
const MAX_LINK_FILE_BYTES = 8 * 1024;

function webUrl(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate || /\s/.test(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const XML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

function decodeXml(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1]?.toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return XML_ENTITIES.get(name) ?? entity;
    },
  );
}

/** A watched-folder file that only points at a web page, such as a link shared from a phone. */
export async function linkFromFile(path: string): Promise<string | null> {
  const extension = extname(path).toLowerCase();
  if (![".txt", ".url", ".webloc"].includes(extension)) return null;
  const details = await stat(path);
  if (details.size > MAX_LINK_FILE_BYTES) return null;
  const text = await readFile(path, "utf8");
  if (extension === ".url") return webUrl(/^URL=(.+)$/im.exec(text)?.[1]);
  if (extension === ".webloc")
    return webUrl(
      decodeXml(
        /<key>URL<\/key>\s*<string>([^<]+)<\/string>/.exec(text)?.[1] ?? "",
      ),
    );
  return webUrl(text);
}
