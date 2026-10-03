export interface LocalIconData {
  body: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

export const localIcons = {
  "ph:arrow-right-bold": {
    "body": "<path fill=\"currentColor\" d=\"m224.49 136.49l-72 72a12 12 0 0 1-17-17L187 140H40a12 12 0 0 1 0-24h147l-51.49-51.52a12 12 0 0 1 17-17l72 72a12 12 0 0 1-.02 17.01\"/>",
    "left": 0,
    "top": 0,
    "width": 256,
    "height": 256
  },
  "ph:x-bold": {
    "body": "<path fill=\"currentColor\" d=\"M208.49 191.51a12 12 0 0 1-17 17L128 145l-63.51 63.49a12 12 0 0 1-17-17L111 128L47.51 64.49a12 12 0 0 1 17-17L128 111l63.51-63.52a12 12 0 0 1 17 17L145 128Z\"/>",
    "left": 0,
    "top": 0,
    "width": 256,
    "height": 256
  }
} as const satisfies Record<string, LocalIconData>;
