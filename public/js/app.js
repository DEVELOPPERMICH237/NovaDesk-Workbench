import { getLanguage, setLanguage, t } from "./i18n.js";

// Hash router: each tool is a module whose default export is mount(root) -> cleanup().
const TOOLS = [
  {
    id: "background", labelKey: "tool.background", descriptionKey: "tool.background.description", detailKey: "tool.background.detail",
    icon: "✂",
    image: "/images/tools.png", imageAltKey: "tool.background.imageAlt",
    steps: ["tool.background.step1", "tool.background.step2", "tool.background.step3"],
    load: () => import("./bg.js"),
  },
  {
    id: "convert", labelKey: "tool.convert", descriptionKey: "tool.convert.description", detailKey: "tool.convert.detail",
    icon: "⇄",
    image: "/images/convert-files-illustration.svg", imageAltKey: "tool.convert.imageAlt",
    steps: ["tool.convert.step1", "tool.convert.step2", "tool.convert.step3"],
    load: () => import("./convert.js"),
  },
  {
    id: "compress", labelKey: "tool.compress", descriptionKey: "tool.compress.description", detailKey: "tool.compress.detail",
    icon: "↓",
    image: "/images/convert-files-illustration.svg", imageAltKey: "tool.compress.imageAlt",
    steps: ["tool.compress.step1", "tool.compress.step2", "tool.compress.step3"],
    load: () => import("./compress.js"),
  },
  {
    id: "pdf", labelKey: "tool.pdf", descriptionKey: "tool.pdf.description", detailKey: "tool.pdf.detail",
    icon: "PDF",
    image: "/images/documents-pdf-illustration.svg", imageAltKey: "tool.pdf.imageAlt",
    steps: ["tool.pdf.step1", "tool.pdf.step2", "tool.pdf.step3"],
    load: () => import("./pdf.js"),
  },
];

const nav = document.getElementById("nav");
const navToggle = document.getElementById("nav-toggle");
const topBar = document.querySelector(".top");
const view = document.getElementById("view");
const languageToggle = document.getElementById("language-toggle");
const themeToggle = document.getElementById("theme-toggle");
const productName = document.querySelector(".product-name");
const brand = document.querySelector(".brand");
const footer = document.querySelector(".site-footer");
const savedTheme = document.documentElement.dataset.theme;
let currentTheme = savedTheme === "light" || savedTheme === "dark"
  ? savedTheme
  : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
document.documentElement.dataset.theme = currentTheme;
let cleanup = null;
let token = 0;
let revealObserver = null;

function setNavOpen(open) {
  topBar.classList.toggle("nav-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
  navToggle.setAttribute("aria-label", t(open ? "nav.close" : "nav.open"));
}

function renderThemeToggle() {
  const switchingTo = currentTheme === "dark" ? "light" : "dark";
  themeToggle.textContent = t(`theme.to${switchingTo === "dark" ? "Dark" : "Light"}`);
  themeToggle.setAttribute("aria-label", t(`theme.ariaTo${switchingTo === "dark" ? "Dark" : "Light"}`));
}

function renderNavigation() {
  document.documentElement.lang = getLanguage();
  languageToggle.textContent = t("language.switch");
  languageToggle.setAttribute("aria-label", t("language.aria"));
  navToggle.setAttribute("aria-label", t(topBar.classList.contains("nav-open") ? "nav.close" : "nav.open"));
  nav.setAttribute("aria-label", t("nav.tools"));
  productName.textContent = t("product.name");
  brand.setAttribute("aria-label", `NovaDesk ${t("nav.home").toLowerCase()}`);
  footer.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  footer.querySelector(".footer-socials").setAttribute("aria-label", t("footer.socialLabel"));
  renderThemeToggle();
  nav.replaceChildren();

  const links = [{ id: "", label: t("nav.home") }, ...TOOLS.map((tool) => ({ id: tool.id, label: t(tool.labelKey) }))];
  for (const item of links) {
    const a = document.createElement("a");
    a.href = item.id ? "#/" + item.id : "#/";
    a.textContent = item.label;
    a.dataset.id = item.id;
    nav.append(a);
  }
}

navToggle.addEventListener("click", () => setNavOpen(navToggle.getAttribute("aria-expanded") !== "true"));
nav.addEventListener("click", (event) => {
  if (event.target.closest("a")) setNavOpen(false);
});
document.addEventListener("click", (event) => {
  if (topBar.classList.contains("nav-open") && !topBar.contains(event.target)) setNavOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && topBar.classList.contains("nav-open")) {
    setNavOpen(false);
    navToggle.focus();
  }
});
window.matchMedia("(min-width: 881px)").addEventListener("change", (event) => {
  if (event.matches) setNavOpen(false);
});

function localizedTool(tool, key) {
  return t(tool[key]);
}

function enableHomeScrollEffects(page) {
  const revealItems = page.querySelectorAll(".home-hero, .home-section-title, .walkthrough-card, .tool-overview-card");
  revealItems.forEach((item, index) => {
    item.classList.add("scroll-reveal");
    item.style.setProperty("--reveal-delay", `${(index % 3) * 90}ms`);
  });
  page.classList.add("has-scroll-reveal");

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((item) => item.classList.add("is-visible"));
    return;
  }

  revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -36px 0px" });
  revealItems.forEach((item) => revealObserver.observe(item));
}

async function route() {
  revealObserver?.disconnect();
  revealObserver = null;
  const id = location.hash.replace(/^#\/?/, "");
  if (!id) {
    const mine = ++token;
    for (const a of nav.children) {
      if (a.dataset.id === "") a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    document.title = t("home.documentTitle");
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    view.replaceChildren();

    const page = document.createElement("section");
    page.className = "home-page";
    const hero = document.createElement("div");
    hero.className = "home-hero";
    const eyebrow = document.createElement("p");
    eyebrow.className = "home-eyebrow";
    eyebrow.textContent = t("home.eyebrow");
    const titleRow = document.createElement("div");
    titleRow.className = "home-title-row";
    const logo = document.createElement("img");
    logo.className = "home-logo";
    logo.src = "/images/Capture_d_écran_2026-10-05_180356-removebg-preview.png";
    logo.alt = t("home.logoAlt");
    const heading = document.createElement("h1");
    heading.tabIndex = -1;
    heading.textContent = t("home.title");
    titleRow.append(logo, heading);
    const intro = document.createElement("p");
    intro.className = "home-intro";
    intro.textContent = t("home.intro");
    hero.append(eyebrow, titleRow, intro);

    const toolSectionTitle = document.createElement("h2");
    toolSectionTitle.className = "home-section-title choose-tool-title";
    toolSectionTitle.textContent = t("home.chooseTool");
    const toolCards = document.createElement("div");
    toolCards.className = "tool-overview-grid";
    const walkthroughTitle = document.createElement("h2");
    walkthroughTitle.className = "home-section-title walkthrough-title";
    walkthroughTitle.textContent = t("home.howItWorks");
    const walkthroughCards = document.createElement("div");
    walkthroughCards.className = "walkthrough-grid";
    for (const tool of TOOLS) {
      const toolCard = document.createElement("a");
      toolCard.className = "tool-overview-card";
      toolCard.href = "#/" + tool.id;
      toolCard.setAttribute("aria-label", `${t("home.openTool")}: ${localizedTool(tool, "labelKey")}`);
      const toolIcon = document.createElement("span");
      toolIcon.className = "tool-overview-icon";
      toolIcon.setAttribute("aria-hidden", "true");
      toolIcon.textContent = tool.icon;
      const detail = document.createElement("p");
      detail.className = "tool-detail";
      detail.textContent = localizedTool(tool, "detailKey");
      const title = document.createElement("h3");
      title.textContent = localizedTool(tool, "labelKey");
      const description = document.createElement("p");
      description.className = "tool-description";
      description.textContent = localizedTool(tool, "descriptionKey");
      const linkText = document.createElement("span");
      linkText.className = "tool-link";
      linkText.textContent = t("home.openTool");
      toolCard.append(toolIcon, detail, title, description, linkText);
      toolCards.append(toolCard);

      const card = document.createElement("article");
      card.className = "walkthrough-card";
      const illustration = document.createElement("img");
      illustration.className = "tool-illustration";
      illustration.src = tool.image;
      illustration.alt = localizedTool(tool, "imageAltKey");
      illustration.loading = "lazy";
      const content = document.createElement("div");
      content.className = "walkthrough-content";
      const walkthroughHeading = document.createElement("h3");
      walkthroughHeading.className = "walkthrough-heading";
      walkthroughHeading.textContent = localizedTool(tool, "labelKey");
      const steps = document.createElement("ol");
      steps.className = "tool-steps";
      for (const stepKey of tool.steps) {
        const step = document.createElement("li");
        step.textContent = t(stepKey);
        steps.append(step);
      }
      content.append(walkthroughHeading, steps);
      card.append(illustration, content);
      walkthroughCards.append(card);
    }
    page.append(hero, walkthroughTitle, walkthroughCards, toolSectionTitle, toolCards);
    view.append(page);
    enableHomeScrollEffects(page);
    heading.focus({ preventScroll: true });
    if (mine !== token) return;
    return;
  }

  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) { location.hash = "#/"; return; }

  const mine = ++token;
  for (const a of nav.children) {
    if (a.dataset.id === id) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  document.title = localizedTool(tool, "labelKey") + " · NovaDesk";

  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  view.replaceChildren();

  try {
    const mod = await tool.load();
    if (mine !== token) return; // user already moved on
    const root = document.createElement("div");
    view.append(root);
    const c = await mod.default(root);
    if (mine !== token) { if (c) c(); return; }
    cleanup = c || null;
    const heading = view.querySelector("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  } catch (e) {
    console.error(e);
    if (mine !== token) return;
    const p = document.createElement("p");
    p.className = "status err";
    p.textContent = t("app.loadError");
    view.replaceChildren(p);
  }
}

languageToggle.addEventListener("click", () => {
  const hasWork = view.querySelector(".queue li, #work:not(.hide)");
  if (hasWork && !window.confirm(t("language.resetNotice"))) return;
  setLanguage(getLanguage() === "en" ? "fr" : "en");
});
themeToggle.addEventListener("click", () => {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = currentTheme;
  try { localStorage.setItem("novadesk-theme", currentTheme); } catch {}
  renderThemeToggle();
});
window.addEventListener("languagechange", () => {
  renderNavigation();
  route();
});
renderNavigation();
addEventListener("hashchange", route);
route();
