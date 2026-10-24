import { Footer } from "./Footer.jsx";

export function PageFrame({ children }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
