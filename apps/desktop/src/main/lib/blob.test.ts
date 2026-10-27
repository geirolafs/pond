import sharp from "sharp";
import { expect, it } from "vitest";
import { isReadableImage } from "./blob";

const png = () =>
  sharp({
    create: { width: 4, height: 4, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();

it("accepts a valid PNG", async () => {
  expect(await isReadableImage(await png())).toBe(true);
});

it("rejects a PNG with a damaged header", async () => {
  const bytes = await png();
  const damaged = Buffer.concat([bytes.subarray(0, 4), bytes.subarray(5)]);
  expect(await isReadableImage(damaged)).toBe(false);
});

it("rejects HTML served as an image", async () => {
  expect(await isReadableImage(Buffer.from("<!doctype html><html>"))).toBe(
    false,
  );
});

it("accepts an ICO file", async () => {
  const ico = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
    Buffer.alloc(16),
  ]);
  expect(await isReadableImage(ico)).toBe(true);
});
