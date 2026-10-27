import { expect, it, vi } from "vitest";
import { WebPageExtractor } from "./web";

const fetchedHtml = "<html><head><title>Fetched page</title></head></html>";
const renderedHtml = "<html><head><title>Rendered page</title></head></html>";

it("uses a browser render when the direct fetch reaches a bot wall", async () => {
  const fetchHtml = vi.fn().mockResolvedValue(null);
  const renderHtml = vi.fn().mockResolvedValue(renderedHtml);
  const extractor = new WebPageExtractor({ fetchHtml, renderHtml });

  await expect(
    extractor.extract({ url: new URL("https://example.com/article") }),
  ).resolves.toMatchObject({ title: "Rendered page" });
  expect(renderHtml).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/article",
    undefined,
  );
});

const amazonCover = (attrs: string) =>
  `<html><head><title>Thinking in Systems</title></head><body><img alt="Thinking in Systems" id="landingImage" ${attrs}></body></html>`;

function extractFrom(url: string, html: string) {
  const extractor = new WebPageExtractor({
    fetchHtml: vi.fn().mockResolvedValue(html),
    renderHtml: vi.fn(),
  });
  return extractor.extract({ url: new URL(url) });
}

it("saves the high-resolution cover from an Amazon product page", async () => {
  const capture = await extractFrom(
    "https://www.amazon.com/Thinking-Systems-Donella-H-Meadows/dp/1603580557",
    amazonCover(
      'src="https://m.media-amazon.com/images/I/41PzYXIWz9L._SY445_SX342_ML2_.jpg" data-old-hires="https://m.media-amazon.com/images/I/71+QmpkC0aL._SL1500_.jpg"',
    ),
  );

  expect(capture.media).toEqual([
    {
      url: "https://m.media-amazon.com/images/I/71+QmpkC0aL._SL1500_.jpg",
      type: "image",
    },
  ]);
});

it("falls back to the displayed Amazon image when no high-resolution one is listed", async () => {
  const capture = await extractFrom(
    "https://www.amazon.co.uk/dp/1603580557",
    amazonCover(
      'src="https://m.media-amazon.com/images/I/41PzYXIWz9L._SY445_.jpg" data-old-hires=""',
    ),
  );

  expect(capture.media).toEqual([
    {
      url: "https://m.media-amazon.com/images/I/41PzYXIWz9L._SY445_.jpg",
      type: "image",
    },
  ]);
});

it("keeps the page's og:image on sites other than Amazon", async () => {
  const capture = await extractFrom(
    "https://example.com/article",
    `<html><head><meta property="og:image" content="https://example.com/share.jpg"></head><body><img id="landingImage" src="https://example.com/hero.jpg"></body></html>`,
  );

  expect(capture.media).toEqual([
    { url: "https://example.com/share.jpg", type: "image" },
  ]);
});

const shopPage = (jsonLd: string) =>
  `<html><head><meta property="og:image" content="https://shop.example.com/banner.jpg"><script type="application/ld+json">${jsonLd}</script></head></html>`;

it("prefers a shop's JSON-LD product image over its og:image banner", async () => {
  const capture = await extractFrom(
    "https://shop.example.com/records/kind-of-blue",
    shopPage(
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Kind of Blue",
        image: ["/covers/kind-of-blue.jpg", "/covers/back.jpg"],
      }),
    ),
  );

  expect(capture.media).toEqual([
    { url: "https://shop.example.com/covers/kind-of-blue.jpg", type: "image" },
  ]);
});

it("finds a book cover inside a JSON-LD @graph with an ImageObject", async () => {
  const capture = await extractFrom(
    "https://books.example.com/thinking-in-systems",
    shopPage(
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebPage", image: "https://books.example.com/og.jpg" },
          {
            "@type": ["Book", "Product"],
            image: {
              "@type": "ImageObject",
              url: "https://books.example.com/cover.jpg",
            },
          },
        ],
      }),
    ),
  );

  expect(capture.media).toEqual([
    { url: "https://books.example.com/cover.jpg", type: "image" },
  ]);
});

it("keeps the og:image when the JSON-LD describes an article", async () => {
  const capture = await extractFrom(
    "https://news.example.com/story",
    shopPage(
      JSON.stringify({
        "@type": "NewsArticle",
        image: "https://news.example.com/inline.jpg",
      }),
    ),
  );

  expect(capture.media).toEqual([
    { url: "https://shop.example.com/banner.jpg", type: "image" },
  ]);
});

it("does not acquire a browser when the direct fetch succeeds", async () => {
  const renderHtml = vi.fn().mockResolvedValue(renderedHtml);
  const extractor = new WebPageExtractor({
    fetchHtml: vi.fn().mockResolvedValue(fetchedHtml),
    renderHtml,
  });

  await expect(
    extractor.extract({ url: new URL("https://example.com/article") }),
  ).resolves.toMatchObject({ title: "Fetched page" });
  expect(renderHtml).not.toHaveBeenCalled();
});
