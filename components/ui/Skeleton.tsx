import { cn } from "@/lib/cn";

export type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-hairline/70", className ?? "h-4 w-full")}
    />
  );
}

export type SkeletonListProps = {
  rows?: number;
  className?: string;
  rowClassName?: string;
};

export function SkeletonList({ rows = 4, className, rowClassName }: SkeletonListProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className={rowClassName ?? "h-8 w-full"} />
      ))}
    </div>
  );
}
