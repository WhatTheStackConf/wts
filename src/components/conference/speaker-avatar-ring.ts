/** LogoSolo.svg gradient stops: circle (radial) then chevrons top → bottom. */
export const LOGO_SOLO_COLORS = {
  circleLight: "#91F6FF",
  circleDeep: "#2EC8FE",
  chevron1Start: "#FFC03D",
  chevron1End: "#FE7457",
  chevron2Start: "#FEA403",
  chevron2End: "#CD3DD0",
  chevron3Start: "#25DBFA",
  chevron3End: "#A240FE",
} as const;

export const AVATAR_RING_GRADIENT = `conic-gradient(from 210deg, ${LOGO_SOLO_COLORS.circleLight} 0%, ${LOGO_SOLO_COLORS.circleDeep} 12.5%, ${LOGO_SOLO_COLORS.chevron1Start} 25%, ${LOGO_SOLO_COLORS.chevron1End} 37.5%, ${LOGO_SOLO_COLORS.chevron2Start} 50%, ${LOGO_SOLO_COLORS.chevron2End} 62.5%, ${LOGO_SOLO_COLORS.chevron3Start} 75%, ${LOGO_SOLO_COLORS.chevron3End} 87.5%, ${LOGO_SOLO_COLORS.circleLight} 100%)`;

export const AVATAR_RING_GLOW =
  "0 0 20px rgba(46,200,254,0.32), 0 0 16px rgba(255,192,61,0.22), 0 0 14px rgba(205,61,208,0.2), 0 0 12px rgba(162,64,254,0.26)";
