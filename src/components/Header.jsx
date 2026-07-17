import { navItems } from "../data/homepage.js";

export function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="返回首页">
        Huang
      </a>
      <nav className="site-nav" aria-label="主导航">
        {navItems.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
