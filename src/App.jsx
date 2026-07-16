import { About } from "./components/About.jsx";
import { Contact } from "./components/Contact.jsx";
import { Footer } from "./components/Footer.jsx";
import { Header } from "./components/Header.jsx";
import { Hero } from "./components/Hero.jsx";
import { Highlights } from "./components/Highlights.jsx";
import { Projects } from "./components/Projects.jsx";
import { Stack } from "./components/Stack.jsx";
import { useHomepageInteractions } from "./hooks/useHomepageInteractions.js";

export function App() {
  useHomepageInteractions();

  return (
    <>
      <Header />
      <main id="home">
        <Hero />
        <About />
        <Stack />
        <Highlights />
        <Projects />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
