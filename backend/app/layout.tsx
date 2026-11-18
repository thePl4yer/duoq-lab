import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DuoQ Lab Shared Library",
  description: "Public replay-statistics library for Kate and P L 4 Y E R.",
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
