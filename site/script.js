const sections = Array.from(document.querySelectorAll(".section"));
const links = Array.from(document.querySelectorAll(".nav-link[data-section]"));

const linkBySection = new Map(
  links.map((a) => [a.dataset.section, a]),
);

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const id = entry.target.id;
      links.forEach((a) => a.classList.remove("is-active"));
      const active = linkBySection.get(id);
      if (active) active.classList.add("is-active");
    }
  },
  { rootMargin: "-40% 0px -55% 0px", threshold: 0 },
);

sections.forEach((s) => observer.observe(s));

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.getElementById(btn.dataset.copyTarget);
    if (!target) return;
    const label = btn.querySelector(".copy-label");
    const original = label ? label.textContent : "";
    try {
      await copyText(target.textContent.trim());
      btn.classList.add("is-copied");
      if (label) label.textContent = "Copied";
    } catch {
      btn.classList.add("is-copied");
      if (label) label.textContent = "Press ⌘C";
    }
    setTimeout(() => {
      btn.classList.remove("is-copied");
      if (label) label.textContent = original;
    }, 1400);
  });
});
