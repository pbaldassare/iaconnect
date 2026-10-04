/** Navigation and area-permission rules. Pure data and functions, unit tested. */
import type { IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match only the exact path (used by "Inizio", whose href is a prefix of the others). */
  exact?: boolean;
}

/** Customer area. Every member sees every section; pages hide write actions when `canManage` is false. */
export const CUSTOMER_NAV: readonly NavItem[] = [
  { href: "/app", label: "Inizio", icon: "home", exact: true },
  { href: "/app/collegamenti", label: "Collegamenti", icon: "plug" },
  { href: "/app/flussi", label: "Flussi", icon: "flow" },
  { href: "/app/inbox", label: "Inbox", icon: "inbox" },
  { href: "/app/contatti", label: "Contatti", icon: "people" },
  { href: "/app/trattative", label: "Trattative", icon: "deal" },
  { href: "/app/report", label: "Report", icon: "chart" },
  { href: "/app/impostazioni", label: "Impostazioni", icon: "settings" },
];

interface AdminNavItem extends NavItem {
  /** Platform-level page: hidden from (and forbidden to) reseller admins. */
  platformOnly: boolean;
}

const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin/aziende", label: "Aziende", icon: "building", platformOnly: false },
  { href: "/admin/catalogo", label: "Catalogo", icon: "grid", platformOnly: true },
  { href: "/admin/piani", label: "Piani", icon: "tag", platformOnly: true },
  { href: "/admin/rivenditori", label: "Rivenditori", icon: "people", platformOnly: true },
  { href: "/admin/monitoraggio", label: "Monitoraggio", icon: "pulse", platformOnly: true },
  { href: "/admin/registro", label: "Registro", icon: "list", platformOnly: false },
];

export interface AdminRoles {
  isPlatformAdmin: boolean;
  /** Resellers the user administers. */
  resellerIds: readonly string[];
}

export function isStaff(roles: AdminRoles): boolean {
  return roles.isPlatformAdmin || roles.resellerIds.length > 0;
}

/** Admin navigation for the given roles; empty when the user has no admin role. */
export function adminNav(roles: AdminRoles): NavItem[] {
  if (!isStaff(roles)) return [];
  return ADMIN_NAV.filter((item) => roles.isPlatformAdmin || !item.platformOnly).map(
    ({ platformOnly: _platformOnly, ...item }) => item,
  );
}

/** True when the roles may open the given /admin path. */
export function canAccessAdminPath(roles: AdminRoles, pathname: string): boolean {
  if (!isStaff(roles)) return false;
  if (roles.isPlatformAdmin) return true;
  const item = ADMIN_NAV.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  if (!item) return pathname === "/admin";
  return !item.platformOnly;
}

/** Whether a nav item is the current page. */
export function isNavItemActive(item: Pick<NavItem, "href" | "exact">, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
