import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
const settingsDialog = await readFile(new URL("../src/components/settings-dialog.tsx", import.meta.url), "utf8");

assert.match(types, /open_access:\s*boolean/, "Admin status must expose explicit open-access state");

const activeSessionHelper = app.match(/function hasActiveAdminSession[\s\S]*?\n}/)?.[0] ?? "";
assert.match(activeSessionHelper, /session\.open_access/, "Open access must unlock the app without an expiring cookie");

assert.match(settingsDialog, /adminStatus\.open_access/, "Settings must distinguish open access from code login");
assert.match(settingsDialog, /Åpen tilgang er aktiv/, "Settings must explain that no password is required");

console.log("open access tests passed");
