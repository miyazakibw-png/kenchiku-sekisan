export const BANNER_COLORS: { label: string; color: string }[] = [
  { label: "緑", color: "#dcfce7" },
  { label: "桃", color: "#fce7f3" },
  { label: "青", color: "#dbeafe" },
  { label: "黄", color: "#fef9c3" },
  { label: "橙", color: "#ffedd5" },
  { label: "灰", color: "#e2e8f0" },
  { label: "紫", color: "#ede9fe" },
  { label: "水", color: "#cffafe" },
];

export function assemblyBandColor(
  partNumber: number | null | undefined,
): string | null {
  if (partNumber == null || !Number.isFinite(partNumber) || partNumber < 10)
    return null;
  const label = ["緑", "桃", "青", "黄", "橙", "灰", "紫", "水"][
    Math.min(Math.floor(partNumber / 10) - 1, 7)
  ];
  return BANNER_COLORS.find((item) => item.label === label)?.color ?? null;
}
