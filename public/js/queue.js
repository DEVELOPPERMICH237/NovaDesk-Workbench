import { h, fmtSize, baseName, extOf, urlTracker } from "./shared.js";
import { t } from "./i18n.js";

// A list of files, each with an optional target-format picker, a Convert button and a download link.
//   supported(file) -> boolean
//   targets(file)   -> string[] of output formats (omit if there is only one fixed output)
//   outExt(file, target) -> extension of the result
//   convert(file, target) -> Promise<Blob>
export function createQueue({ supported, targets, outExt, convert, maxFileBytes = Infinity, maxFileSizeLabel = "", onChange = () => {} }) {
  const el = h("ul", { class: "queue" });
  const batchStatus = h("p", { class: "status queue-batch-status hide", role: "status", "aria-live": "polite" });
  const items = [];
  const urls = urlTracker();

  function setState(it, text, cls = "") { it.state.textContent = text; it.state.className = "state " + cls; }
  function setBatchStatus(text) {
    batchStatus.textContent = text;
    batchStatus.classList.toggle("hide", !text);
  }
  function notifyChange() { onChange({ size: el.children.length, readyCount: items.filter((it) => it.done).length }); }

  async function run(it) {
    if (it.running || it.removed) return;
    it.running = true;
    it.selected.checked = false;
    it.selected.disabled = true;
    it.removeButton.disabled = true;
    if (it.select) it.select.disabled = true;
    it.btn.disabled = true; it.link.classList.add("hide");
    it.progress.removeAttribute("value");
    it.progress.classList.remove("hide");
    setState(it, t("queue.converting"));
    try {
      const target = it.select ? it.select.value : undefined;
      const blob = await convert(it.file, target);
      if (it.removed) return;
      urls.free(it.url);
      it.url = urls.make(blob);
      it.link.href = it.url;
      it.link.download = baseName(it.file.name) + "." + outExt(it.file, target);
      it.link.textContent = t("queue.download", { size: fmtSize(blob.size) });
      it.link.classList.remove("hide");
      it.done = true;
      setState(it, t("queue.done"), "ok");
    } catch (e) {
      if (it.removed) return;
      it.done = false;
      setState(it, (e && e.message) || t("queue.failed"), "err");
    } finally {
      it.running = false;
      if (!it.removed) {
        it.progress.classList.add("hide");
        it.btn.disabled = false;
        it.removeButton.disabled = false;
        if (it.select) it.select.disabled = false;
        it.selected.disabled = false;
      }
    }
  }

  function remove(it) {
    if (it.running) return;
    it.removed = true;
    urls.free(it.url);
    it.row.remove();
    const index = items.indexOf(it);
    if (index !== -1) items.splice(index, 1);
    notifyChange();
  }

  function add(file) {
    const tooLarge = file.size > maxFileBytes;
    const left = h("div", {}, h("div", { class: "name", title: file.name }, file.name),
      h("div", { class: "meta" }, fmtSize(file.size),
        tooLarge ? " · " + t("queue.tooLarge", { size: maxFileSizeLabel }) :
          (supported(file) ? "" : t("queue.unsupportedType"))));
    if (!supported(file) || tooLarge) {
      const row = h("li", {}, left, h("div", { class: "state err", role: "status", "aria-live": "polite" },
        tooLarge ? t("queue.fileTooLarge") : t("queue.notSupported")));
      row.append(h("button", { class: "ghost queue-remove", type: "button", "aria-label": t("queue.removeFile", { name: file.name }), onclick: () => { row.remove(); notifyChange(); } }, "×"));
      el.append(row);
      return;
    }
    const state = h("div", { class: "state", role: "status", "aria-live": "polite" });
    const link = h("a", { class: "dl hide" });
    const btn = h("button", {}, t("queue.convert"));
    const progress = h("progress", { class: "queue-progress hide", "aria-label": t("queue.converting") });
    const opts = targets ? targets(file) : null;
    const select = opts ? h("select", { "aria-label": t("queue.convertTo") }, opts.map((o) => h("option", { value: o }, o.toUpperCase()))) : null;
    const selected = h("input", { type: "checkbox", class: "queue-select", "aria-label": t("queue.selectFile", { name: file.name }) });
    const removeButton = h("button", { class: "ghost queue-remove", type: "button", "aria-label": t("queue.removeFile", { name: file.name }) }, "×");
    const row = h("li", {}, left, select || h("span"), btn, h("div", { class: "queue-result" }, progress, state, link),
      h("div", { class: "queue-actions" }, selected, removeButton));
    const it = { file, btn, state, link, select, selected, progress, row, removeButton, done: false, running: false, removed: false, url: null };
    btn.addEventListener("click", () => run(it));
    if (select) select.addEventListener("change", () => {
      it.done = false;
      it.selected.checked = false;
      it.selected.disabled = false;
      it.link.classList.add("hide");
      urls.free(it.url); it.url = null;
    });
    selected.addEventListener("change", () => { if (!items.some((item) => item.selected.checked)) setBatchStatus(""); });
    removeButton.addEventListener("click", () => remove(it));
    el.append(row);
    items.push(it);
  }

  return {
    el,
    status: batchStatus,
    add(files) { files.forEach(add); notifyChange(); },
    get size() { return el.children.length; },
    get readyCount() { return items.filter((it) => it.done).length; },
    selectAll(checked) { items.forEach((it) => { if (!it.selected.disabled) it.selected.checked = checked; }); },
    removeSelected() { items.filter((it) => it.selected.checked).forEach(remove); },
    downloadSelected() {
      const selectedItems = items.filter((it) => it.selected.checked && it.done);
      selectedItems.forEach((it) => it.link.click());
      setBatchStatus(selectedItems.length ? t("queue.downloadStarted", { count: selectedItems.length }) : t("queue.selectCompleted"));
    },
    async convertAll() {
      const pending = items.filter((it) => !it.done);
      for (const [index, it] of pending.entries()) {
        setBatchStatus(t("queue.batchProgress", { current: index + 1, total: pending.length, name: it.file.name }));
        await run(it);
      }
      if (pending.length) setBatchStatus(t("queue.batchDone", { count: pending.length }));
    },
    clear() { items.forEach((it) => { it.removed = true; }); urls.freeAll(); items.length = 0; el.replaceChildren(); notifyChange(); },
    destroy() { urls.freeAll(); },
  };
}

export { extOf };
