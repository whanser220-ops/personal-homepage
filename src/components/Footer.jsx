export function Footer() {
  return (
    <footer className="site-footer">
      <span>
        © <span id="year">{new Date().getFullYear()}</span> Huang
      </span>
      <span>Built with React, Vite and Anime.js</span>
    </footer>
  );
}
