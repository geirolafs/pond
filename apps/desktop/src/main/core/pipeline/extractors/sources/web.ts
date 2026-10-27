import type { CaptureMedia } from "@pond/schema/raw";
import metascraper from "metascraper";
import metascraperAuthor from "metascraper-author";
import metascraperDate from "metascraper-date";
import metascraperDescription from "metascraper-description";
import metascraperImage from "metascraper-image";
import metascraperLogoFavicon from "metascraper-logo-favicon";
import metascraperPublisher from "metascraper-publisher";
import metascraperTitle from "metascraper-title";
import metascraperUrl from "metascraper-url";
import { z } from "zod";
import {
  browserUserAgent,
  renderPageHtml,
} from "../../../refresh/web-page-renderer";
import { TerminalError, TransientError } from "../errors";
import type { Capture, ExtractInput, Extractor } from "../types";

type WebExtras = {
  publisher?: string;
  faviconUrl?: string;
};

const AMAZON_HOST = /(^|\.)amazon\.[a-z]{2,3}(\.[a-z]{2})?$/;
const AMAZON_COVER_SELECTOR = "#landingImage, #imgBlkFront, #ebooksImgBlkFront";

/** Amazon product pages carry no og:image; the item photo or cover lives in the image block. */
const amazonProductImage: metascraper.Rules = {
  test: ({ url }) => AMAZON_HOST.test(new URL(url).hostname),
  image: ({ htmlDom: $, url }) => {
    const img = $(AMAZON_COVER_SELECTOR).first();
    const src =
      pickString(img.attr("data-old-hires")) ?? pickString(img.attr("src"));
    if (!src || src.startsWith("data:")) return undefined;
    return new URL(src, url).href;
  },
};

const PRODUCT_TYPES = new Set([
  "Product",
  "ProductGroup",
  "IndividualProduct",
  "Book",
  "MusicAlbum",
  "MusicRelease",
  "Periodical",
  "PublicationIssue",
]);

const JsonLdImageRef = z.union([
  z.string(),
  z
    .object({ url: z.string().optional(), contentUrl: z.string().optional() })
    .transform((image) => image.url ?? image.contentUrl),
]);
const JsonLdProduct = z.object({
  "@type": z.union([z.string(), z.array(z.string())]),
  image: z.union([JsonLdImageRef, z.array(JsonLdImageRef)]),
});
const JsonLdGraph = z.object({ "@graph": z.array(z.json()) });

/** Shops often point og:image at a banner; their JSON-LD product entry names the item photo or cover. */
const jsonLdProductImage: metascraper.Rules = {
  image: ({ htmlDom: $, url }) => {
    for (const script of $('script[type="application/ld+json"]').toArray()) {
      const src = productImageFromJsonLd($(script).text());
      if (src && !src.startsWith("data:")) return new URL(src, url).href;
    }
    return undefined;
  },
};

function productImageFromJsonLd(text: string): string | undefined {
  const parsed = z.json().safeParse(safeJsonParse(text));
  if (!parsed.success) return undefined;
  const roots = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const nodes = roots.flatMap((root) => {
    const graph = JsonLdGraph.safeParse(root);
    return graph.success ? [root, ...graph.data["@graph"]] : [root];
  });
  for (const node of nodes) {
    const product = JsonLdProduct.safeParse(node);
    if (!product.success) continue;
    const types = [product.data["@type"]].flat();
    if (!types.some((type) => PRODUCT_TYPES.has(type))) continue;
    const picked = pickString([product.data.image].flat()[0]);
    if (picked) return picked;
  }
  return undefined;
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const scrape = metascraper([
  metascraperTitle(),
  metascraperDescription(),
  amazonProductImage,
  jsonLdProductImage,
  metascraperImage(),
  metascraperLogoFavicon(),
  metascraperAuthor(),
  metascraperDate(),
  metascraperPublisher(),
  metascraperUrl(),
]);

const FETCH_TIMEOUT_MS = 15_000;

interface WebPageExtractorDependencies {
  fetchHtml: (url: string) => Promise<string | null>;
  renderHtml: (url: string, signal?: AbortSignal) => Promise<string>;
}

const defaultDependencies: WebPageExtractorDependencies = {
  fetchHtml,
  renderHtml,
};

export class WebPageExtractor implements Extractor {
  readonly id = "web-page";
  readonly source = "web" as const;
  readonly validUrl: readonly RegExp[] = [];
  readonly cookieDomain = null;

  constructor(
    private readonly dependencies: WebPageExtractorDependencies = defaultDependencies,
  ) {}

  authCookies(): boolean {
    return false;
  }

  suitable(url: URL): boolean {
    return url.protocol === "http:" || url.protocol === "https:";
  }

  async extract(input: ExtractInput): Promise<Capture> {
    const html =
      (await this.dependencies.fetchHtml(input.url.href)) ??
      (await this.dependencies.renderHtml(input.url.href, input.signal));
    const meta = await scrape({ url: input.url.href, html });

    const canonical = pickString(meta.url) ?? input.url.href;

    const faviconUrl = pickString(meta.logo);
    const coverUrl = pickString(meta.image) ?? faviconUrl;
    const media: CaptureMedia[] = coverUrl
      ? [{ url: coverUrl, type: "image" }]
      : [];

    const authorName = pickString(meta.author);
    const author = authorName ? { name: authorName } : undefined;

    const publishedAt = pickString(meta.date);
    const publisher = pickString(meta.publisher);

    const extras: WebExtras = {};
    if (publisher) extras.publisher = publisher;
    if (faviconUrl) extras.faviconUrl = faviconUrl;

    const title = pickString(meta.title);
    const description = pickString(meta.description);
    const capture: Capture = {
      id: canonical,
      source: "web",
      url: canonical,
      media,
    };
    if (title) capture.title = title;
    if (description) capture.description = description;
    if (author) capture.author = author;
    if (publishedAt) capture.publishedAt = publishedAt;
    if (Object.keys(extras).length > 0) capture.extras = extras;
    return capture;
  }
}

/** Resolves null on 403: bot walls fingerprint the TLS handshake, so only a real browser gets through. */
async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": browserUserAgent(),
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (err) {
    throw new TransientError(
      `web fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 403) return null;
  assertPageStatus(res.status, "web fetch");

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|xml|xhtml/i.test(contentType)) {
    throw new TerminalError(`web fetch non-html content-type: ${contentType}`);
  }

  const text = await res.text();
  if (!text.trim()) throw new TerminalError("web fetch returned empty body");
  return text;
}

async function renderHtml(url: string, signal?: AbortSignal): Promise<string> {
  const rendered = await renderPageHtml(url, signal);
  if (!rendered.ok) {
    if (rendered.reason === "navigation")
      throw new TransientError("web render: navigation failed");
    if (rendered.reason === "read-timeout")
      throw new TransientError("web render: read timed out");
    throw new TerminalError("web render returned empty document");
  }
  assertPageStatus(rendered.status, "web render");
  return rendered.html;
}

function assertPageStatus(status: number, label: string): void {
  if (status < 400) return;
  if (status >= 500 || status === 429) {
    throw new TransientError(`${label} ${status}`);
  }
  throw new TerminalError(`${label} ${status}`);
}

function pickString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
