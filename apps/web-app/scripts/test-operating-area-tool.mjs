import assert from "node:assert/strict";
import path from "node:path";

import { build } from "esbuild";

const srcDir = path.join(process.cwd(), "src");
const bundle = await build({
  stdin: {
    contents: `
      export {
        activateOperatingAreaTool,
        beginOperatingAreaConfirmation,
        beginOperatingAreaPreview,
        canInterruptOperatingAreaTool,
        completeOperatingAreaPreview,
        failOperatingAreaPreview,
        finishOperatingAreaConfirmation,
        initialOperatingAreaConfirmationGate,
        initialOperatingAreaToolState,
        operatingAreaConfirmErrorMessage,
        operatingRelationLabel,
        requestOperatingAreaDeactivation,
        selectOperatingAreaCandidate,
      } from "./src/lib/operating-area-tool.ts";
    `,
    resolveDir: process.cwd(),
    sourcefile: "operating-area-tool-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  treeShaking: false,
  alias: { "@": srcDir },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const {
  activateOperatingAreaTool,
  beginOperatingAreaConfirmation,
  beginOperatingAreaPreview,
  canInterruptOperatingAreaTool,
  completeOperatingAreaPreview,
  failOperatingAreaPreview,
  finishOperatingAreaConfirmation,
  initialOperatingAreaConfirmationGate,
  initialOperatingAreaToolState,
  operatingAreaConfirmErrorMessage,
  operatingRelationLabel,
  requestOperatingAreaDeactivation,
  selectOperatingAreaCandidate,
} = await import(moduleUrl);

const point = { lat: 59.1, lng: 9.6 };
const candidate = (candidateId, name) => ({
  candidate_id: candidateId,
  source: "geonorge",
  source_endpoint: "https://example.test/geonorge",
  source_fetched_at: "2026-07-16T09:00:00Z",
  source_updated_at: null,
  name,
  matrikkelnummer: `4003-70/${candidateId}`,
  property_ref: { komm: "4003", gnr: 70, bnr: Number(candidateId), fnr: 0, label: name },
  local_id: candidateId,
  object_type: "Teig",
  accuracy_class: "middels",
  distance_m: 3,
  geometry: { type: "Polygon", coordinates: [[[9.6, 59.1], [9.7, 59.1], [9.7, 59.2], [9.6, 59.1]]] },
  area_m2: 12000,
  area_ha: 1.2,
  existing: null,
});

let state = activateOperatingAreaTool(initialOperatingAreaToolState);
assert.equal(state.active, true);
assert.equal(state.phase, "ready");

state = beginOperatingAreaPreview(state, 11, point);
assert.equal(state.phase, "loading");
assert.deepEqual(state.point, point);

const preview = {
  count: 2,
  candidates: [candidate("1", "Nordjordet"), candidate("2", "Sørjordet")],
  owner_information_available: false,
  owner_information_message: "Eiernavn er ikke tilgjengelig.",
};
state = completeOperatingAreaPreview(state, 11, preview);
assert.equal(state.phase, "results");
assert.equal(state.selectedCandidateId, null, "multiple candidates require an explicit choice");

state = selectOperatingAreaCandidate(state, "2");
assert.equal(state.selectedCandidateId, "2");
assert.equal(selectOperatingAreaCandidate(state, "missing"), state);

const fresh = beginOperatingAreaPreview(state, 12, { lat: 59.2, lng: 9.7 });
assert.equal(completeOperatingAreaPreview(fresh, 11, preview), fresh, "stale success must be ignored");
assert.equal(failOperatingAreaPreview(fresh, 11, "gammel feil"), fresh, "stale failure must be ignored");

const empty = completeOperatingAreaPreview(fresh, 12, { ...preview, count: 0, candidates: [] });
assert.equal(empty.phase, "empty");
assert.equal(empty.selectedCandidateId, null);

const failed = failOperatingAreaPreview(fresh, 12, "Fant ingen teig på dette punktet");
assert.equal(failed.phase, "error");
assert.equal(failed.error, "Fant ingen teig på dette punktet");

const single = completeOperatingAreaPreview(fresh, 12, { ...preview, count: 1, candidates: [candidate("1", "Nordjordet")] });
assert.equal(single.selectedCandidateId, "1", "one unambiguous candidate may be selected automatically");

assert.equal(operatingRelationLabel("owned"), "Eid");
assert.equal(operatingRelationLabel("leased"), "Leid");
assert.equal(operatingRelationLabel("unknown"), "Ikke angitt");
assert.equal(canInterruptOperatingAreaTool("confirming"), false, "a mutating request must not be hidden by cancel or Escape");
assert.equal(canInterruptOperatingAreaTool("results"), true);
assert.equal(operatingAreaConfirmErrorMessage(401, "fallback"), "Admininnlogging kreves for å legge til jordet.");
assert.equal(operatingAreaConfirmErrorMessage(409, "fallback"), "Teigvalget er endret. Trykk i kartet på nytt.");
assert.equal(operatingAreaConfirmErrorMessage(502, "Kilden feilet"), "Kilden feilet");

const gateStart = beginOperatingAreaConfirmation(initialOperatingAreaConfirmationGate);
assert.equal(gateStart.started, true);
assert.equal(beginOperatingAreaConfirmation(gateStart.gate).started, false, "double confirm is locked");
const deferredDeactivate = requestOperatingAreaDeactivation(gateStart.gate);
assert.equal(deferredDeactivate.inFlight, true, "cancel must not hide an in-flight mutation");
assert.equal(deferredDeactivate.deactivatePending, true);
const gateFinish = finishOperatingAreaConfirmation(deferredDeactivate);
assert.equal(gateFinish.shouldDeactivate, true, "deferred cancel runs only after mutation reconciliation");
assert.deepEqual(gateFinish.gate, initialOperatingAreaConfirmationGate);

console.log("operating-area tool tests passed");
