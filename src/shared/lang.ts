// Which language a message is in, between the user's language and theirs. The script settles
// most cases (Hebrew letters are not English); two languages written in the same script
// (English / French, Russian / Ukrainian) go to an offline detector, asked to choose between
// just those two.

import { detect } from "tinyld/heavy";

import { Language, Script } from "./languages";

const SCRIPTS: [Script, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Han", /\p{Script=Han}/u],
  ["Japanese", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Georgian", /\p{Script=Georgian}/u],
  ["Ethiopic", /\p{Script=Ethiopic}/u],
];

/** The script most of the letters are in (null: fewer than 2 letters, e.g. "👍" or "12:30"). */
export function scriptOf(text: string): Script | null {
  const counts = new Map<Script, number>();
  let letters = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    const s = SCRIPTS.find(([, re]) => re.test(ch))?.[0];
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (letters < 2) return null;
  // Japanese mixes kanji (Han) with kana: any kana makes it Japanese
  if (counts.get("Japanese")) counts.set("Japanese", (counts.get("Japanese") ?? 0) + (counts.get("Han") ?? 0));
  let best: Script | null = null;
  for (const [s, n] of counts) if (!best || n > counts.get(best)!) best = s;
  return best;
}

/** Is `text` written in `lang` rather than `other`? null = can't tell (too short, or no detector for the pair). */
export function isIn(text: string, lang: Language, other: Language): boolean | null {
  const s = scriptOf(text);
  if (!s) return null;
  if (s !== lang.script) return false;
  if (other.script !== lang.script) return true;
  if (!lang.code || !other.code || lang.code === other.code) return null;
  const d = detect(text, { only: [lang.code, other.code] });
  return d === lang.code ? true : d === other.code ? false : null;
}
