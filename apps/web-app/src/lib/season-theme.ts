export type Season = "spring" | "summer" | "autumn" | "winter";
export type SeasonFilter = Season | "all";
export type SeasonOrMixed = Season | "mixed";

export function monthToSeason(monthValue: string | number): Season {
  const month = Number(monthValue);
  if (Number.isNaN(month)) return "winter";
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

export function seasonFromCapturedDate(value: string | null | undefined): SeasonOrMixed {
  if (typeof value !== "string" || value.length < 7) return "mixed";
  return monthToSeason(value.slice(5, 7));
}
