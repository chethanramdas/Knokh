// Legacy Convex source is retained temporarily for migration reference only.
// The deployed application uses Cloudflare Pages Functions and D1.
export type QueryCtx = any;
export type MutationCtx = any;
export type ActionCtx = any;
type Definition = { args?: any; handler: (ctx: any, args: any) => any };
export const query = (definition: Definition) => definition;
export const mutation = (definition: Definition) => definition;
export const action = (definition: Definition) => definition;
export const internalQuery = query;
export const internalMutation = mutation;
export const internalAction = action;
