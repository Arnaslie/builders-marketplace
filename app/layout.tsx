import type { ReactNode } from "react";
import Link from "next/link";
import "lenis/dist/lenis.css";
import "./tokens.css";
import "./globals.css";
import { Seal } from "../components/seal";
import { SmoothScroll } from "../components/smooth-scroll";

export const metadata = {
  title: "DIY Wikipedia",
  description: "Hands-on projects with a materials grid and a PayPal-powered shopping agent.",
};

// The edition line is the date this page was rendered: per request on "/", at build time on
// the static pages. UTC so the server's own timezone never changes the printed date.
function editionDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Masthead after the 1994 CIA server page: the seal floated right, a rule, a big bold welcome line
// that wraps beside the seal, another rule, then a line of plain links. The welcome line is styled
// like an <h1> but is a <p>, so each page keeps exactly one real <h1> for its own heading.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SmoothScroll />
        <header className="masthead">
          <Link href="/" className="masthead-seal" aria-label="DIY Wikipedia home">
            <Seal />
          </Link>
          <hr />
          <p className="masthead-title">Welcome to the DIY Wikipedia Server</p>
          <hr />
          <nav className="site-nav" aria-label="Main">
            <Link href="/">Project Index</Link> | <Link href="/recommend">Recommend a Project</Link> |{" "}
            <Link href="/cart">Cart</Link>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <hr />
          <p>
            <b>Current Edition for {editionDate()}</b>
          </p>
        </footer>
      </body>
    </html>
  );
}
