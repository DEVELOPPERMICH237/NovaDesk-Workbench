import { h, dropzone, urlTracker, baseName, pageHeader } from "./shared.js";
import { t } from "./i18n.js";

// The model runs in the browser via WebAssembly. It is downloaded the first time this tool is used.
const LIB_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm";
let libPromise = null;
const loadLib = () => (libPromise ??= import(LIB_URL).catch((e) => { libPromise = null; throw e; }));

export default function mount(root) {
  const urls = urlTracker();
  let run = 0;               // guards against overlapping runs
  let cutout = null;         // ImageBitmap of the transparent result
  let name = "image";

  const before = h("img", { alt: t("background.original") });
  const after = h("img", { alt: t("background.imageAlt") });
  const prog = h("progress", { max: "1", value: "0", class: "hide" });
  const status = h("p", { class: "status", role: "status" });
  const useColor = h("input", { type: "checkbox", id: "usecolor" });
  const color = h("input", { type: "color", value: "#ffffff", "aria-label": t("background.color") });
  const download = h("button", { disabled: true }, t("background.download"));
  const work = h("section", { id: "work", class: "hide" },
    h("div", { class: "grid" },
      h("figure", {}, h("figcaption", {}, t("background.original")), h("div", { class: "frame" }, before)),
      h("figure", {}, h("figcaption", {}, t("background.result")), h("div", { class: "frame" }, after))),
    prog, status,
    h("div", { class: "bar" }, download,
      h("label", { class: "opt" }, useColor, t("background.color"), color),
      h("button", { class: "ghost", onclick: reset }, t("background.newImage"))));

  const zone = dropzone({
    title: t("background.dropTitle"), hint: t("background.dropHint"),
    accept: "image/png,image/jpeg,image/webp", onFiles: ([f]) => handle(f),
  });

  const hero = h("section", { class: "bg-hero" },
    h("div", { class: "bg-hero-copy" },
      h("p", { class: "home-eyebrow" }, t("background.heroEyebrow")),
      h("h1", {}, h("span", {}, "# "), t("background.heroTitle"), h("br"), h("strong", {}, t("background.heroEmphasis"))),
      h("p", { class: "bg-hero-description" }, t("background.heroDescription")),
      h("button", { class: "bg-hero-cta", onclick: () => toolSection.scrollIntoView({ behavior: "smooth", block: "start" }) }, t("background.tryTool"))),
    h("div", { class: "bg-hero-media" },
      h("video", {
        class: "bg-demo-video",
        src: "/videos/emilia-main-c.mp4",
        poster: "/images/remove-background-illustration.svg",
        autoplay: true,
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        "aria-label": t("background.videoLabel"),
        onerror: (event) => {
          const note = event.currentTarget.parentElement.querySelector(".bg-video-error");
          if (note) note.classList.remove("hide");
        },
      }),
      h("p", { class: "bg-video-error hide", role: "status" }, t("background.videoUnavailable"))));

  const comparison = h("section", { class: "quality-section" },
    h("div", { class: "quality-copy" },
      h("p", { class: "home-eyebrow" }, t("background.qualityEyebrow")),
      h("h2", {}, t("background.qualityTitle")),
      h("p", { class: "quality-description" }, t("background.qualityDescription"))),
    h("div", { class: "quality-preview", style: "--compare-position:50%" },
      h("img", { class: "quality-image", src: "/images/quality-before.svg", alt: t("background.qualityBefore") }),
      h("img", { class: "quality-image quality-image-after", src: "/images/quality-after.svg", alt: t("background.qualityAfter") }),
      h("span", { class: "quality-label quality-label-before" }, t("background.qualityBefore")),
      h("span", { class: "quality-label quality-label-after" }, t("background.qualityAfter")),
      h("span", { class: "quality-divider", "aria-hidden": "true" })),
    h("input", {
      class: "quality-range",
      type: "range",
      min: "0",
      max: "100",
      value: "50",
      "aria-label": t("background.qualitySlider"),
      oninput: (event) => comparisonPreview.style.setProperty("--compare-position", `${event.currentTarget.value}%`),
    }));

  const comparisonPreview = comparison.querySelector(".quality-preview");
  const toolSection = h("section", { class: "bg-tool-section", id: "remove-background-tool" },
    ...pageHeader(t("background.title"), t("background.description")),
    h("p", { class: "privacy-note", role: "note" }, t("background.privacyNotice")), zone, work);

  root.append(hero, comparison, toolSection);

  function setStatus(text, isErr) { status.textContent = text; status.classList.toggle("err", !!isErr); }

  async function compose() {
    const c = document.createElement("canvas");
    c.width = cutout.width; c.height = cutout.height;
    const ctx = c.getContext("2d");
    if (useColor.checked) { ctx.fillStyle = color.value; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(cutout, 0, 0);
    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  async function render() {
    if (!cutout) return;
    const blob = await compose();
    urls.free(after.dataset.url);
    after.dataset.url = urls.make(blob);
    after.src = after.dataset.url;
  }

  async function handle(file) {
    if (!file.type.startsWith("image/")) { alert(t("background.chooseImage")); return; }
    const mine = ++run;
    name = baseName(file.name);
    cutout?.close?.(); cutout = null; download.disabled = true;
    urls.free(before.dataset.url);
    before.dataset.url = urls.make(file); before.src = before.dataset.url;
    after.removeAttribute("src");
    work.classList.remove("hide");
    prog.classList.remove("hide"); prog.value = 0;
    setStatus(t("background.loading"));
    try {
      const { removeBackground } = await loadLib();
      const blob = await removeBackground(file, {
        progress: (key, cur, total) => {
          if (mine !== run) return;
          if (total) prog.value = cur / total;
          setStatus(String(key).startsWith("fetch") ? t("background.downloading") : t("background.removing"));
        },
      });
      if (mine !== run) return;
      cutout = await createImageBitmap(blob);
      await render();
      setStatus(t("background.done"));
      download.disabled = false;
    } catch (e) {
      if (mine !== run) return;
      console.error(e);
      setStatus(t("background.failed"), true);
    } finally {
      if (mine === run) prog.classList.add("hide");
    }
  }

  function reset() {
    run++; cutout?.close?.(); cutout = null;
    urls.free(before.dataset.url); urls.free(after.dataset.url);
    work.classList.add("hide");
  }

  useColor.addEventListener("change", render);
  color.addEventListener("input", () => { useColor.checked = true; render(); });
  download.addEventListener("click", async () => {
    const blob = await compose();
    const a = h("a", { href: urls.make(blob), download: name + "-cutout.png" });
    a.click();
    setTimeout(() => urls.free(a.href), 1000);
  });

  return () => { run++; cutout?.close?.(); urls.freeAll(); };
}
