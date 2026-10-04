import { describe, expect, it } from "vitest";
import {
  CUSTOMER_NAV,
  adminNav,
  canAccessAdminPath,
  isNavItemActive,
  isStaff,
  withPendingRequests,
} from "../src/lib/nav";
import { isProtectedPath, safeNextPath, signInRedirect, signedInRedirect } from "../src/lib/routes";

const platform = { isPlatformAdmin: true, resellerIds: [] };
const reseller = { isPlatformAdmin: false, resellerIds: ["r1"] };
const customer = { isPlatformAdmin: false, resellerIds: [] };

describe("customer navigation", () => {
  it("lists the eight sections in order", () => {
    expect(CUSTOMER_NAV.map((i) => i.label)).toEqual([
      "Inizio",
      "Collegamenti",
      "Flussi",
      "Inbox",
      "Contatti",
      "Trattative",
      "Report",
      "Impostazioni",
    ]);
  });

  it("marks Inizio active only on /app, the others on their sub-pages too", () => {
    const home = CUSTOMER_NAV[0]!;
    const flows = CUSTOMER_NAV.find((i) => i.href === "/app/flussi")!;
    expect(isNavItemActive(home, "/app")).toBe(true);
    expect(isNavItemActive(home, "/app/flussi")).toBe(false);
    expect(isNavItemActive(flows, "/app/flussi")).toBe(true);
    expect(isNavItemActive(flows, "/app/flussi/123")).toBe(true);
    expect(isNavItemActive(flows, "/app/flussi-vecchi")).toBe(false);
  });
});

describe("admin navigation", () => {
  it("gives platform admins every page", () => {
    expect(adminNav(platform).map((i) => i.label)).toEqual([
      "Aziende",
      "Richieste",
      "Catalogo",
      "Piani",
      "Rivenditori",
      "Monitoraggio",
      "Registro",
    ]);
  });

  it("gives reseller admins only their organizations and the audit log", () => {
    expect(adminNav(reseller).map((i) => i.label)).toEqual(["Aziende", "Registro"]);
  });

  it("shows the pending access requests on «Richieste» only, and only when there are some", () => {
    const items = withPendingRequests(adminNav(platform), 3);
    expect(items.filter((i) => i.badge !== undefined).map((i) => [i.label, i.badge])).toEqual([
      ["Richieste", 3],
    ]);
    expect(withPendingRequests(adminNav(platform), 0).some((i) => i.badge !== undefined)).toBe(false);
    expect(withPendingRequests(adminNav(reseller), 3).some((i) => i.badge !== undefined)).toBe(false);
  });

  it("gives customers nothing", () => {
    expect(adminNav(customer)).toEqual([]);
    expect(isStaff(customer)).toBe(false);
  });
});

describe("canAccessAdminPath", () => {
  it("lets platform admins in everywhere", () => {
    for (const path of [
      "/admin",
      "/admin/catalogo",
      "/admin/piani",
      "/admin/rivenditori/x",
      "/admin/monitoraggio",
    ]) {
      expect(canAccessAdminPath(platform, path)).toBe(true);
    }
  });

  it("keeps reseller admins out of catalog and platform pages", () => {
    expect(canAccessAdminPath(reseller, "/admin")).toBe(true);
    expect(canAccessAdminPath(reseller, "/admin/aziende")).toBe(true);
    expect(canAccessAdminPath(reseller, "/admin/aziende/abc")).toBe(true);
    expect(canAccessAdminPath(reseller, "/admin/registro")).toBe(true);
    expect(canAccessAdminPath(reseller, "/admin/richieste")).toBe(false);
    expect(canAccessAdminPath(reseller, "/admin/catalogo")).toBe(false);
    expect(canAccessAdminPath(reseller, "/admin/piani")).toBe(false);
    expect(canAccessAdminPath(reseller, "/admin/rivenditori")).toBe(false);
    expect(canAccessAdminPath(reseller, "/admin/monitoraggio")).toBe(false);
    expect(canAccessAdminPath(reseller, "/admin/qualcosa-di-nuovo")).toBe(false);
  });

  it("keeps customers out of the whole admin area", () => {
    expect(canAccessAdminPath(customer, "/admin")).toBe(false);
    expect(canAccessAdminPath(customer, "/admin/aziende")).toBe(false);
  });
});

describe("route protection", () => {
  it("leaves the account pages open to signed-out visitors, and nothing that looks like them", () => {
    for (const path of ["/registrati", "/password-dimenticata", "/privacy"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
    for (const path of [
      "/area-riservata",
      "/benvenuto",
      "/in-attesa",
      "/completa-registrazione",
      "/admin/richieste",
      "/registrati-finto",
      "/privacy-interna",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
  });

  it("sends a signed-out visitor of the entry points to a plain /accedi", () => {
    expect(signInRedirect("/area-riservata")).toEqual({ pathname: "/accedi", search: "" });
    expect(signInRedirect("/benvenuto")).toEqual({ pathname: "/accedi", search: "" });
    expect(signInRedirect("/in-attesa")).toEqual({
      pathname: "/accedi",
      search: `?next=${encodeURIComponent("/in-attesa")}`,
    });
  });

  it("sends a signed-in visitor of /accedi and /registrati onward, keeping a safe next", () => {
    expect(signedInRedirect("/accedi")).toEqual({ pathname: "/area-riservata", search: "" });
    expect(signedInRedirect("/registrati")).toEqual({ pathname: "/area-riservata", search: "" });
    expect(signedInRedirect("/accedi", "?next=%2Fapp%2Finbox")).toEqual({
      pathname: "/area-riservata",
      search: `?next=${encodeURIComponent("/app/inbox")}`,
    });
    expect(signedInRedirect("/accedi", "?next=https%3A%2F%2Fevil.example")).toEqual({
      pathname: "/area-riservata",
      search: "",
    });
    expect(signedInRedirect("/password-dimenticata")).toBeNull();
    expect(signedInRedirect("/privacy")).toBeNull();
    expect(signedInRedirect("/app")).toBeNull();
    expect(signedInRedirect("/auth/callback")).toBeNull();
  });

  it("protects everything except sign-in and auth callbacks", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/admin/aziende")).toBe(true);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/assets/photos/hotel-reception.jpg")).toBe(false);
    expect(isProtectedPath("/assets-private")).toBe(true);
    expect(isProtectedPath("/imposta-password")).toBe(true);
    expect(isProtectedPath("/accedi")).toBe(false);
    expect(isProtectedPath("/auth/callback")).toBe(false);
    expect(isProtectedPath("/auth/conferma")).toBe(false);
    expect(isProtectedPath("/accedi-finto")).toBe(true);
  });

  it("remembers the requested page when redirecting to sign-in", () => {
    expect(signInRedirect("/app/flussi", "?stato=attivi")).toEqual({
      pathname: "/accedi",
      search: `?next=${encodeURIComponent("/app/flussi?stato=attivi")}`,
    });
    expect(signInRedirect("/app")).toEqual({ pathname: "/accedi", search: "" });
    expect(signInRedirect("/")).toEqual({ pathname: "/accedi", search: "" });
  });

  it("accepts only same-site paths as the next page", () => {
    expect(safeNextPath("/app/inbox")).toBe("/app/inbox");
    expect(safeNextPath("/admin/aziende?q=rossi")).toBe("/admin/aziende?q=rossi");
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
    expect(safeNextPath("javascript:alert(1)")).toBe("/app");
    expect(safeNextPath("/accedi")).toBe("/app");
    expect(safeNextPath("/accedi?next=/accedi")).toBe("/app");
    expect(safeNextPath("/registrati")).toBe("/app");
    expect(safeNextPath("/registrati?x=1")).toBe("/app");
    expect(safeNextPath("/registrati-e-altro")).toBe("/registrati-e-altro");
    expect(safeNextPath("/auth/callback")).toBe("/app");
  });
});
