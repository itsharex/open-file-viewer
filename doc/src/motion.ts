/**
 * Site-wide motion runtime: scroll reveal, spotlight/tilt cards, counters,
 * hero scene cycling, scroll progress and sidebar scrollspy.
 * Everything degrades gracefully when `prefers-reduced-motion` is set.
 */

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

let revealObserver: IntersectionObserver | null = null;
let counterObserver: IntersectionObserver | null = null;

function prefersReducedMotion(): boolean {
  return reducedMotion.matches;
}

/** The boot script clears [data-motion] when the bundle loads too slowly —
 *  in that case reveal everything statically instead of animating. */
function motionEnabled(): boolean {
  return document.documentElement.dataset.motion === "on" && !prefersReducedMotion();
}

/* ---------------------------------------------------------------- reveal -- */

function ensureRevealObserver(): IntersectionObserver | null {
  if (!motionEnabled()) {
    return null;
  }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            revealObserver?.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
  }
  return revealObserver;
}

/** Auto-decorate content blocks that should animate in on scroll. */
function autoDecorate(): void {
  const autoTargets = document.querySelectorAll<HTMLElement>(
    [
      ".doc-panel",
      ".format-grid > article",
      ".doc-card-grid > article",
      ".doc-faq details"
    ].join(", ")
  );
  let groupIndex = 0;
  for (const element of autoTargets) {
    if (!element.hasAttribute("data-reveal")) {
      element.setAttribute("data-reveal", "");
      element.setAttribute("data-reveal-delay", String(groupIndex % 4));
      groupIndex += 1;
    }
  }
}

export function rescanReveals(): void {
  autoDecorate();
  const targets = document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)");
  const observer = ensureRevealObserver();
  for (const target of targets) {
    if (!observer) {
      target.classList.add("is-revealed");
      continue;
    }
    observer.observe(target);
  }
}

/* -------------------------------------------------------------- counters -- */

function animateCounter(element: HTMLElement): void {
  const target = Number(element.dataset.countTo || "0");
  if (!Number.isFinite(target) || target <= 0 || prefersReducedMotion()) {
    element.textContent = String(target);
    return;
  }
  const duration = 1400;
  const start = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

function initCounters(): void {
  const counters = document.querySelectorAll<HTMLElement>("[data-count-to]");
  if (!counters.length) {
    return;
  }
  counterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          animateCounter(entry.target as HTMLElement);
          counterObserver?.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.5 }
  );
  for (const counter of counters) {
    counterObserver.observe(counter);
  }
}

/* -------------------------------------------------- spotlight tilt cards -- */

function initCardMotion(): void {
  if (!finePointer.matches || prefersReducedMotion()) {
    return;
  }
  const maxTilt = 5;
  document.addEventListener(
    "pointermove",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tilt], [data-spotlight]");
      if (!target) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      if (target.hasAttribute("data-spotlight")) {
        target.style.setProperty("--mx", `${(px * 100).toFixed(2)}%`);
        target.style.setProperty("--my", `${(py * 100).toFixed(2)}%`);
      }
      if (target.hasAttribute("data-tilt")) {
        target.style.setProperty("--tilt-x", `${((py - 0.5) * -2 * maxTilt).toFixed(2)}deg`);
        target.style.setProperty("--tilt-y", `${((px - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
      }
    },
    { passive: true }
  );
  document.addEventListener(
    "pointerout",
    (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-tilt]");
      if (target && !target.contains(event.relatedTarget as Node | null)) {
        target.style.setProperty("--tilt-x", "0deg");
        target.style.setProperty("--tilt-y", "0deg");
      }
    },
    { passive: true }
  );
}

/* ------------------------------------------------------- scroll progress -- */

function initScrollProgress(): void {
  const bar = document.getElementById("scrollProgress");
  if (!bar) {
    return;
  }
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    bar.style.transform = `scaleX(${ratio.toFixed(4)})`;
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();
}

/* ------------------------------------------------------------ hero stage -- */

const sceneFiles: Record<string, string> = {
  pdf: "contract.pdf",
  xlsx: "revenue-q3.xlsx",
  png: "landscape.png",
  glb: "turbine.glb",
  zip: "design-kit.zip",
  mp3: "voice-note.mp3"
};

function initHeroStage(): void {
  const stage = document.querySelector<HTMLElement>(".hero-stage");
  if (!stage) {
    return;
  }
  const railButtons = Array.from(stage.querySelectorAll<HTMLButtonElement>(".file-rail button"));
  const scenes = Array.from(stage.querySelectorAll<HTMLElement>(".scene"));
  const fileLabel = stage.querySelector<HTMLElement>("#stageFile");
  if (!railButtons.length || !scenes.length) {
    return;
  }

  let activeIndex = 0;
  let timer = 0;

  const activate = (index: number) => {
    activeIndex = (index + railButtons.length) % railButtons.length;
    const key = railButtons[activeIndex].dataset.scene || "pdf";
    for (const button of railButtons) {
      button.classList.toggle("is-active", button.dataset.scene === key);
    }
    for (const scene of scenes) {
      scene.classList.toggle("is-active", scene.dataset.scene === key);
    }
    if (fileLabel) {
      fileLabel.textContent = sceneFiles[key] || key;
    }
    stage.classList.remove("is-scanning");
    if (!prefersReducedMotion()) {
      // Restart the scan-beam animation for each file switch.
      void stage.offsetWidth;
      stage.classList.add("is-scanning");
    }
  };

  const schedule = () => {
    window.clearInterval(timer);
    if (prefersReducedMotion()) {
      return;
    }
    timer = window.setInterval(() => activate(activeIndex + 1), 3400);
  };

  for (const [index, button] of railButtons.entries()) {
    button.addEventListener("click", () => {
      activate(index);
      schedule();
    });
  }

  activate(0);
  schedule();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      window.clearInterval(timer);
    } else {
      schedule();
    }
  });
}

/* -------------------------------------------------------------- scrollspy -- */

function initScrollSpy(): void {
  const sidebar = document.querySelector<HTMLElement>(".api-sidebar");
  if (!sidebar) {
    return;
  }
  const links = Array.from(sidebar.querySelectorAll<HTMLAnchorElement>("a[href^='#']"));
  const sections = links
    .map((link) => document.querySelector<HTMLElement>(link.getAttribute("href") || ""))
    .filter((section): section is HTMLElement => Boolean(section));
  if (!sections.length) {
    return;
  }
  const setActive = (id: string) => {
    for (const link of links) {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
    }
  };
  const spy = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) {
        setActive(visible[0].target.id);
      }
    },
    { rootMargin: "-20% 0px -65% 0px" }
  );
  for (const section of sections) {
    spy.observe(section);
  }
  setActive(sections[0].id);
}

/* ------------------------------------------------------------------ init -- */

export function initMotion(): void {
  rescanReveals();
  initCounters();
  initCardMotion();
  initScrollProgress();
  initHeroStage();
  initScrollSpy();
  reducedMotion.addEventListener?.("change", () => {
    if (prefersReducedMotion()) {
      for (const target of document.querySelectorAll<HTMLElement>("[data-reveal]")) {
        target.classList.add("is-revealed");
      }
    }
  });
}
