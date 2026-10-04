"use client";
import { useEffect } from "react";

/** Resets the unread counter once the thread is on screen (not during prefetch or render). */
export function MarkRead({ unread, action }: { unread: number; action: () => Promise<void> }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the bound action changes identity at every render
  useEffect(() => {
    if (unread > 0) void action();
  }, [unread]);
  return null;
}
