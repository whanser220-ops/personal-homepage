import { Footer } from "./Footer.jsx";
import { Header } from "./Header.jsx";

export function PageFrame({ children }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
