/**
 * Skeleton — placeholder while content loads (use in `loading.tsx` files).
 *
 *   import { Skeleton, PageSkeleton } from "@/components/ui/skeleton";
 *   <Skeleton className="h-6 w-40" />
 *   export default function Loading() { return <PageSkeleton />; }
 */
import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Caricamento in corso</span>
      <Skeleton className="mb-2 h-8 w-56" />
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56 md:col-span-2" />
      </div>
    </div>
  );
}
