import type { CleaningRegion, PageRole } from "@/lib/cleaning/types";

interface MaskLegendProps {
  regions: CleaningRegion[];
}

const pageLabels: Record<PageRole, string> = {
  comic: "Comic page",
  credits: "Credits page",
  ui: "UI page",
  unknown: "Unknown page",
};

export function MaskLegend({ regions }: MaskLegendProps) {
  const pageRole = regions[0]?.pageRole ?? "unknown";
  const clean = regions.filter(
    (region) => region.automaticAction === "clean",
  ).length;
  const review = regions.filter(
    (region) => region.textRole === "review",
  ).length;
  const protect = regions.filter(
    (region) => region.textRole === "protected",
  ).length;

  return (
    <div
      className="absolute top-2 right-2 z-20 max-w-[calc(100%-1rem)] rounded-md bg-black/90 px-2.5 py-2 text-xs text-white"
      aria-label="Mask legend"
    >
      <p className="mb-1.5 font-semibold">{pageLabels[pageRole]}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <LegendItem color="bg-[#ff3750]" label={`Clean ${clean}`} />
        <LegendItem color="bg-[#ffbe28]" label={`Review ${review}`} />
        <LegendItem color="bg-[#2d91ff]" label={`Protect ${protect}`} />
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span
        className={`h-2.5 w-2.5 rounded-sm ${color}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
