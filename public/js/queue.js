import { h, fmtSize, baseName, extOf, urlTracker } from "./shared.js";
import { t } from "./i18n.js";

// A list of files, each with an optional target-format picker, a Convert button and a download link.
//   supported(file) -> boolean
//   targets(file)   -> string[] of output formats (omit if there is only one fixed output)
//   outExt(file, target) -> extension of the result
//   convert(file, target) -> Promise<Blob>
export function createQueue({ supported, targets, outExt, convert, maxFileBytes = Infinity, maxFileSizeLabel = "" }) {
  const el = h("ul", { class: "queue" });
  const items = [];
  const urls = urlTracker();

  function setState(it, text, cls = "") { it.state.textContent = text; it.state.className = "state " + cls; }

  async function run(it) {
    it.btn.disabled = true; it.link.classList.add("hide");
    setState(it, t("queue.converting"));
    try {
      const target = it.select ? it.select.value : undefined;
      const blob = await convert(it.file, target);
      urls.free(it.url);
      it.url = urls.make(blob);
      it.link.href = it.url;
      it.link.download = baseName(it.file.name) + "." + outExt(it.file, target);
      it.link.textContent = t("queue.download", { size: fmtSize(blob.size) });
      it.link.classList.remove("hide");
      it.done = true;
      setState(it, t("queue.done"), "ok");
    } catch (e) {
      it.done = false;
      setState(it, (e && e.message) || t("queue.failed"), "err");
    } finally { it.btn.disabled = false; }
  }

  function add(file) {
    const tooLarge = file.size > maxFileBytes;
    const left = h("div", {}, h("div", { class: "name", title: file.name }, file.name),
      h("div", { class: "meta" }, fmtSize(file.size),
        tooLarge ? " · " + t("queue.tooLarge", { size: maxFileSizeLabel }) :
          (supported(file) ? "" : t("queue.unsupportedType"))));
    if (!supported(file) || tooLarge) {
      el.append(h("li", {}, left, h("div", { class: "state err", role: "status", "aria-live": "polite" },
        tooLarge ? t("queue.fileTooLarge") : t("queue.notSupported"))));
      return;
    }
    const state = h("div", { class: "state", role: "status", "aria-live": "polite" });
    const link = h("a", { class: "dl hide" });
    const btn = h("button", {}, t("queue.convert"));
    const opts = targets ? targets(file) : null;
    const select = opts ? h("select", { "aria-label": t("queue.convertTo") }, opts.map((o) => h("option", { value: o }, o.toUpperCase()))) : null;
    const it = { file, btn, state, link, select, done: false, url: null };
    btn.addEventListener("click", () => run(it));
    if (select) select.addEventListener("change", () => { it.done = false; });
    el.append(h("li", {}, left, select || h("span"), btn, h("div", {}, state, link)));
    items.push(it);
  }

  return {
    el,
    add: (files) => files.forEach(add),
    get size() { return el.children.length; },
    async convertAll() { for (const it of items) if (!it.done) await run(it); },
    clear() { urls.freeAll(); items.length = 0; el.replaceChildren(); },
    destroy() { urls.freeAll(); },
  };
}

export { extOf };
