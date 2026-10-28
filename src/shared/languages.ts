// The languages WhatsApp AI can translate between (Settings offers these). `code` is ISO 639-1,
// used by the detector to tell apart two languages written in the same script; `glyph` is how
// the language appears on the Translate button.

export type Script =
  | "Latin"
  | "Hebrew"
  | "Arabic"
  | "Cyrillic"
  | "Greek"
  | "Han"
  | "Japanese"
  | "Hangul"
  | "Thai"
  | "Devanagari"
  | "Armenian"
  | "Georgian"
  | "Ethiopic";

export interface Language {
  name: string;
  code: string;
  script: Script;
  glyph: string;
}

const L = (name: string, code: string, script: Script, glyph = code.toUpperCase()): Language => ({ name, code, script, glyph });

export const LANGUAGES: Language[] = [
  L("English", "en", "Latin", "A"),
  L("Hebrew", "he", "Hebrew", "א"),
  L("Arabic", "ar", "Arabic", "ع"),
  L("Russian", "ru", "Cyrillic", "Я"),
  L("Ukrainian", "uk", "Cyrillic", "Ї"),
  L("French", "fr", "Latin"),
  L("Spanish", "es", "Latin"),
  L("Portuguese", "pt", "Latin"),
  L("Italian", "it", "Latin"),
  L("German", "de", "Latin"),
  L("Dutch", "nl", "Latin"),
  L("Polish", "pl", "Latin"),
  L("Romanian", "ro", "Latin"),
  L("Hungarian", "hu", "Latin"),
  L("Czech", "cs", "Latin"),
  L("Swedish", "sv", "Latin"),
  L("Norwegian", "no", "Latin"),
  L("Danish", "da", "Latin"),
  L("Finnish", "fi", "Latin"),
  L("Turkish", "tr", "Latin"),
  L("Vietnamese", "vi", "Latin"),
  L("Indonesian", "id", "Latin"),
  L("Greek", "el", "Greek", "Ω"),
  L("Persian", "fa", "Arabic", "ف"),
  L("Hindi", "hi", "Devanagari", "अ"),
  L("Chinese", "zh", "Han", "文"),
  L("Japanese", "ja", "Japanese", "あ"),
  L("Korean", "ko", "Hangul", "한"),
  L("Thai", "th", "Thai", "ก"),
  L("Armenian", "hy", "Armenian", "Ա"),
  L("Georgian", "ka", "Georgian", "ა"),
  L("Amharic", "am", "Ethiopic", "አ"),
];

/** A language by its name (as saved in Settings); an unknown name still gets a glyph. */
export function language(name: string): Language {
  const n = name.trim().toLowerCase();
  return LANGUAGES.find((l) => l.name.toLowerCase() === n) ?? { name, code: "", script: "Latin", glyph: (name.trim()[0] ?? "?").toUpperCase() };
}
