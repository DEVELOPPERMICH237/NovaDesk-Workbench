import { h, dropzone, pageHeader, extOf, fmtSize, baseName, urlTracker } from "./shared.js";
import { t } from "./i18n.js";

const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "webp"]);
const DEFAULT_MAX_MB = 25;

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    return response.ok ? response.json() : {};
  } catch { return {}; }
}

async function compressImage(file, type, quality, maxDimension) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = maxDimension ? Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(t("compress.failed"));
    if (type === "image/jpeg") {
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error(t("compress.failed"));
    return blob;
  } finally { bitmap.close?.(); }
}

export default async function mount(root) {
  const urls = urlTracker();
  const health = await checkHealth();
  const maxMb = Number(health.maxFileMb) || DEFAULT_MAX_MB;
  const maxBytes = maxMb * 1024 * 1024;
  let selected = null;
  let run = 0;

  const status = h("p", { class: "status", role: "status", "aria-live": "polite" }, t("compress.chooseFile"));
  const quality = h("input", { type: "range", min: "30", max: "95", value: "75", "aria-label": t("compress.quality") });
  const qualityValue = h("span", {}, "75%");
  quality.addEventListener("input", () => { qualityValue.textContent = `${quality.value}%`; });
  const qualityRow = h("label", { class: "opt compress-option" }, t("compress.quality"), quality, qualityValue);
  const dimension = h("select", { "aria-label": t("compress.maxDimension") },
    h("option", { value: "0" }, t("compress.originalDimensions")),
    [2560, 1920, 1280, 800].map((value) => h("option", { value, ...(value === 1920 ? { selected: true } : {}) }, `${value} px`)));
  const dimensionRow = h("label", { class: "opt compress-option" }, t("compress.maxDimension"), dimension);
  const pngNote = h("p", { class: "meta hide" }, t("compress.pngNote"));
  const preset = h("select", { "aria-label": t("compress.pdfPreset") },
    h("option", { value: "ebook" }, t("compress.pdfBalanced")),
    h("option", { value: "screen" }, t("compress.pdfSmall")),
    h("option", { value: "printer" }, t("compress.pdfPrint")));
  const presetRow = h("label", { class: "opt compress-option hide" }, t("compress.pdfPreset"), preset);
  const reduceButton = h("button", { disabled: true }, t("compress.reduce"));
  const download = h("a", { class: "btn hide", href: "#" }, t("compress.download"));
  const imagePrivacy = h("p", { class: "privacy-note hide" }, t("compress.imagePrivacy"));
  const pdfPrivacy = h("p", { class: "privacy-note hide" }, t("compress.pdfPrivacy"));
  const sizeLimit = h("p", { class: "meta" }, t("compress.sizeLimit", { size: maxMb }));

  const zone = dropzone({
    title: t("compress.dropTitle"),
    hint: t("compress.dropHint", { size: maxMb }),
    accept: ".jpg,.jpeg,.png,.webp,.pdf",
    onFiles: ([file]) => {
      run++;
      selected = file || null;
      const extension = selected ? extOf(selected.name) : "";
      const supported = extension === "pdf" || IMAGE_TYPES.has(extension);
      urls.free(download.dataset.url);
      download.removeAttribute("href");
      download.classList.add("hide");
      reduceButton.disabled = !selected || !supported || selected.size > maxBytes || (extension === "pdf" && !health.pdfCompression);
      qualityRow.classList.toggle("hide", !selected || !["jpg", "jpeg", "webp"].includes(extension));
      dimensionRow.classList.toggle("hide", !selected || !IMAGE_TYPES.has(extension));
      pngNote.classList.toggle("hide", !selected || extension !== "png");
      presetRow.classList.toggle("hide", !selected || extension !== "pdf");
      imagePrivacy.classList.toggle("hide", !selected || !IMAGE_TYPES.has(extension));
      pdfPrivacy.classList.toggle("hide", !selected || extension !== "pdf");
      if (!selected) status.textContent = t("compress.chooseFile");
      else if (!supported) status.textContent = t("compress.unsupported");
      else if (selected.size > maxBytes) status.textContent = t("compress.tooLarge", { size: maxMb });
      else if (extension === "pdf" && !health.pdfCompression) status.textContent = t("compress.pdfUnavailable");
      else status.textContent = t("compress.ready", { name: selected.name, size: fmtSize(selected.size) });
      status.classList.remove("err");
    },
  });

  reduceButton.addEventListener("click", async () => {
    if (!selected || selected.size > maxBytes) return;
    const mine = ++run;
    const file = selected;
    reduceButton.disabled = true;
    download.classList.add("hide");
    status.textContent = t("compress.working");
    try {
      let blob;
      const extension = extOf(selected.name);
      if (IMAGE_TYPES.has(extension)) {
        const mime = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[extension];
        blob = await compressImage(file, mime, Number(quality.value) / 100, Number(dimension.value));
      } else {
        const response = await fetch(`/compress-pdf?preset=${encodeURIComponent(preset.value)}`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: file,
        });
        if (!response.ok) {
          let message = t("compress.failed");
          try { message = (await response.json()).error || message; } catch {}
          throw new Error(message);
        }
        blob = await response.blob();
      }

      if (mine !== run) return;

      const reduced = blob.size < selected.size;
      const result = reduced ? blob : selected;
      const resultUrl = urls.make(result);
      download.dataset.url = resultUrl;
      download.href = resultUrl;
      download.download = `${baseName(selected.name)}-reduced.${extension === "jpeg" ? "jpg" : extension}`;
      download.classList.remove("hide");
      const percent = reduced ? Math.round((1 - result.size / selected.size) * 100) : 0;
      status.textContent = reduced
        ? t("compress.done", { before: fmtSize(selected.size), after: fmtSize(result.size), percent })
        : t("compress.noReduction", { size: fmtSize(selected.size) });
      status.classList.remove("err");
    } catch (error) {
      if (mine !== run) return;
      status.textContent = error.message || t("compress.failed");
      status.classList.add("err");
    } finally { if (mine === run) reduceButton.disabled = false; }
  });

  const section = h("section", { class: "bg-tool-section compress-tool-section" },
    ...pageHeader(t("compress.title"), t("compress.description")),
    sizeLimit, zone, h("div", { class: "bar compress-options" }, qualityRow, dimensionRow, presetRow), pngNote,
    h("div", { class: "bar" }, reduceButton, download), imagePrivacy, pdfPrivacy, status);
  const hero = h("section", { class: "bg-hero compress-hero" },
    h("div", { class: "bg-hero-copy" },
      h("p", { class: "home-eyebrow" }, t("compress.eyebrow")),
      h("h1", {}, t("compress.heroTitle")),
      h("p", { class: "bg-hero-description" }, t("compress.heroDescription")),
      h("button", { class: "bg-hero-cta", onclick: () => section.scrollIntoView({ behavior: "smooth", block: "start" }) }, t("compress.tryTool"))),
    h("div", { class: "bg-hero-media compress-hero-card" },
      h("div", { class: "compress-hero-icon", "aria-hidden": "true" }, "↓"),
      h("strong", {}, t("compress.heroCardTitle")),
      h("p", {}, t("compress.heroCardText"))));

  root.append(hero, section);
  return () => urls.freeAll();
}
