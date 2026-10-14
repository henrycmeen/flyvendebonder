import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({entryPoints: ["src/lib/api.ts"], alias: {"@": "./src"}, bundle: true, format: "esm", write: false});
const {apiGet, clearApiCache, AUTH_REJECTED_EVENT} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const events = new EventTarget();
globalThis.window = {setTimeout, clearTimeout, location: {origin: "http://localhost"}, dispatchEvent: events.dispatchEvent.bind(events)};
const json = (data, status = 200) => Response.json(data, {status});
const options = {cache: false, retries: 1, retryDelayMs: 0, timeoutMs: 20};
const abortable = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), {once: true});
});

// The first attempt times out. A retry must get its own live signal and deadline.
let calls = 0;
globalThis.fetch = async (_, {signal}) => {
  calls += 1;
  if (calls === 1 || signal.aborted) return abortable(signal);
  return json({recovered: true});
};
assert.deepEqual((await apiGet("/timeout", options)).data, {recovered: true});
assert.equal(calls, 2);

// Cancellation while consuming the body must not become a successful null payload.
calls = 0;
globalThis.fetch = async (_, {signal}) => {
  calls += 1;
  if (calls > 1) return json({bodyRecovered: true});
  const response = json({});
  response.json = () => abortable(signal);
  return response;
};
assert.deepEqual((await apiGet("/body-timeout", options)).data, {bodyRecovered: true});
assert.equal(calls, 2);

// User cancellation is final, even though retries are configured.
const controller = new AbortController();
calls = 0;
globalThis.fetch = (_, {signal}) => {calls += 1; return abortable(signal);};
const cancelled = apiGet("/cancel", {...options, signal: controller.signal, timeoutMs: 1000});
controller.abort();
await assert.rejects(cancelled, error => error.status === 0);
assert.equal(calls, 1);

// Clear during an old request must start a new read, retain its deduplication,
// and prevent the old response from becoming the cache for the new session.
clearApiCache();
const pending = [];
globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
const old = apiGet("/private", {timeoutMs: 1000});
clearApiCache();
const fresh = apiGet("/private", {timeoutMs: 1000});
assert.equal(pending.length, 2);
pending[0](json({session: "old"}));
await old;
assert.equal(apiGet("/private", {timeoutMs: 1000}), fresh);
pending[1](json({session: "new"}));
await fresh;
assert.deepEqual((await apiGet("/private")).data, {session: "new"});
assert.equal(pending.length, 2);

// An obsolete rejection cannot log out the next session; current rejections can.
let rejectedEvents = 0;
events.addEventListener(AUTH_REJECTED_EVENT, () => {rejectedEvents += 1;});
let resolveAuth;
globalThis.fetch = () => new Promise(resolve => {resolveAuth = resolve;});
const oldAuth = apiGet("/old-auth", {retries: 0});
clearApiCache();
resolveAuth(json({detail: "expired"}, 401));
await assert.rejects(oldAuth, error => error.status === 401);
assert.equal(rejectedEvents, 0);
globalThis.fetch = async () => json({detail: "expired"}, 401);
await assert.rejects(apiGet("/current-auth", {retries: 0}), error => error.status === 401);
assert.equal(rejectedEvents, 1);
console.log("API regression checks passed: fresh timeout retry, body cancellation, explicit abort, cache invalidation race, stale auth rejection");
