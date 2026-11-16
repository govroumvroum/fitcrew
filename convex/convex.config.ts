import agent from "@convex-dev/agent/convex.config";
import mcp from "@convex-dev/mcp/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(migrations);
// The MCP server (#135): /mcp and the OAuth discovery routes live at the
// origin root, so the app itself must not set an httpPrefix.
app.use(mcp);
// Two instances of the same component: the Coach and the Chef each get their own
// threads table, so one's conversation list can never show the other's.
app.use(agent); // the Coach — existing tables, untouched
app.use(agent, { name: "chefAgent" }); // the Chef — components.chefAgent

export default app;
