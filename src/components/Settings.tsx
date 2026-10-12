"use client";

import { useEffect, useState, type ReactNode } from "react";
import { exportBackup } from "@/lib/actions";
import { desktop } from "@/lib/desktop";
import { ACCENTS, setPref, usePrefs, type Accent, type Prefs } from "@/lib/prefs";
import { Modal, PluginsPanel } from "./Dialogs";

export type SettingsTab = "general" | "appearance" | "editor" | "plugins" | "about";
const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "⚙" },
  { id: "appearance", label: "Appearance", icon: "🎨" },
  { id: "editor", label: "Editor", icon: "✎" },
  { id: "plugins", label: "Plugins", icon: "🧩" },
  { id: "about", label: "About", icon: "ⓘ" },
];
/** Kept in step with package.json by hand; shown under About. */
const VERSION = "0.1.0";

const button = "rounded-lg border border-border px-3 py-1 text-sm hover:bg-muted";

/** One setting: its name and explanation on the left, its control on the right. */
function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-6 border-b border-border py-3 last:border-0">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {help && <span className="block text-xs text-subtle">{help}</span>}
      </span>
      <span className="shrink-0">{children}</span>
    </label>
  );
}

const Check = ({ name, on, onChange }: { name: string; on: boolean; onChange: (on: boolean) => void }) => (
  <input type="checkbox" role="switch" aria-label={name} className="toggle" checked={on} onChange={(event) => onChange(event.target.checked)} />
);

export function SettingsDialog({ tab, onTab, onImport, onClose }: { tab: SettingsTab; onTab: (tab: SettingsTab) => void; onImport: () => void; onClose: () => void }) {
  const prefs = usePrefs();
  const bridge = desktop();
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    bridge?.folder().then(setFolder, () => {});
  }, [bridge]);

  let body: ReactNode;
  if (tab === "general") {
    body = (
      <>
        <div className="border-b border-border py-3">
          <div className="text-sm font-medium">Notes folder</div>
          {folder ? (
            <>
              <div className="break-all py-1 text-xs text-subtle">{folder}</div>
              <div className="flex gap-2">
                <button type="button" className={button} onClick={() => bridge?.showFolder()}>
                  Show the folder
                </button>
                <button type="button" className={button} onClick={() => bridge?.chooseFolder()}>
                  Use another folder…
                </button>
              </div>
            </>
          ) : (
            <div className="py-1 text-xs text-subtle">Notes are kept in this browser’s own storage. The desktop app keeps them in a folder you choose.</div>
          )}
        </div>
        <div className="border-b border-border py-3 last:border-0">
          <div className="text-sm font-medium">Backup</div>
          <div className="py-1 text-xs text-subtle">One file with every page. Importing adds a copy beside what is already here; it never replaces anything.</div>
          <div className="flex gap-2">
            <button type="button" className={button} onClick={exportBackup}>
              Export a backup
            </button>
            <button type="button" className={button} onClick={onImport}>
              Import a backup, web page or Markdown file
            </button>
          </div>
        </div>
      </>
    );
  } else if (tab === "appearance") {
    body = (
      <>
        <Row label="Theme" help="Light, dark, or whatever the system is using.">
          <select aria-label="Theme" className="rounded-lg border border-border bg-background px-2 py-1 text-sm" value={prefs.theme} onChange={(event) => setPref("theme", event.target.value as Prefs["theme"])}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
        <Row label="Accent colour" help="Used for selection, links and highlights.">
          <span className="flex gap-1.5" role="radiogroup" aria-label="Accent colour">
            {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={prefs.accent === accent}
                aria-label={accent}
                title={accent}
                className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background ${prefs.accent === accent ? "ring-2 ring-foreground" : ""}`}
                style={{ background: ACCENTS[accent] }}
                onClick={() => setPref("accent", accent)}
              />
            ))}
          </span>
        </Row>
        <Row label="Reduce transparency" help="Solid panels instead of see-through ones. Easier to read, and lighter on older graphics cards.">
          <Check name="Reduce transparency" on={prefs.reduceTransparency} onChange={(on) => setPref("reduceTransparency", on)} />
        </Row>
      </>
    );
  } else if (tab === "editor") {
    body = (
      <>
        <Row label="Full width by default" help="Pages use the whole window unless a page says otherwise.">
          <Check name="Full width by default" on={prefs.fullWidthDefault} onChange={(on) => setPref("fullWidthDefault", on)} />
        </Row>
        <Row label="Focus mode" help="Hides the sidebar and dims every block but the one you are writing.">
          <Check name="Focus mode" on={prefs.focusMode} onChange={(on) => setPref("focusMode", on)} />
        </Row>
        <Row label="Check spelling" help="Underlines words the system’s spell checker doesn’t know.">
          <Check name="Check spelling" on={prefs.spellcheck} onChange={(on) => setPref("spellcheck", on)} />
        </Row>
      </>
    );
  } else if (tab === "plugins") {
    body = <PluginsPanel />;
  } else {
    body = (
      <div className="flex flex-col gap-2 py-3 text-sm">
        <div className="text-lg font-semibold">Burrow {VERSION}</div>
        <p>A notes app that keeps your notes in a folder on your own computer. No account, nothing sent anywhere.</p>
        <p className="text-subtle">Open source under the MIT licence. Shortcuts: Ctrl+K search and commands, Ctrl+, settings, Ctrl+Z undo.</p>
      </div>
    );
  }

  return (
    <Modal title="Settings" wide onClose={onClose}>
      <div className="flex min-h-80 flex-col gap-4 md:flex-row">
        <div role="tablist" aria-label="Settings sections" className="flex shrink-0 gap-1 md:w-44 md:flex-col">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`rounded-lg px-3 py-1.5 text-left text-sm ${tab === item.id ? "bg-accent text-white" : "hover:bg-muted"}`}
              onClick={() => onTab(item.id)}
            >
              <span aria-hidden className="mr-2">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">{body}</div>
      </div>
    </Modal>
  );
}
