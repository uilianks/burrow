// The desktop shell. It shows the built app (out/) in a window and is the only
// part that touches the disk: the notes folder holds
//   burrow.json        every page and block (same format as a backup file)
//   burrow.json.bak    the notes as they were when the app was last opened
//   attachments/      uploaded files, named <id>-<original name>
//   Markdown/         a readable copy of every page, rewritten as you edit
//   .burrow/           settings and page history, as small JSON files
//   plugins/          one folder per plugin (manifest.json + a script), and enabled.json
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const OUT = path.join(__dirname, "..", "out");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
  pdf: "application/pdf", txt: "text/plain",
};

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let window;
const configFile = () => path.join(app.getPath("userData"), "config.json");
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
};
// BURROW_VAULT lets tests use a throwaway folder instead of the person's own notes.
const vault = () => process.env.BURROW_VAULT || readConfig().vault || path.join(app.getPath("documents"), "Burrow");
const notesFile = () => path.join(vault(), "burrow.json");
const attachments = () => path.join(vault(), "attachments");

// ---- notes: kept in memory, written to disk shortly after each change ----
let records = new Map();
let dirty = false;
let timer;
let backedUp = false;

function readNotes(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (parsed.burrow !== 1 || !Array.isArray(parsed.blocks)) throw new Error("not a Burrow notes file");
  return parsed.blocks;
}

function loadNotes() {
  flush();
  backedUp = false;
  let blocks = [];
  if (fs.existsSync(notesFile())) {
    try {
      blocks = readNotes(notesFile());
    } catch {
      // Never write over a file that can't be read: set it aside and fall back to the last good copy.
      fs.renameSync(notesFile(), path.join(vault(), `burrow.unreadable-${Date.now()}.json`));
      try {
        blocks = readNotes(`${notesFile()}.bak`);
      } catch {}
    }
  }
  records = new Map(blocks.map((block) => [block.id, block]));
  return blocks;
}

function flush() {
  clearTimeout(timer);
  if (!dirty) return;
  dirty = false;
  try {
    fs.mkdirSync(vault(), { recursive: true });
    if (!backedUp && fs.existsSync(notesFile())) fs.copyFileSync(notesFile(), `${notesFile()}.bak`);
    backedUp = true;
    // write beside the real file and swap it in, so a crash mid-write can't leave half a file
    const temporary = `${notesFile()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ burrow: 1, blocks: [...records.values()] }));
    fs.renameSync(temporary, notesFile());
  } catch (error) {
    dirty = true;
    window?.webContents.send("vault:save-failed", String(error.message ?? error));
  }
}

ipcMain.handle("vault:load", () => loadNotes());
ipcMain.handle("vault:folder", () => vault());
ipcMain.handle("vault:save", (_event, changed) => {
  for (const [id, value] of Object.entries(changed)) {
    if (value) records.set(id, value);
    else records.delete(id);
  }
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
});
ipcMain.handle("vault:show", () => shell.openPath(vault()));
ipcMain.handle("vault:choose", async () => {
  const result = await dialog.showOpenDialog(window, {
    title: "Choose the folder that holds your notes",
    defaultPath: vault(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  flush();
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify({ ...readConfig(), vault: result.filePaths[0] }));
  window.reload();
  return result.filePaths[0];
});

// ---- attachments ----
const attachment = (id) => (ID.test(id) && fs.existsSync(attachments()) ? fs.readdirSync(attachments()).find((name) => name.startsWith(`${id}-`)) : undefined);

ipcMain.handle("files:put", (_event, name, bytes) => {
  const id = crypto.randomUUID();
  const safe = path.basename(String(name || "file")).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(-80) || "file";
  fs.mkdirSync(attachments(), { recursive: true });
  fs.writeFileSync(path.join(attachments(), `${id}-${safe}`), Buffer.from(bytes));
  return id;
});
ipcMain.handle("files:get", (_event, id) => {
  const name = attachment(id);
  if (!name) return null;
  const bytes = fs.readFileSync(path.join(attachments(), name));
  return { bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), type: TYPES[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream" };
});
ipcMain.handle("files:keys", () => (fs.existsSync(attachments()) ? fs.readdirSync(attachments()).map((name) => name.slice(0, 36)).filter((id) => ID.test(id)) : []));
ipcMain.handle("files:delete", (_event, id) => {
  const name = attachment(id);
  if (name) fs.rmSync(path.join(attachments(), name));
});

// ---- Markdown copy: make the folder match `files` exactly ----
ipcMain.handle("vault:mirror", (_event, files) => {
  const base = path.join(vault(), "Markdown");
  const wanted = new Set();
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(base, relative);
    if (!target.startsWith(base + path.sep) || !target.endsWith(".md")) continue;
    wanted.add(target);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== contents) fs.writeFileSync(target, contents);
  }
  // Only .md files are ever removed, and only inside Markdown/: pages that were renamed, moved or deleted.
  const prune = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        prune(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      } else if (entry.name.endsWith(".md") && !wanted.has(full)) fs.rmSync(full);
    }
  };
  prune(base);
});

// ---- settings and page history: small named JSON files ----
const dataFile = (name) => (/^[a-z0-9-]{1,64}$/.test(name) ? path.join(vault(), ".burrow", `${name}.json`) : null);
ipcMain.handle("data:read", (_event, name) => {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), "utf8"));
  } catch {
    return null;
  }
});
ipcMain.handle("data:write", (_event, name, value) => {
  const file = dataFile(name);
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
});

// ---- link previews: what a page says about itself in its <head> ----
const decode = (text) => text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
ipcMain.handle("web:preview", async (_event, url) => {
  if (!/^https?:\/\//i.test(String(url))) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await net.fetch(url, { signal: controller.signal });
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await response.text()).slice(0, 500000);
    const meta = (name) => {
      const tag = html.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*>`, "i"))?.[0];
      return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? "");
    };
    let image = "";
    try {
      const absolute = new URL(meta("og:image"), response.url || url);
      if (absolute.protocol === "https:" && meta("og:image")) image = absolute.href;
    } catch {}
    return {
      title: (meta("og:title") || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "")).slice(0, 200),
      description: (meta("og:description") || meta("description")).slice(0, 300),
      image,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
});

// ---- plugins: found here, run by the page (never with access to Node) ----
const pluginsDir = () => path.join(vault(), "plugins");
const enabledFile = () => path.join(pluginsDir(), "enabled.json");
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const enabledPlugins = () => {
  try {
    const list = JSON.parse(fs.readFileSync(enabledFile(), "utf8"));
    return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
};

ipcMain.handle("plugins:list", () => {
  if (!fs.existsSync(pluginsDir())) return [];
  const enabled = enabledPlugins();
  const found = [];
  for (const entry of fs.readdirSync(pluginsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !PLUGIN_ID.test(entry.name)) continue;
    const folder = path.join(pluginsDir(), entry.name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, "manifest.json"), "utf8"));
      const script = path.join(folder, path.basename(String(manifest.main || "main.js")));
      // a plugin is a small script; anything huge is a mistake or worse
      if (fs.statSync(script).size > 2 * 1024 * 1024) continue;
      found.push({
        id: entry.name,
        name: String(manifest.name || entry.name).slice(0, 80),
        version: String(manifest.version || "0.0.0").slice(0, 20),
        description: String(manifest.description || "").slice(0, 300),
        enabled: enabled.includes(entry.name),
        source: fs.readFileSync(script, "utf8"),
      });
    } catch {
      // not a plugin folder (no manifest, no script): leave it alone
    }
  }
  return found;
});
ipcMain.handle("plugins:enable", (_event, id, on) => {
  if (!PLUGIN_ID.test(id)) return;
  const enabled = new Set(enabledPlugins());
  if (on) enabled.add(id);
  else enabled.delete(id);
  fs.mkdirSync(pluginsDir(), { recursive: true });
  fs.writeFileSync(enabledFile(), JSON.stringify([...enabled]));
});
ipcMain.handle("plugins:show", () => {
  fs.mkdirSync(pluginsDir(), { recursive: true });
  return shell.openPath(pluginsDir());
});

// ---- window ----
const external = (url) => /^(https?:|mailto:)/i.test(url) && shell.openExternal(url);

function createWindow() {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Burrow",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links leave for the system browser; the window itself only ever shows the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("app://burrow/")) return;
    event.preventDefault();
    external(url);
  });
  window.on("close", flush);
  window.loadURL("app://burrow/");
}

app.whenReady().then(() => {
  protocol.handle("app", async (request) => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const file = path.join(OUT, pathname === "/" ? "index.html" : pathname);
    if (!file.startsWith(OUT + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response("Not found", { status: 404 }));
  });
  createWindow();
});
app.on("before-quit", flush);
app.on("window-all-closed", () => app.quit());
