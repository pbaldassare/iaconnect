"use client";
import { useEffect, useRef } from "react";

/** Keeps the thread scrolled to the newest message when it grows. */
export function ScrollEnd({ count }: { count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again when the number of messages changes
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, [count]);
  return <div ref={ref} aria-hidden />;
}
