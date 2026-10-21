"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Estrategia" },
  { href: "/meteora", label: "Meteora papel" },
  { href: "/meteora-live", label: "Meteora live" },
];

export function DeskNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {LINKS.map((link) => {
        const on = path === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={on ? "page" : undefined}
            className={on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
