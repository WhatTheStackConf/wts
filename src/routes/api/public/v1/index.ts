// The catch-all does not match an empty suffix; explicitly register discovery.
export { GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE } from "./[...path]";
