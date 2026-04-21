import { Skeleton } from "@/components/ui/skeleton";

/**
 * Generic page-loading placeholder: a header block plus a few content rows.
 * Used by every route's `loading.tsx` so the content area shows a skeleton
 * the moment you navigate, instead of holding the previous page on screen.
 */
export function PageSkeleton() {
  return (
    <div>
      {/* PageHeader placeholder */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      {/* Content placeholder */}
      <div className="space-y-3 rounded-lg border bg-card p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
