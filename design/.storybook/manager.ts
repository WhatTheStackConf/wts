import { addons } from "storybook/manager-api";
import { wtsTheme } from "./theme";

addons.setConfig({ theme: wtsTheme, panelPosition: "bottom", showPanel: true });
