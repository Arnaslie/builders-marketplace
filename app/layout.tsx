import type { ReactNode } from "react";

export const metadata = {
  title: "DIY Wikipedia",
  description: "Hands-on projects with a materials grid and a PayPal-powered shopping agent.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
