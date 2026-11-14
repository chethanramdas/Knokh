/* Convex client runtime references, matching the Convex API codegen template.
 * Keep this runtime module in source control for clean frontend-only builds.
 * Backend deployment and generated TypeScript declarations are managed separately.
 */
import { anyApi, componentsGeneric } from "convex/server";
export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
