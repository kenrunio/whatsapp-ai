// Builds the installer outside Google Drive (C:\dev\whatsapp-ai-build) and copies the setup
// .exe into release/. --public: without the Google client built in, for publishing (release/public/).
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const { version, build } = JSON.parse(readFileSync("package.json", "utf8"));
const pub = process.argv.includes("--public");
execSync("node scripts/build.mjs", { stdio: "inherit", env: pub ? { ...process.env, WA_AI_PUBLIC: "1" } : process.env });
execSync("npx electron-builder --win nsis --publish never", { stdio: "inherit" });
const name = build.nsis.artifactName.replace("${version}", version);
const dir = pub ? "release/public" : "release";
mkdirSync(dir, { recursive: true });
copyFileSync(`${build.directories.output}/${name}`, `${dir}/${name}`);
console.log(`${dir}/${name}`);
