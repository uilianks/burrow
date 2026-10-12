import { describe, expect, it } from "vitest";
import { createPage } from "./commands";
import { loadPlugins, pluginState, type FoundPlugin } from "./plugins";
import { ROOT } from "./store";
import { store } from "./workspace";

const plugin = (id: string, source: string, enabled = true): FoundPlugin => ({ id, name: id.toUpperCase(), version: "1.0.0", description: "", enabled, source });

describe("plugin settings and sidebar", () => {
  it("gives a plugin its saved settings, lets it store new ones, and reports late failures", async () => {
    loadPlugins(
      [
        plugin(
          "cfg",
          `burrow.addSetting({ key: "token", label: "Token", secret: true });
           burrow.addSidebarItem({ label: "Open thing", run: () => burrow.settings.set("opened", burrow.settings.get("token") + "!") });
           burrow.addCommand({ name: "Later", run: async () => { throw new Error("too late"); } });
           globalThis.startedWith = burrow.settings.get("token");`,
        ),
      ],
      { cfg: { token: "abc" } },
    );
    const state = pluginState();
    expect((globalThis as { startedWith?: string }).startedWith).toBe("abc");
    expect(state.settings).toEqual([{ plugin: "cfg", key: "token", label: "Token", secret: true, placeholder: "" }]);
    state.sidebar[0].run();
    expect(pluginState().values.cfg).toEqual({ token: "abc", opened: "abc!" });
    state.commands[0].run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pluginState().plugins[0].error).toBe("While running “Later”: too late");
  });
});

describe("plugins", () => {
  it("runs enabled plugins, skips disabled ones, and contains the ones that fail", async () => {
    await store.load(() => [{ id: ROOT, type: "page", text: "", parent: null, content: [] }]);
    const home = createPage(store);
    store.commit([{ op: "update", id: home, patch: { text: "Home" } }]);
    const seen: unknown[] = [];
    (globalThis as { seen?: unknown[] }).seen = seen;

    loadPlugins([
      plugin(
        "good",
        `burrow.addCommand({ name: "Stamp", run: () => burrow.append(burrow.pages()[0].id, "- stamped **now**") });
         burrow.addCommand({ name: "Break", run: () => { throw new Error("boom"); } });
         burrow.addBlock({ id: "box", label: "Box", render: (el, ctx) => { el.textContent = String(ctx.data ?? 0); } });
         burrow.onChange(() => globalThis.seen.push(burrow.markdown(burrow.pages()[0].id)));`,
      ),
      plugin("off", `globalThis.seen.push("disabled plugin ran")`, false),
      plugin("half", `burrow.addCommand({ name: "Never", run() {} }); burrow.addBlock({ id: "", label: "x", render() {} });`),
      plugin("broken", `this is not javascript`),
      plugin("nosy", `burrow.addCommand({ name: "Peek", run: () => require("fs") });`),
    ]);

    const state = pluginState();
    expect(state.commands.map((c) => c.name)).toEqual(["Stamp", "Break", "Peek"]);
    expect(state.blocks.map((b) => [b.key, b.label, b.hint])).toEqual([["good/box", "Box", "From the plugin GOOD"]]);
    expect(state.plugins.map((p) => [p.id, p.enabled, p.error?.replace(/:.*/, "")])).toEqual([
      ["good", true, undefined],
      ["off", false, undefined],
      ["half", true, "While starting"],
      ["broken", true, "While starting"],
      ["nosy", true, undefined],
    ]);
    expect(state.plugins[2].error).toBe("While starting: A block's id must be a non-empty string");

    state.commands[0].run();
    const added = store.getSnapshot()[store.getSnapshot()[home].content.at(-1)!];
    expect(added).toMatchObject({ type: "bullet", text: "stamped <b>now</b>" });
    // the page still has the empty line every new page starts with, above the appended block
    expect(seen).toEqual(["# Home\n\n\n- stamped **now**\n"]);

    // a command that throws is reported against its plugin and nothing else breaks
    expect(() => state.commands[1].run()).not.toThrow();
    expect(pluginState().plugins[0].error).toBe("While running “Break”: boom");
    expect(pluginState().message).toBe("The plugin “GOOD” ran into a problem while running “Break”: boom");
    state.commands[2].run();
    expect(pluginState().plugins[4].error).toContain("require is not defined");
    state.commands[0].run();
    expect(seen).toHaveLength(2);
  });
});
