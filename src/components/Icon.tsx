import { type JSX } from "@solidjs/web";
import { localIcons, type LocalIconData } from "~/generated/icons";

export interface IconifyIconData {
  body: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotate?: number;
  hFlip?: boolean;
  vFlip?: boolean;
}

export interface IconProps extends JSX.HTMLAttributes<HTMLElement> {
  icon: string | IconifyIconData | Record<string, unknown>;
  inline?: boolean | string;
  mode?: string;
  rotate?: string | number;
  flip?: string;
  noobserver?: boolean | string;
  width?: string | number;
  height?: string | number;
  preserveAspectRatio?: string;
}

const FALLBACK_ICON = "material-symbols:military-tech-outline";

function isIconifyIconData(icon: IconProps["icon"]): icon is IconifyIconData {
  return icon !== null && typeof icon === "object" && typeof icon.body === "string";
}

function iconData(icon: IconProps["icon"]): LocalIconData {
  if (typeof icon === "string") {
    // Badge icons can come from PocketBase; unknown names stay offline via the fallback.
    return localIcons[icon as keyof typeof localIcons] ?? localIcons[FALLBACK_ICON];
  }

  if (isIconifyIconData(icon)) {
    return {
      body: icon.body,
      left: icon.left ?? 0,
      top: icon.top ?? 0,
      width: icon.width ?? 16,
      height: icon.height ?? 16,
      rotate: icon.rotate,
      hFlip: icon.hFlip,
      vFlip: icon.vFlip,
    };
  }

  return localIcons[FALLBACK_ICON];
}

function rotation(value: string | number | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  if (value.endsWith("deg")) return Number.parseFloat(value) / 90;
  return Number(value) || 0;
}

function transform(data: LocalIconData, rotate: string | number | undefined, flip: string | undefined) {
  const turns = (rotation(rotate ?? data.rotate) % 4 + 4) % 4;
  const transforms: string[] = [];

  if (data.hFlip || flip === "horizontal" || flip === "both") {
    transforms.push("scaleX(-1)");
  }
  if (data.vFlip || flip === "vertical" || flip === "both") {
    transforms.push("scaleY(-1)");
  }
  if (turns) transforms.push(`rotate(${turns * 90}deg)`);

  return transforms.length ? transforms.join(" ") : undefined;
}

function iconStyle(
  style: IconProps["style"],
  inline: boolean | string | undefined,
  data: LocalIconData,
  rotate: string | number | undefined,
  flip: string | undefined,
): IconProps["style"] {
  const verticalAlign = inline ? "vertical-align:-0.125em" : "";
  const iconTransform = transform(data, rotate, flip);
  const transformStyle = iconTransform ? `transform:${iconTransform}` : "";
  const additions = [verticalAlign, transformStyle].filter(Boolean).join(";");

  if (!additions) return style;
  if (typeof style === "string") return `${style};${additions}`;
  return { ...style, ...(inline ? { "vertical-align": "-0.125em" } : {}), ...(iconTransform ? { transform: iconTransform } : {}) };
}

export function Icon(props: IconProps) {
  const svgProps = { ...props } as Record<string, unknown>;
  delete svgProps.icon;
  delete svgProps.inline;
  delete svgProps.mode;
  delete svgProps.rotate;
  delete svgProps.flip;
  delete svgProps.noobserver;
  const data = () => iconData(props.icon);
  const viewBox = () => {
    const current = data();
    return `${current.left} ${current.top} ${current.width} ${current.height}`;
  };

  return (
    <svg
      {...svgProps}
      viewBox={viewBox()}
      width={props.width ?? props.height ?? "1em"}
      height={props.height ?? props.width ?? "1em"}
      style={iconStyle(props.style, props.inline, data(), props.rotate, props.flip)}
      innerHTML={data().body}
    />
  );
}
