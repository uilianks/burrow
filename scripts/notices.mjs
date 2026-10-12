// Writes out/THIRD_PARTY_NOTICES.txt: the license of every package that can end up in the
// built app, since bundling strips their copyright headers. Starts from the packages the app
// imports and follows their runtime dependencies. Electron's and Chromium's own licenses are
// added by electron-builder.
import fs from "node:fs";
import path from "node:path";

const roots = ["next", "react", "react-dom", "katex", "mermaid", "tailwindcss"];

// Fonts next/font downloads at build time; they come from no package.
const fonts = [
  {
    name: "Geist and Geist Mono (fonts)",
    license: "OFL-1.1",
    url: "https://github.com/vercel/geist-font",
    text: fs.readFileSync("site/fonts/OFL.txt", "utf8"),
  },
];

const seen = new Map();

// Node's lookup, done on directories: "exports" maps can hide package.json from require.resolve.
function manifestDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === path.dirname(dir)) throw new Error(`Cannot find ${name} from ${fromDir}`);
  }
}

function visit(name, fromDir) {
  const dir = manifestDir(name, fromDir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  seen.set(key, {
    name: key,
    license: typeof pkg.license === "string" ? pkg.license : pkg.license?.type ?? "no license stated",
    url: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? pkg.homepage ?? "",
    text: file ? fs.readFileSync(path.join(dir, file), "utf8") : "",
  });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
}

for (const name of roots) visit(name, process.cwd());

const entries = [...[...seen.values()].sort((a, b) => a.name.localeCompare(b.name)), ...fonts];
const missing = entries.filter((e) => !e.text.trim());
if (missing.length) console.warn(`No license file for: ${missing.map((e) => e.name).join(", ")}`);

const body = entries
  .map((e) => [`${e.name} — ${e.license}`, e.url, "", e.text.trim() || `Licensed under ${e.license}.`].filter((l, i) => i !== 1 || l).join("\n"))
  .join(`\n\n${"-".repeat(72)}\n\n`);

fs.mkdirSync("out", { recursive: true });
fs.writeFileSync(
  "out/THIRD_PARTY_NOTICES.txt",
  `Burrow includes the following third-party software.\n\n${"-".repeat(72)}\n\n${body}\n`,
);
console.log(`Wrote out/THIRD_PARTY_NOTICES.txt (${entries.length} entries)`);
