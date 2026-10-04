import { describe, expect, it } from "vitest";
import {
  asRequestStatus,
  destinationAfterSignIn,
  hasAreaAccess,
  landingRoute,
} from "../src/lib/landing-route";

const nobody = { isStaff: false, hasOrganization: false, requestStatus: null };

describe("landingRoute", () => {
  it("sends platform and reseller admins to the admin area, whatever else they have", () => {
    expect(landingRoute({ ...nobody, isStaff: true })).toBe("/admin");
    expect(landingRoute({ isStaff: true, hasOrganization: true, requestStatus: "pending" })).toBe("/admin");
  });

  it("sends members to the customer area, even with an old request", () => {
    expect(landingRoute({ ...nobody, hasOrganization: true })).toBe("/app");
    expect(landingRoute({ ...nobody, hasOrganization: true, requestStatus: "approved" })).toBe("/app");
    expect(landingRoute({ ...nobody, hasOrganization: true, requestStatus: "rejected" })).toBe("/app");
  });

  it("keeps people with a pending or rejected request on the waiting page", () => {
    expect(landingRoute({ ...nobody, requestStatus: "pending" })).toBe("/in-attesa");
    expect(landingRoute({ ...nobody, requestStatus: "rejected" })).toBe("/in-attesa");
  });

  it("asks people with nothing at all to complete the registration", () => {
    expect(landingRoute(nobody)).toBe("/completa-registrazione");
  });

  it("does not offer a new request to someone approved who lost the organization", () => {
    expect(landingRoute({ ...nobody, requestStatus: "approved" })).toBe("/nessuna-azienda");
  });
});

describe("destinationAfterSignIn", () => {
  it("uses the landing page when no page was asked for, or an entry point was", () => {
    for (const next of [null, undefined, "", "/", "/area-riservata", "/benvenuto", "/benvenuto?x=1"]) {
      expect(destinationAfterSignIn("/in-attesa", next), String(next)).toBe("/in-attesa");
      expect(destinationAfterSignIn("/admin", next), String(next)).toBe("/admin");
    }
  });

  it("lets a user with an area open the page they asked for", () => {
    expect(destinationAfterSignIn("/app", "/app/inbox?vista=aperte")).toBe("/app/inbox?vista=aperte");
    expect(destinationAfterSignIn("/admin", "/admin/richieste")).toBe("/admin/richieste");
    expect(destinationAfterSignIn("/admin", "/app/flussi")).toBe("/app/flussi");
  });

  it("treats the default /app as «wherever I belong»", () => {
    expect(destinationAfterSignIn("/admin", "/app")).toBe("/admin");
    expect(destinationAfterSignIn("/app", "/app")).toBe("/app");
  });

  it("keeps a user without an area on their landing page", () => {
    for (const landing of ["/in-attesa", "/completa-registrazione", "/nessuna-azienda"]) {
      expect(destinationAfterSignIn(landing, "/app/inbox")).toBe(landing);
      expect(destinationAfterSignIn(landing, "/admin/richieste")).toBe(landing);
      expect(destinationAfterSignIn(landing, "/app")).toBe(landing);
    }
  });

  it("always allows choosing a password (invitation and reset links)", () => {
    expect(destinationAfterSignIn("/in-attesa", "/imposta-password")).toBe("/imposta-password");
    expect(destinationAfterSignIn("/completa-registrazione", "/imposta-password")).toBe("/imposta-password");
    expect(destinationAfterSignIn("/app", "/imposta-password")).toBe("/imposta-password");
    expect(destinationAfterSignIn("/in-attesa", "/imposta-password-finta")).toBe("/in-attesa");
  });
});

describe("helpers", () => {
  it("recognizes the two areas", () => {
    expect(hasAreaAccess("/app")).toBe(true);
    expect(hasAreaAccess("/admin")).toBe(true);
    expect(hasAreaAccess("/in-attesa")).toBe(false);
  });

  it("reads only known request statuses", () => {
    expect(asRequestStatus("pending")).toBe("pending");
    expect(asRequestStatus("approved")).toBe("approved");
    expect(asRequestStatus("rejected")).toBe("rejected");
    expect(asRequestStatus("other")).toBeNull();
    expect(asRequestStatus(null)).toBeNull();
  });
});
