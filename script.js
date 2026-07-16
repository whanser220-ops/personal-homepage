const yearElement = document.querySelector("#year");
const navLinks = document.querySelectorAll(".site-nav a");
const sections = [...document.querySelectorAll("main section[id]")];

yearElement.textContent = new Date().getFullYear();

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      const activeLink = document.querySelector(`.site-nav a[href="#${entry.target.id}"]`);
      navLinks.forEach((link) => link.classList.remove("is-active"));
      activeLink?.classList.add("is-active");
    });
  },
  {
    rootMargin: "-40% 0px -45% 0px",
    threshold: 0,
  },
);

sections.forEach((section) => observer.observe(section));
