// D1 identifiers are UUID strings; this keeps component-level ID annotations stable.
export type Id<_TableName extends string> = string;
export type Doc<_TableName extends string> = Record<string, unknown> & {_id:string};
