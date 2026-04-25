"use client";

export function MapLegend() {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[500] rounded-xl border border-zinc-200/80 bg-white/90 p-2 text-xs shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
      <div className="font-medium text-zinc-700 dark:text-zinc-200">Legend</div>
      <div className="mt-1 space-y-1 text-zinc-600 dark:text-zinc-300">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
          Blue - current
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-600" />
          Green - completed
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gray-500" />
          Gray - upcoming
        </div>
      </div>
    </div>
  );
}
