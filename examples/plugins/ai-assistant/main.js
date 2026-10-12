// AI help for Folio, with your own provider. Copy this folder into
// <your notes folder>/plugins/, turn it on under ⋯ → Plugins, and fill in
// the settings there.
//
// By default it calls Claude through the Anthropic API with your API key
// (https://platform.claude.com). The page you run a command on is sent to
// that service; nothing else is. To keep everything on your computer, fill
// in "Local model address" instead: any server that speaks the common
// chat-completions format works, for example Ollama at
// http://localhost:11434/v1/chat/completions.

folio.addSetting({ key: "apiKey", label: "Claude API key", secret: true, placeholder: "sk-ant-…" });
folio.addSetting({ key: "model", label: "Model", placeholder: "claude-opus-5-5" });
folio.addSetting({ key: "endpoint", label: "Local model address", placeholder: "leave empty to use Claude" });

async function askClaude(instruction, text) {
  const apiKey = folio.settings.get("apiKey").trim();
  if (!apiKey) throw new Error("add your Claude API key under ⋯ → Plugins first");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // lets a declined request be retried on the model Anthropic recommends for it
      "anthropic-beta": "server-side-fallback-2026-07-01",
      // required for calls made straight from an app window rather than a server
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: folio.settings.get("model").trim() || "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
      system: instruction,
      messages: [{ role: "user", content: text }],
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || `the service answered with status ${response.status}`);
  if (body.stop_reason === "refusal") throw new Error("the model declined this request");
  // the answer is a list of blocks; the words are in the ones of type "text"
  const answer = body.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  if (body.stop_reason === "max_tokens") return `${answer}\n\n(The answer was cut off because it reached the length limit.)`;
  return answer;
}

async function askLocal(endpoint, instruction, text) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: folio.settings.get("model").trim() || "llama3.2",
      stream: false,
      messages: [
        { role: "system", content: instruction },
        { role: "user", content: text },
      ],
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message || body?.error || `the local model answered with status ${response.status}`);
  return String(body?.choices?.[0]?.message?.content ?? body?.message?.content ?? "").trim();
}

const STYLE = "Answer in the same language as the notes. Write plain Markdown: short paragraphs, '-' bullets, '- [ ]' for tasks. No preamble and no closing remarks.";

/** Runs an instruction over the open page and adds the answer to the end of it. */
async function run(title, instruction) {
  const page = folio.currentPage();
  if (!page) return folio.notify("Open a page first.");
  const endpoint = folio.settings.get("endpoint").trim();
  folio.notify(`${title}: working…`);
  const text = folio.markdown(page);
  const answer = endpoint ? await askLocal(endpoint, `${instruction} ${STYLE}`, text) : await askClaude(`${instruction} ${STYLE}`, text);
  if (!answer) throw new Error("the model sent back nothing");
  folio.append(page, `## ${title}\n${answer}`);
  folio.notify(`${title}: added to the end of the page.`);
}

folio.addCommand({ name: "AI: Summarise this page", run: () => run("Summary", "Summarise these notes in a few bullet points, keeping names, numbers and dates exact.") });
folio.addCommand({
  name: "AI: Meeting notes from this page",
  run: () => run("Meeting notes", "These are rough notes or a transcript of a meeting. Write clean meeting notes: a two-sentence summary, the decisions made, then the action items as tasks with the owner's name when one is given. Do not invent anything that is not in the notes."),
});
folio.addCommand({ name: "AI: Continue writing", run: () => run("Continued", "Continue this text for one or two paragraphs in the same voice and style. Give only the continuation.") });
folio.addSidebarItem({ label: "Summarise page", run: () => run("Summary", "Summarise these notes in a few bullet points, keeping names, numbers and dates exact.") });
