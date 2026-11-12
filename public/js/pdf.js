import { h, dropzone, pageHeader, extOf } from "./shared.js";
import { createQueue } from "./queue.js";
import { t } from "./i18n.js";

const OK = new Set(["docx", "xlsx", "pptx", "txt"]);

async function toPdf(file) {
  const res = await fetch("/convert?name=" + encodeURIComponent(file.name), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    throw new Error(t("pdf.failed"));
  }
  return res.blob();
}

async function checkHealth() {
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    return r.ok ? await r.json() : { pdf: false };
  } catch { return { pdf: false, unreachable: true }; }
}

export default async function mount(root) {
  let queue = null;
  const body = h("div");
  const toolSection = h("section", { class: "bg-tool-section pdf-tool-section", id: "pdf-converter-tool" },
    ...pageHeader(t("pdf.title"), t("pdf.description")),
    h("p", { class: "privacy-note", role: "note" }, t("pdf.privacyNotice")), body);
  const hero = h("section", { class: "bg-hero pdf-hero" },
    h("div", { class: "bg-hero-copy" },
      h("p", { class: "home-eyebrow" }, t("pdf.heroEyebrow")),
      h("h1", {}, t("pdf.heroTitle"), h("br"), h("strong", {}, t("pdf.heroEmphasis"))),
      h("p", { class: "bg-hero-description" }, t("pdf.heroDescription")),
      h("button", { class: "bg-hero-cta", onclick: () => toolSection.scrollIntoView({ behavior: "smooth", block: "start" }) }, t("pdf.tryTool"))),
    h("div", { class: "bg-hero-media" },
      h("video", {
        class: "bg-demo-video",
        src: "/videos/conversion_fichiers_etapes_h264.mp4",
        poster: "/images/documents-pdf-illustration.svg",
        autoplay: true,
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        "aria-label": t("pdf.videoLabel"),
        onerror: (event) => {
          const note = event.currentTarget.parentElement.querySelector(".bg-video-error");
          if (note) note.classList.remove("hide");
        },
      }),
      h("p", { class: "bg-video-error hide", role: "status" }, t("pdf.videoUnavailable"))));
  const showcase = h("section", { class: "quality-section pdf-showcase" },
    h("div", { class: "quality-copy" },
      h("p", { class: "home-eyebrow" }, t("pdf.showcaseEyebrow")),
      h("h2", {}, t("pdf.showcaseTitle")),
      h("p", { class: "quality-description" }, t("pdf.showcaseDescription"))),
    h("img", {
      class: "convert-showcase-image",
      src: "/images/documents-pdf-illustration.svg",
      alt: t("pdf.showcaseImageAlt"),
      loading: "lazy",
    }));

  root.append(hero, showcase, toolSection);

  async function render() {
    queue?.destroy(); queue = null;
    body.replaceChildren(h("p", { class: "status" }, t("pdf.checking")));
    const health = await checkHealth();
    if (!body.isConnected) return;

    if (!health.pdf) {
      body.replaceChildren(h("div", { class: "notice" },
        h("h2", {}, health.unreachable ? t("pdf.serverUnavailable") : t("pdf.notInstalled")),
        health.unreachable
          ? h("p", {}, t("pdf.startServer"), " ", h("code", {}, "node server.js"), " ", t("pdf.openAddress"))
          : [
              h("p", {}, t("pdf.installInfo")),
              h("p", {}, t("pdf.pathInfoStart"), " ", h("code", {}, "SOFFICE_BIN"),
                " ", t("pdf.pathInfoEnd"), " ", h("code", {}, "soffice"), " ", t("pdf.windowsInfo")),
            ],
        h("div", { class: "bar" }, h("button", { onclick: render }, t("pdf.checkAgain")))));
      return;
    }

    let toolbar;
    let selectAll;
    queue = createQueue({
      onChange: ({ size }) => {
        toolbar?.classList.toggle("hide", size === 0);
        if (!size && selectAll) selectAll.checked = false;
      },
      supported: (f) => OK.has(extOf(f.name)),
      outExt: () => "pdf",
      maxFileBytes: (health.maxFileMb || 25) * 1024 * 1024,
      maxFileSizeLabel: String(health.maxFileMb || 25),
      convert: (f) => toPdf(f),
    });
    selectAll = h("input", { type: "checkbox", "aria-label": t("queue.selectAll") });
    const convertAll = h("button", { onclick: async () => { convertAll.disabled = true; await queue.convertAll(); convertAll.disabled = false; } }, t("convert.all"));
    toolbar = h("div", { class: "bar queue-toolbar hide" },
      convertAll,
      h("button", { class: "ghost", onclick: () => queue.downloadSelected() }, t("queue.downloadSelected")),
      h("button", { class: "ghost", onclick: () => { queue.removeSelected(); selectAll.checked = false; toolbar.classList.toggle("hide", queue.size === 0); } }, t("queue.removeSelected")),
      h("button", { class: "ghost", onclick: () => { queue.clear(); selectAll.checked = false; toolbar.classList.add("hide"); } }, t("convert.clear")),
      h("label", { class: "opt queue-select-all" }, selectAll, t("queue.selectAll")));
    selectAll.addEventListener("change", () => queue.selectAll(selectAll.checked));
    const zone = dropzone({
      title: t("convert.dropTitle"), multiple: true,
      hint: t("pdf.maxSize", { size: health.maxFileMb || 25 }),
      accept: ".docx,.xlsx,.pptx,.txt",
      onFiles: (files) => { queue.add(files); toolbar.classList.toggle("hide", queue.size === 0); },
    });
    body.replaceChildren(zone, toolbar, queue.status, queue.el);
  }

  await render();
  return () => queue?.destroy();
}
