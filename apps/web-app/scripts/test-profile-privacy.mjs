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

const loginHandler = app.match(/const handleAdminLogin = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(loginHandler, /await loadProfile\(\)/, "Admin login must reload the unredacted profile");
assert.ok(
  loginHandler.indexOf("await loadProfile()") < loginHandler.indexOf("setAdminSession(data)"),
  "Admin login must not unlock editing until the private profile is loaded",
);
assert.match(
  loginHandler,
  /catch[\s\S]*clearPrivateProfileState\(\)[\s\S]*authenticated:\s*false[\s\S]*await logoutAdminAndLoadPublicProfile\(\)/,
  "A partial login failure must clear PII and keep admin editing locked",
);

const logoutHandler = app.match(/const handleAdminLogout = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(
  logoutHandler,
  /await trackRequest\(logoutAdminAndLoadPublicProfile\)/,
  "Admin logout must clear the cookie before replacing private profile state",
);

const clearPrivateProfileState = app.match(/const clearPrivateProfileState = useCallback[\s\S]*?\n  }, \[\]\);/)?.[0] ?? "";
assert.match(clearPrivateProfileState, /profileLoadSeqRef\.current \+= 1/, "Fail-closed transitions must invalidate in-flight profile loads");
assert.match(clearPrivateProfileState, /profileAbortRef\.current\?\.abort\(\)/, "Fail-closed transitions must abort owned profile loads");

const logoutAndLoadPublic = app.match(/const logoutAdminAndLoadPublicProfile = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.ok(
  logoutAndLoadPublic.indexOf("/api/v1/admin/logout") < logoutAndLoadPublic.indexOf("await loadProfile()"),
  "The public profile may only be reloaded after server-side logout",
);

const loadAdminSession = app.match(/const loadAdminSession = useCallback[\s\S]*?\n  }, \[[^\]]+\]\);/)?.[0] ?? "";
assert.match(
  loadAdminSession,
  /if \(!data\.authenticated\)[\s\S]*clearPrivateProfileState\(\)[\s\S]*await loadProfile/,
  "An invalid server session must immediately replace any private profile state",
);
assert.match(
  loadAdminSession,
  /catch[\s\S]*clearPrivateProfileState\(\)/,
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
  /const expiryDelayMs =[\s\S]*window\.setTimeout[\s\S]*logoutAdminAndLoadPublicProfile\(\)/,
  "Session expiry must actively clear private profile state without waiting for another action",
);

console.log("profile privacy tests passed");
