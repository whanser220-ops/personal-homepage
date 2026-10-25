import { preload } from "react-dom";
import { LandingNavigation } from "../src/components/LandingNavigation.jsx";

export default function HomePage() {
  preload("/assets/home-scene/afternoon-room.glb", {
    as: "fetch",
    crossOrigin: "anonymous",
  });
  return <LandingNavigation />;
}
