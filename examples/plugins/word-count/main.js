// A sample Burrow plugin. Copy this folder into <your notes folder>/plugins/
// and turn it on under ⋯ → Plugins. `burrow` is the plugin API: docs/plugins.md

// A command for Ctrl+K.
burrow.addCommand({
  name: "Count words on this page",
  run() {
    const page = burrow.currentPage();
    if (!page) return burrow.notify("Open a page first.");
    const words = burrow.markdown(page).split(/\s+/).filter((word) => /\w/.test(word)).length;
    burrow.notify(`${words} words`);
  },
});

// A block kind for the slash menu. `data` is whatever this block last saved.
burrow.addBlock({
  id: "tally",
  label: "Tally counter",
  hint: "Click to count things",
  render(el, { data, update }) {
    const count = typeof data === "number" ? data : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Tally: ${count}`;
    button.style.cssText = "border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px;";
    button.addEventListener("click", () => update(count + 1));
    el.append(button);
  },
});
