"use client";

import { ReactLenis } from "lenis/react";
import { useEffect, useState } from "react";

// Site-wide smooth scrolling with Lenis. Lenis animates the real window scroll (it does not
// fake it with transforms), so position: sticky, anchors and scroll restoration keep working.
//
// It is skipped for visitors who ask the OS for reduced motion: smooth scrolling is exactly the
// kind of motion that setting exists to turn off. The check runs after mount (matchMedia does not
// exist on the server), so the first paint always uses native scrolling.
export function SmoothScroll() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!enabled) return null;
  // root: drive the window scroll. lerp 0.1 is Lenis's default glide; anchors: smooth #hash links.
  // stopInertiaOnNavigate: clicking a link (e.g. the pager) kills any glide still in flight, so
  // Next's scroll-to-top on the new page is not dragged back down by leftover momentum.
  return <ReactLenis root options={{ lerp: 0.1, anchors: true, stopInertiaOnNavigate: true }} />;
}
