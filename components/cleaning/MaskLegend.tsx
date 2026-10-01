import type { CleaningRegion, PageRole } from "@/lib/cleaning/types";

interface MaskLegendProps {
  regions: CleaningRegion[];
}

const pageLabels: Record<PageRole, string> = {
  comic: "หน้าการ์ตูน",
  credits: "หน้าเครดิต",
  ui: "หน้าเมนู",
  unknown: "ประเภทหน้าไม่ระบุ",
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
      role="region"
      aria-label="Mask legend"
      className="absolute top-2 right-2 z-20 max-w-[calc(100%-1rem)] rounded-lg bg-black/90 border border-zinc-700/80 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-xs"
    >
      <p className="mb-1.5 font-bold text-white tracking-wide">{pageLabels[pageRole]}</p>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1">
        <LegendItem shape="square" color="bg-[#ff3750]" label={`พื้นที่ที่จะลบ ${clean}`} />
        <LegendItem shape="diamond" color="bg-[#ffbe28]" label={`ควรตรวจ ${review}`} />
        <LegendItem shape="circle" color="bg-[#2d91ff]" label={`เก็บภาพเดิม ${protect}`} />
      </div>
    </div>
  );
}

function LegendItem({
  shape,
  color,
  label,
}: {
  shape: "square" | "diamond" | "circle";
  color: string;
  label: string;
}) {
  const shapeClass =
    shape === "circle"
      ? "rounded-full"
      : shape === "diamond"
      ? "rotate-45 rounded-[1px]"
      : "rounded-xs";

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[#E5E5E5] font-medium">
      <span
        className={`h-2.5 w-2.5 ${shapeClass} ${color} shadow-xs border border-white/20`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}
