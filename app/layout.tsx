import type { ReactNode } from "react";
import Link from "next/link";
import "./tokens.css";
import "./globals.css";

export const metadata = {
  title: "DIY Wikipedia",
  description: "Hands-on projects with a materials grid and a PayPal-powered shopping agent.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <nav className="container site-nav" aria-label="Main">
            <Link href="/" className="brand">
              DIY Wikipedia
            </Link>
            <Link href="/">Browse</Link>
            <Link href="/recommend">Recommend a project</Link>
            <Link href="/cart">Cart</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
