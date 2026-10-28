import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { findFiles, score, words } from "../src/main/files";

describe("file search", () => {
  it("drops filler words", () => {
    expect(words("the Acme logo picture")).toEqual(["acme", "logo"]);
  });
  it("prefers a name match over a folder match", () => {
    expect(score("C:\\x\\Acme_logo.png", ["acme", "logo"])).toBe(2);
    expect(score("C:\\Acme\\logo.png", ["acme", "logo"])).toBe(1);
    expect(score("C:\\x\\other.png", ["acme"])).toBe(0);
  });
  it("walks the folders, by kind, skipping Drive shortcuts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "waai-"));
    mkdirSync(path.join(root, "Acme", "deep"), { recursive: true });
    writeFileSync(path.join(root, "Acme", "deep", "logo.png"), "x");
    writeFileSync(path.join(root, "acme logo.pdf"), "x");
    writeFileSync(path.join(root, "acme logo.gdoc"), "x");
    const all = await findFiles([root], "acme logo");
    expect(all.map((f) => f.name)).toEqual(["acme logo.pdf", "logo.png"]);
    const images = await findFiles([root], "acme logo", "image");
    expect(images.map((f) => f.name)).toEqual(["logo.png"]);
  });
});
