import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 5, columns = 5 }: TableSkeletonProps) {
  return (
    <div className="w-full" aria-busy="true">
      <div className="flex h-10 items-center gap-4 border-b border-line bg-subtle/60 px-5">
        {[...Array(Math.max(1, columns))].map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-line">
        {[...Array(rows)].map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-5 py-3.5">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-full max-w-md" />
              <Skeleton className="h-3 w-2/3 max-w-xs" />
            </div>
            {[...Array(Math.max(0, columns - 2))].map((_, colIndex) => (
              <Skeleton key={colIndex} className="hidden h-3.5 w-20 md:block" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
