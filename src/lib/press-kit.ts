export interface PressKitGradient {
  from: string;
  to: string;
}

export const pressKitGradients = [
  { from: "#91F6FF", to: "#2EC8FE" },
  { from: "#FFC03D", to: "#FE7457" },
  { from: "#FEA403", to: "#CD3DD0" },
  { from: "#25DBFA", to: "#A240FE" },
] as const satisfies readonly PressKitGradient[];

export function formatPressKitGradient(gradient: PressKitGradient): string {
  return `${gradient.from} → ${gradient.to}`;
}
