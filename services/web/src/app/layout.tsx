// ABOUTME: Root layout for the observability dashboard and agent control panel.
// ABOUTME: Provides shared navigation and HTML structure.
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agentic Sandbox",
  description: "Observability dashboard and agent control panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
