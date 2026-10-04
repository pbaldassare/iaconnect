import { DEMO_EXIT_PATH, SIGN_UP_PATH } from "@/lib/routes";
import { Suspense } from "react";
import { DemoBlockedNotice } from "./demo-blocked-notice";

const ACTION =
  "flex h-10 shrink-0 items-center rounded-md px-2 text-[13px] font-semibold underline decoration-1 underline-offset-[3px] hover:decoration-2";

/**
 * One-line strip above every page of the customer area while a visitor is in the public demo.
 * The two links are plain anchors on purpose: `/demo/esci` changes a cookie, so it must not
 * be prefetched, and `/registrati` leaves the demo area.
 */
export function DemoBanner() {
  return (
    <aside
      aria-label="Demo"
      className="z-20 border-b border-line bg-surface-2 pl-4 pr-2 sm:pl-6 sm:pr-4 md:sticky md:top-0 md:pl-8 md:pr-6"
    >
      <div className="flex items-center gap-x-1">
        <p className="mr-auto min-w-0 truncate text-[13px] text-ink">
          <strong className="font-semibold">Demo</strong>
          <span className="text-muted"> · dati di esempio</span>
          <span className="text-muted max-sm:hidden">, modifiche disattivate</span>
        </p>
        <a href={SIGN_UP_PATH} className={`${ACTION} text-accent-strong`}>
          Registrati
        </a>
        <a href={DEMO_EXIT_PATH} className={`${ACTION} text-ink`}>
          Esci dalla demo
        </a>
      </div>
      <Suspense fallback={null}>
        <DemoBlockedNotice />
      </Suspense>
    </aside>
  );
}
