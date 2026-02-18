// ABOUTME: Sidebar navigation component for the observability dashboard.
// ABOUTME: Renders navigation links with active state highlighting based on current route.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./layout.module.css";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const observabilityLinks: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "\u25A3" },
  { href: "/traces", label: "Traces", icon: "\u2261" },
  { href: "/logs", label: "Logs", icon: "\u2263" },
  { href: "/metrics", label: "Metrics", icon: "\u25CE" },
];

const controlLinks: NavItem[] = [
  { href: "/agents", label: "Agents", icon: "\u2689" },
  { href: "/policies", label: "Policies", icon: "\u2611" },
];

export default function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoTitle}>Agentic Sandbox</div>
        <div className={styles.logoSubtitle}>Observability &amp; Control</div>
      </div>
      <nav className={styles.nav}>
        <div className={styles.navSection}>Observability</div>
        {observabilityLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? styles.navLinkActive : styles.navLink}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
        <div className={styles.navSection}>Control</div>
        {controlLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={isActive(item.href) ? styles.navLinkActive : styles.navLink}
          >
            <span className={styles.navIcon}>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
