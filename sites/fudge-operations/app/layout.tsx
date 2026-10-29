import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fudge Operations",
  description: "Hosted spreadsheet-style operations dashboard for Fudge review collection.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
