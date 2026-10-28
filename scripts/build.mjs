// Bundles the main process, the two preloads and the Settings page into dist/.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";

const common = { bundle: true, sourcemap: "inline", logLevel: "warning", target: "es2022" };
// The Google OAuth client ("Desktop app" JSON, git-ignored) is built into the app when present, as
// ClassicMail does, so signing in needs no file. Google treats a desktop app's secret as public.
// WA_AI_PUBLIC=1 (npm run release:public) leaves it out: an installer for other people, who use their own.
const googleClient = !process.env.WA_AI_PUBLIC && existsSync("google-client.json") ? readFileSync("google-client.json", "utf8") : "";
console.log(googleClient ? "Google client: built in" : "Google client: none — Sign in will ask for the file");
mkdirSync("dist", { recursive: true });
await Promise.all([
  build({
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main.js",
    platform: "node",
    format: "cjs",
    external: ["electron"],
    define: { __GOOGLE_CLIENT_JSON__: JSON.stringify(googleClient) },
  }),
  // sandboxed preloads may only require("electron"): everything else is bundled in
  // no source map: it would repeat the 2 MB language-detector model inside the page script
  build({ ...common, sourcemap: false, entryPoints: ["src/preload/whatsapp.ts"], outfile: "dist/preload-whatsapp.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/settings/preload.ts"], outfile: "dist/preload-settings.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/settings/settings.ts"], outfile: "dist/settings.js", platform: "browser", format: "iife" }),
]);
cpSync("src/settings/settings.html", "dist/settings.html");
cpSync("src/settings/settings.css", "dist/settings.css");
cpSync("assets", "dist/assets", { recursive: true });
