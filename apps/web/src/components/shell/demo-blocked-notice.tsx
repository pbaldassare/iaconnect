"use client";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo/client";
import { DEMO_BLOCKED_PARAM, DEMO_BLOCKED_VALUE } from "@/lib/routes";
import { useSearchParams } from "next/navigation";

/** Shown when the middleware sent a demo visitor back from a closed address (a download). */
export function DemoBlockedNotice() {
  const blocked = useSearchParams().get(DEMO_BLOCKED_PARAM) === DEMO_BLOCKED_VALUE;
  if (!blocked) return null;
  return (
    <output className="mt-2 block rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-ink">
      {DEMO_READ_ONLY_MESSAGE.replace(
        "le modifiche sono disattivate",
        "i download e le modifiche sono disattivati",
      )}
    </output>
  );
}
