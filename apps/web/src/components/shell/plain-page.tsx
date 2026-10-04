import type { ReactNode } from "react";

/** Centered single-column frame for pages outside the two areas (sign-in, password, notices). */
export function PlainPage({
  title,
  intro,
  children,
}: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-4 py-10">
      <p className="mb-6 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-md bg-accent font-display text-[13px] font-extrabold text-on-accent"
        >
          I
        </span>
        <span className="font-display text-[15px] font-extrabold tracking-tight">IA Connect</span>
      </p>
      <div className="rounded-panel border border-line bg-surface p-5 shadow-panel sm:p-6">
        <h1 className="font-display text-2xl font-extrabold leading-tight tracking-tight">{title}</h1>
        {intro ? <div className="mt-2 text-muted">{intro}</div> : null}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
