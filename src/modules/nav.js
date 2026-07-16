export function initNav() {
  const yearElement = document.querySelector("#year");
  const navLinks = [...document.querySelectorAll(".site-nav a")];
  const sections = [...document.querySelectorAll("main section[id]")];

  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  const setActiveNav = (id) => {
    const activeLink = document.querySelector(`.site-nav a[href="#${id}"]`);
    navLinks.forEach((link) => link.classList.remove("is-active"));
    activeLink?.classList.add("is-active");
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveNav(entry.target.id);
        }
      });
    },
    {
      rootMargin: "-40% 0px -45% 0px",
      threshold: 0,
    },
  );

  sections.forEach((section) => observer.observe(section));

  return () => observer.disconnect();
}
