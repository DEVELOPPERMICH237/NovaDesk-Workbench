import { h, dropzone, pageHeader, extOf } from "./shared.js";
import { createQueue } from "./queue.js";
import { t } from "./i18n.js";

// Conversions that happen entirely in the browser: images, audio -> WAV, CSV <-> JSON.
const IMG_TARGETS = ["png", "jpg", "webp"];
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function kindOf(file) {
  const ext = extOf(file.name);
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  if (ext === "csv") return "csv";
  if (ext === "json") return "json";
  return null;
}

async function convertImage(file, target, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t("convert.imageDecode"))); i.src = url;
    });
    const w = img.naturalWidth || 1024, ht = img.naturalHeight || 1024; // SVGs may report 0
    const c = document.createElement("canvas"); c.width = w; c.height = ht;
    const ctx = c.getContext("2d");
    if (target === "jpg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, ht); } // JPG has no transparency
    ctx.drawImage(img, 0, 0, w, ht);
    const blob = await new Promise((res) => c.toBlob(res, MIME[target], quality));
    if (!blob || blob.type !== MIME[target]) throw new Error(t("convert.formatUnsupported", { format: target.toUpperCase() }));
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

async function convertAudio(file) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    let buf;
    try { buf = await ctx.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error(t("convert.audioDecode")); }
    return encodeWav(buf);
  } finally { ctx.close?.(); }
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels, rate = buf.sampleRate, len = buf.length;
  const dv = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); dv.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * 2, true);
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, chans[c][i]));
    dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([dv], { type: "audio/wav" });
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

async function csvToJson(file) {
  const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
  if (!rows.length) throw new Error(t("convert.csvEmpty"));
  const [head, ...rest] = rows;
  const out = rest.map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
  return new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
}

async function jsonToCsv(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error(t("convert.jsonInvalid")); }
  if (!Array.isArray(data)) data = [data];
  if (!data.every((d) => d && typeof d === "object" && !Array.isArray(d))) throw new Error(t("convert.jsonObjects"));
  const keys = [...new Set(data.flatMap((d) => Object.keys(d)))];
  const esc = (v) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [keys.map(esc).join(","), ...data.map((d) => keys.map((k) => esc(d[k])).join(","))];
  return new Blob([lines.join("\n")], { type: "text/csv" });
}

export default function mount(root) {
  const quality = h("input", { type: "range", min: "40", max: "100", value: "90", "aria-label": t("convert.quality") });
  const qv = h("span", {}, "90");
  quality.addEventListener("input", () => (qv.textContent = quality.value));

  const queue = createQueue({
    supported: (f) => !!kindOf(f),
    targets: (f) => {
      const k = kindOf(f), cur = extOf(f.name).replace("jpeg", "jpg");
      if (k === "image") return IMG_TARGETS.filter((t) => t !== cur);
      if (k === "audio") return ["wav"];
      return [k === "csv" ? "json" : "csv"];
    },
    outExt: (f, target) => target,
    convert: (f, target) => {
      const k = kindOf(f);
      if (k === "image") return convertImage(f, target, quality.value / 100);
      if (k === "audio") return convertAudio(f);
      return k === "csv" ? csvToJson(f) : jsonToCsv(f);
    },
  });

  const toolbar = h("div", { class: "bar hide" },
    h("button", { onclick: () => queue.convertAll() }, t("convert.all")),
    h("button", { class: "ghost", onclick: () => { queue.clear(); toolbar.classList.add("hide"); } }, t("convert.clear")),
    h("label", { class: "opt" }, t("convert.quality"), quality, qv));

  const zone = dropzone({
    title: t("convert.dropTitle"), multiple: true,
    hint: t("convert.dropHint"),
    onFiles: (files) => { queue.add(files); toolbar.classList.toggle("hide", queue.size === 0); },
  });

  const toolSection = h("section", { class: "bg-tool-section convert-tool-section", id: "convert-files-tool" },
    ...pageHeader(t("convert.title"), t("convert.description")), zone, toolbar, queue.el);
  const hero = h("section", { class: "bg-hero convert-hero" },
    h("div", { class: "bg-hero-copy" },
      h("p", { class: "home-eyebrow" }, t("convert.heroEyebrow")),
      h("h1", {}, t("convert.heroTitle"), h("br"), h("strong", {}, t("convert.heroEmphasis"))),
      h("p", { class: "bg-hero-description" }, t("convert.heroDescription")),
      h("button", { class: "bg-hero-cta", onclick: () => toolSection.scrollIntoView({ behavior: "smooth", block: "start" }) }, t("convert.tryTool"))),
    h("div", { class: "bg-hero-media" },
      h("video", {
        class: "bg-demo-video",
        src: "/videos/conversion_fichiers_etapes_h264.mp4",
        poster: "/images/convert-files-illustration.svg",
        autoplay: true,
        muted: true,
        loop: true,
        playsinline: true,
        controls: true,
        "aria-label": t("convert.videoLabel"),
        onerror: (event) => {
          const note = event.currentTarget.parentElement.querySelector(".bg-video-error");
          if (note) note.classList.remove("hide");
        },
      }),
      h("p", { class: "bg-video-error hide", role: "status" }, t("convert.videoUnavailable"))));

  const showcase = h("section", { class: "quality-section convert-showcase" },
    h("div", { class: "quality-copy" },
      h("p", { class: "home-eyebrow" }, t("convert.showcaseEyebrow")),
      h("h2", {}, t("convert.showcaseTitle")),
      h("p", { class: "quality-description" }, t("convert.showcaseDescription"))),
    h("img", {
      class: "convert-showcase-image",
      src: "/images/convert-files-illustration.svg",
      alt: t("convert.showcaseImageAlt"),
      loading: "lazy",
    }));

  root.append(hero, showcase, toolSection);
  return () => queue.destroy();
}
