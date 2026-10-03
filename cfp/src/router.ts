/// <reference types="filesystem-routing/types" />
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { pageRoutes } from "virtual:file-routes";

const routes = fileRoutes(pageRoutes);
export const Router = createRouter({ routes });
