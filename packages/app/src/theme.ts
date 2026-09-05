/** Design tokens copied from the payhole.org stylesheet so the app reads as the same product. */
export const colors = {
  bg: "#000000",
  surface: "#0A0A0C",
  border: "#1C1C22",
  text: "#F3F3F6",
  muted: "#9A9AA6",
  accent: "#2BFF88",
  warn: "#FF9E3D",
  danger: "#FF4D4D",
} as const;

/** Family names match the embedded font files (see app.config.ts), one file per weight. */
export const fonts = {
  display: "SpaceGrotesk-Bold",
  displayMedium: "SpaceGrotesk-Medium",
  body: "Inter-Regular",
  bodyMedium: "Inter-Medium",
  bodySemi: "Inter-SemiBold",
  bodyBold: "Inter-Bold",
  mono: "JetBrainsMono-Regular",
  monoSemi: "JetBrainsMono-SemiBold",
} as const;

export const radius = {
  card: 16,
  control: 12,
  pill: 999,
} as const;

export function formatCount(value: number): string {
  return Math.trunc(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
