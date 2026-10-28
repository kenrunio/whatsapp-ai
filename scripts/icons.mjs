// Draws the app icon (a chat bubble with "A א") and renders the PNG / ICO sizes into assets/.
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync } from "node:fs";

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect x="8" y="8" width="240" height="240" rx="56" fill="#00a884"/>
  <path d="M128 44c-50 0-88 33-88 76 0 23 11 43 30 57l-8 33 36-19c9 3 19 4 30 4 50 0 88-33 88-75s-38-76-88-76z" fill="#fff"/>
  <text x="98" y="148" font-family="Segoe UI, Arial" font-weight="700" font-size="74" fill="#00a884" text-anchor="middle">A</text>
  <text x="160" y="148" font-family="Segoe UI, Arial" font-weight="700" font-size="74" fill="#005c4b" text-anchor="middle">א</text>
</svg>`;
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#ea0038" stroke="#fff" stroke-width="2"/></svg>`;

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
writeFileSync("assets/icon.png", await png(icon, 512));
writeFileSync("assets/tray.png", await png(icon, 32));
writeFileSync("assets/badge.png", await png(badge, 20));
writeFileSync("assets/icon.ico", await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => png(icon, s)))));
console.log("icons written");
