// Uses Convex's own templates; no deployment, credentials, or permissive stubs.
import { readdir, mkdir, writeFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const templates = path.resolve(
  "node_modules/convex/dist/esm/cli/codegen_templates",
);
const { serverCodegen } = await import(
  pathToFileURL(path.join(templates, "server.js"))
);
const { apiCodegen } = await import(
  pathToFileURL(path.join(templates, "api.js"))
);
// Canonical schema-derived model declaration. Unlike the CLI's no-schema fallback,
// every document and index here is inferred from the real checked-in schema.
const dynamicDataModelDTS =
  () => `import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel, SystemTableNames } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<DataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;
`;
const modules = [];
async function walk(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_")) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), name + "/");
    else if (
      /\.tsx?$/.test(name) &&
      !name.endsWith(".d.ts") &&
      !["schema.ts", "auth.config.ts", "convex.config.ts"].includes(name)
    )
      modules.push(name);
  }
}
await walk("src/convex");
const server = serverCodegen({ useTypeScript: false });
const api = apiCodegen(modules, { useTypeScript: false });
await mkdir("src/convex/_generated", { recursive: true });
for (const [name, content] of Object.entries({
  "server.js": server.JS,
  "server.d.ts": server.DTS,
  "api.js": api.JS,
  "api.d.ts": api.DTS,
  "dataModel.d.ts": dynamicDataModelDTS(),
})) {
  const file = "src/convex/_generated/" + name;
  if (name === "api.js") {
    try {
      await access(file);
      continue;
    } catch {
      /* Initial generation only. */
    }
  }
  await writeFile(file, content);
}
console.log(
  "Generated schema-derived Convex server, model, and API types locally.",
);
