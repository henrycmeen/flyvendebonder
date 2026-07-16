import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const api = await readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8");

const loadProfile = app.match(/const loadProfile = useCallback[\s\S]*?\n  }, \[addLog, trackRequest\]\);/)?.[0] ?? "";
assert.match(loadProfile, /cache:\s*false/, "Auth-sensitive profile reads must bypass the API cache");
assert.match(loadProfile, /dedupe:\s*false/, "Auth-sensitive profile reads must not reuse an in-flight response across session changes");
assert.match(
  api,
  /cache:\s*shouldCache\s*\?\s*"default"\s*:\s*"no-store"/,
  "Disabling the API cache must also bypass the browser HTTP cache",
);
assert.match(api, /response\.status === 401 \|\| response\.status === 403/, "Auth rejection must be handled centrally");
assert.match(api, /notifyAuthRejected\(response\.status\)/, "401/403 must invalidate client auth state");
assert.match(api, /function notifyAuthRejected[\s\S]*clearApiCache\(\)/, "Auth rejection must clear cached private reads");

const loginHandler = app.match(/const handleAdminLogin = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(loginHandler, /await loadProfile\(\)/, "Admin login must reload the unredacted profile");
assert.ok(
  loginHandler.indexOf("await loadProfile()") < loginHandler.indexOf("setAdminSession(data)"),
  "Admin login must not unlock editing until the private profile is loaded",
);
assert.match(
  loginHandler,
  /catch[\s\S]*clearPrivateApplicationState\(\)[\s\S]*authenticated:\s*false[\s\S]*await logoutAdminAndClearPrivateState\(\)/,
  "A partial login failure must clear PII and keep admin editing locked",
);

const logoutHandler = app.match(/const handleAdminLogout = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(
  logoutHandler,
  /await trackRequest\(logoutAdminAndClearPrivateState\)/,
  "Admin logout must clear the cookie and private application state",
);

const clearPrivateApplicationState = app.match(/const clearPrivateApplicationState = useCallback[\s\S]*?\n  }, \[\]\);/)?.[0] ?? "";
assert.match(clearPrivateApplicationState, /clearApiCache\(\)/, "Fail-closed transitions must clear cached API reads");
assert.match(clearPrivateApplicationState, /profileLoadSeqRef\.current \+= 1/, "Fail-closed transitions must invalidate in-flight profile loads");
assert.match(clearPrivateApplicationState, /profileAbortRef\.current\?\.abort\(\)/, "Fail-closed transitions must abort owned profile loads");
for (const privateStateSetter of ["setProfile", "setTimeline", "setPhotoPool", "setAlbumPhotos", "setPropertyJobs", "setFlightMissions", "setVideoMapArtifacts"]) {
  assert.match(clearPrivateApplicationState, new RegExp(`${privateStateSetter}\\(`), `${privateStateSetter} must be cleared after auth rejection`);
}

const logoutAndClearPrivate = app.match(/const logoutAdminAndClearPrivateState = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(logoutAndClearPrivate, /\/api\/v1\/admin\/logout/, "Logout must clear the server session");
assert.doesNotMatch(logoutAndClearPrivate, /loadProfile\(/, "Logout must not request a private profile anonymously");

const loadAdminSession = app.match(/const loadAdminSession = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(
  loadAdminSession,
  /if \(!data\.authenticated\)[\s\S]*clearPrivateApplicationState\(\)/,
  "An invalid server session must immediately clear all private application state",
);
assert.doesNotMatch(
  loadAdminSession.match(/if \(!data\.authenticated\)[\s\S]*?} else/)?.[0] ?? "",
  /loadProfile/,
  "An anonymous session must not request the private profile",
);
assert.match(
  loadAdminSession,
  /catch[\s\S]*clearPrivateApplicationState\(\)/,
  "An unknown session state must fail closed without retaining private profile data",
);
assert.match(
  loadAdminSession,
  /let confirmedSession:[\s\S]*catch[\s\S]*configured:\s*confirmedSession\.configured/,
  "A profile reload failure must preserve a successfully confirmed backend configuration state",
);
const authenticatedSessionBranch = loadAdminSession.match(/} else \{[\s\S]*?\n      }/)?.[0] ?? "";
assert.ok(
  authenticatedSessionBranch.indexOf("await loadProfile") < authenticatedSessionBranch.indexOf("setAdminSession(data)"),
  "Private profile loading must complete before admin editing is unlocked",
);

const bootstrap = app.match(/const bootstrap = async[\s\S]*?\n    };/)?.[0] ?? "";
assert.doesNotMatch(bootstrap, /loadProfile\(/, "Bootstrap must not race session validation with an independent profile load");

assert.match(
  app,
  /const expiryDelayMs =[\s\S]*window\.setTimeout[\s\S]*logoutAdminAndClearPrivateState\(\)/,
  "Session expiry must actively clear private application state without waiting for another action",
);
assert.match(app, /if \(!isAdminAuthenticated\) return;[\s\S]*const bootstrap = async/, "Private bootstrap must wait for authentication");
assert.match(app, /AUTH_REJECTED_EVENT[\s\S]*clearPrivateApplicationState\(\)/, "App must fail closed on centralized auth rejection");

console.log("profile privacy tests passed");
