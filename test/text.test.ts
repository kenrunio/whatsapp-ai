import { describe, expect, it } from "vitest";

import { isIn, scriptOf } from "../src/shared/lang";
import { LANGUAGES, language } from "../src/shared/languages";
import { instructions } from "../src/shared/text";

describe("instructions", () => {
  it("finds {…} and leaves brackets and empties alone", () => {
    expect(instructions("Hi {his first name}, see [the deck] {?} {} x")).toEqual(["his first name"]);
    expect(instructions("{a} and {b}")).toEqual(["a", "b"]);
    expect(instructions("no {unclosed\n} here")).toEqual([]);
    expect(instructions("{outer {inner}}")).toEqual([]);
    expect(instructions("plain text")).toEqual([]);
  });
});

describe("language", () => {
  const [en, he, fr, ru, uk] = ["English", "Hebrew", "French", "Russian", "Ukrainian"].map(language);
  it("knows the script", () => {
    expect(scriptOf("שלום אלכס, מה שלומך?")).toBe("Hebrew");
    expect(scriptOf("אלכס, תסתכל על ה-deck של Acme")).toBe("Hebrew");
    expect(scriptOf("Hi Dan, see the Acme deck — תודה")).toBe("Latin");
    expect(scriptOf("今日は良い天気ですね")).toBe("Japanese");
    expect(scriptOf("👍")).toBeNull();
    expect(scriptOf("12:30")).toBeNull();
  });
  it("tells my language from theirs", () => {
    expect(isIn("שלום אלכס, מה שלומך?", en, he)).toBe(false);
    expect(isIn("Hi Dan, all good thanks", en, he)).toBe(true);
    expect(isIn("👍", en, he)).toBeNull();
    // same script: the detector chooses between the two
    expect(isIn("Bonjour, comment ça va ? On se voit demain au bureau", en, fr)).toBe(false);
    expect(isIn("See you tomorrow at the office", en, fr)).toBe(true);
    expect(isIn("Привіт, як справи? Побачимось завтра", ru, uk)).toBe(false);
    expect(isIn("Hej, hvordan har du det? Vi ses i morgen", language("Swedish"), language("Danish"))).toBe(false);
  });
  it("has a glyph and code for every listed language", () => {
    for (const l of LANGUAGES) {
      expect(l.glyph.length).toBeGreaterThan(0);
      expect(l.code).toMatch(/^[a-z]{2}$/);
    }
    expect(language("Klingon").glyph).toBe("K");
  });
});
