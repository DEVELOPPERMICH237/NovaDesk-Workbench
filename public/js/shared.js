// Small helpers shared by all tools.
import { getLanguage, t } from "./i18n.js";

// Build DOM without innerHTML, so file names and error text can never inject markup.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

export const fmtSize = (n) => {
  const amount = n > 1e6 ? (n / 1e6).toFixed(1) : String(Math.max(1, Math.round(n / 1e3)));
  const unit = n > 1e6 ? t("size.mb") : t("size.kb");
  return getLanguage() === "fr" ? amount.replace(".", ",") + " " + unit : amount + " " + unit;
};
export const baseName = (n) => n.replace(/\.[^.]+$/, "") || "file";
export const extOf = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");

// Drag-and-drop / click-to-choose area. Calls onFiles(File[]).
export function dropzone({ title, hint, accept, multiple = false, onFiles }) {
  const input = h("input", { type: "file", hidden: true, accept, multiple });
  input.addEventListener("click", (e) => e.stopPropagation());
  const zone = h("div", { class: "drop", tabindex: "0", role: "button" },
    h("strong", {}, title), t("drop.choose"), h("small", {}, hint), input);
  const open = () => input.click();
  zone.addEventListener("click", open);
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  input.addEventListener("change", () => { if (input.files.length) onFiles([...input.files]); input.value = ""; });
  for (const t of ["dragenter", "dragover"]) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.add("over"); });
  for (const t of ["dragleave", "drop"]) zone.addEventListener(t, (e) => { e.preventDefault(); zone.classList.remove("over"); });
  zone.addEventListener("drop", (e) => { const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : f.slice(0, 1)); });
  return zone;
}

// Tracks object URLs so a tool can release them all when the user leaves its tab.
export function urlTracker() {
  const urls = new Set();
  return {
    make(blob) { const u = URL.createObjectURL(blob); urls.add(u); return u; },
    free(u) { if (u && urls.delete(u)) URL.revokeObjectURL(u); },
    freeAll() { urls.forEach((u) => URL.revokeObjectURL(u)); urls.clear(); },
  };
}

export const pageHeader = (title, sub) => [h("h1", {}, title), h("p", { class: "sub" }, sub)];
