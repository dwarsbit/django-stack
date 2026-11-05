"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** A menu link, marked as the current page when the visitor is on it or below it. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const current = href === path || (href !== "/" && path.startsWith(`${href}/`));
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
