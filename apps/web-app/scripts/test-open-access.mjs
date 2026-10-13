import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const types = await readFile(new URL("../src/types.ts", import.meta.url), "utf8");
const settingsPage = await readFile(new URL("../src/components/settings-page.tsx", import.meta.url), "utf8");
const smokeScript = await readFile(new URL("../../../scripts/smoke-flyvendebonder.sh", import.meta.url), "utf8");
const deployWorkflow = await readFile(new URL("../../../.github/workflows/deploy-main.yml", import.meta.url), "utf8");

assert.match(types, /open_access:\s*boolean/, "Admin status must expose explicit open-access state");

const activeSessionHelper = app.match(/function hasActiveAdminSession[\s\S]*?\n}/)?.[0] ?? "";
assert.match(activeSessionHelper, /session\.open_access/, "Open access must unlock the app without an expiring cookie");

assert.match(settingsPage, /adminStatus\.open_access/, "Settings must distinguish open access from code login");
assert.match(settingsPage, /Åpen tilgang er aktiv/, "Settings must explain that no password is required");

const pendingCheckIndex = app.indexOf("if (adminSession === null)");
const loginGateIndex = app.indexOf('data-testid="login-gate"');
assert.ok(pendingCheckIndex >= 0, "Unknown access mode must have a neutral loading state");
assert.ok(pendingCheckIndex < loginGateIndex, "Neutral loading must render before the login gate is considered");

const authRejectedHandler = app.match(/const handleAuthRejected[\s\S]*?window\.addEventListener\(AUTH_REJECTED_EVENT/)?.[0] ?? "";
assert.match(authRejectedHandler, /adminSession\?\.open_access/, "Auth rejection must handle open mode separately");
assert.match(authRejectedHandler, /await loadAdminSession\(/, "Open mode must revalidate server access after an auth rejection");
const loadAdminSession = app.match(/const loadAdminSession = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(loadAdminSession, /\/api\/v1\/admin\/session/, "Session recovery must query the authoritative server access mode");
assert.match(loadAdminSession, /notifyAuthFailure:\s*false/, "Session revalidation must not emit recursive auth events");
assert.match(loadAdminSession, /await loadProfile\([\s\S]*?notifyAuthFailure:\s*false/, "Session recovery must reload the private profile without recursive auth events");
const loadProfile = app.match(/const loadProfile = useCallback[\s\S]*?\n  }, \[addLog, trackRequest\]\);/)?.[0] ?? "";
assert.match(loadProfile, /notifyAuthFailure:\s*options\?\.notifyAuthFailure/, "Profile loading must pass through the caller's auth-event policy");
assert.match(authRejectedHandler, /await loadTimeline\(/, "Confirmed open access must restore the cleared timeline even when authentication remains true");
assert.match(authRejectedHandler, /epoch !== privateStateEpochRef\.current/, "Open-mode recovery must not apply a superseded session response");
assert.match(authRejectedHandler, /notifyAuthFailure:\s*false/, "Open-mode revalidation must not emit recursive auth events");

const confirmedSessionFailure = app.match(/if \(confirmedSession\)[\s\S]*?return lockedSession;/)?.[0] ?? "";
assert.match(confirmedSessionFailure, /confirmedSession\.open_access/, "Profile failures must not turn open mode into code login");

assert.match(smokeScript, /EXPECT_OPEN_ACCESS/, "Smoke must support an explicit open-access expectation");
assert.match(deployWorkflow, /EXPECT_OPEN_ACCESS:\s*["']?true["']?/, "Production deploy must require open access");
assert.match(deployWorkflow, /profile\/current/, "Production deploy must verify a private route without a cookie");
assert.match(deployWorkflow, /DEPLOY_REF/, "Production verification must distinguish normal deploys from explicit rollback refs");
assert.match(deployWorkflow, /DEPLOY_REF[\s\S]*admin\/session/, "Rollback compatibility must guard the strict open-access assertion");

console.log("open access tests passed");
