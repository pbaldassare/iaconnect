import { buttonClass } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { DEMO_EXIT_PATH, SIGN_UP_PATH } from "@/lib/routes";
import { Suspense } from "react";
import { DemoBlockedNotice } from "./demo-blocked-notice";

/**
 * Strip shown above every page of the customer area while a visitor is in the public demo.
 * The two links are plain anchors on purpose: `/demo/esci` changes a cookie, so it must not
 * be prefetched, and `/registrati` leaves the demo area.
 */
export function DemoBanner() {
  return (
    <aside
      aria-label="Demo"
      className="z-30 border-b border-line bg-surface-2 px-4 py-2 sm:px-6 md:sticky md:top-0 md:px-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-start gap-2 text-[13px] leading-snug text-ink">
          <Icon name="info" className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>
            <strong className="font-semibold">Stai guardando una demo con dati di esempio.</strong> Le
            modifiche sono disattivate.
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <a href={SIGN_UP_PATH} className={buttonClass("primary", "sm")}>
            Registrati
          </a>
          <a href={DEMO_EXIT_PATH} className={buttonClass("secondary", "sm")}>
            Esci dalla demo
          </a>
        </div>
      </div>
      <Suspense fallback={null}>
        <DemoBlockedNotice />
      </Suspense>
    </aside>
  );
}
