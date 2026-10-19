import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { linkFromFile } from "./auto-import-link";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pond-auto-import-link-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function file(name: string, content: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, content);
  return path;
}

describe("linkFromFile", () => {
  it("reads a link shared as plain text", async () => {
    await expect(
      linkFromFile(await file("shared.txt", "  https://example.com/a?b=1\n")),
    ).resolves.toBe("https://example.com/a?b=1");
  });

  it("reads Windows .url and macOS .webloc link files", async () => {
    await expect(
      linkFromFile(
        await file(
          "page.url",
          "[InternetShortcut]\r\nURL=https://example.com/url\r\n",
        ),
      ),
    ).resolves.toBe("https://example.com/url");
    await expect(
      linkFromFile(
        await file(
          "page.webloc",
          '<?xml version="1.0"?><plist version="1.0"><dict><key>URL</key><string>https://example.com/?a=1&amp;b=2</string></dict></plist>',
        ),
      ),
    ).resolves.toBe("https://example.com/?a=1&b=2");
    await expect(
      linkFromFile(
        await file(
          "numeric.webloc",
          '<plist version="1.0"><dict><key>URL</key><string>https://example.com/?a=1&#38;b=2&#x26;c=3</string></dict></plist>',
        ),
      ),
    ).resolves.toBe("https://example.com/?a=1&b=2&c=3");
  });

  it("keeps notes, other schemes, large files, and media as file imports", async () => {
    await expect(
      linkFromFile(await file("note.txt", "Read later: https://example.com")),
    ).resolves.toBeNull();
    await expect(
      linkFromFile(await file("script.txt", "javascript:alert(1)")),
    ).resolves.toBeNull();
    await expect(
      linkFromFile(
        await file("big.txt", `https://example.com/${"a".repeat(9000)}`),
      ),
    ).resolves.toBeNull();
    await expect(
      linkFromFile(await file("photo.png", "https://example.com")),
    ).resolves.toBeNull();
  });
});
