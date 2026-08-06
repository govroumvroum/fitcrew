import agent from "@convex-dev/agent/convex.config";
import migrations from "@convex-dev/migrations/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(migrations);
// Two instances of the same component: the Coach and the Chef each get their own
// threads table, so one's conversation list can never show the other's.
app.use(agent); // the Coach — existing tables, untouched
app.use(agent, { name: "chefAgent" }); // the Chef — components.chefAgent

export default app;
