// ABOUTME: Root layout for the observability dashboard and agent control panel.
// ABOUTME: Provides sidebar navigation, global styles, and HTML structure.
import type { Metadata } from "next";
import Sidebar from "./sidebar";
import styles from "./layout.module.css";
import "./globals.css";

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
      <body>
        <div className={styles.container}>
          <Sidebar />
          <main className={styles.main}>{children}</main>
        </div>
      </body>
    </html>
  );
}
