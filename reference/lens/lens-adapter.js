'use strict';
// =====================================================
// IDauto — Update 5 — the LENS interface for carte grise documents. NOT ACTIVE.
// reference/lens/lens-adapter.js
//
// Owner decision, 2026-11-18: LENS is still under development and is NOT integrated into IDauto yet. IDauto captures
// and stores carte grise source documents only; it performs no OCR and no extraction (no second engine, no parser,
// no temporary alternative). Every new source document is stored with processing_status = 'PENDING_LENS'.
//
// This file is the single place the future integration will live. Nothing else in IDauto may call LENS.
//
// Update 6 (owner, 2026-11-18): a carte grise received WITHOUT a vehicle (documents/carte-grise-intake.js) IS sent to LENS —
// by the Haddad receiver, never by IDauto: IDauto still makes no call to LENS. The receiver submits the original to the
// local LENS service and returns technical fields only; archive-service reads them back. See docs/CARTE_GRISE_INTAKE.md.
//
// THE CONTRACT (to be honoured by the implementation, once the LENS API and extraction schema are stable):
//
//   enabled() → false today.
//
//   submit(doc) → { job_ref }
//     doc = { document_id, vehicle_ivid, source_format: 'CARTE_GRISE_IMAGE' | 'CARTE_GRISE_PDF' | 'CARTE_GRISE_TEXT',
//             mime_type, sha256, bytes (Buffer) }
//     · images and PDFs: the ORIGINAL bytes, as stored (never the corrected crop alone);
//     · text: the ORIGINAL UTF-8 text, as pasted — never converted to a PDF or an image.
//     IDauto then sets processing_status = 'PROCESSING' and lens_job_ref = job_ref.
//
//   status(job_ref) → { state: 'queued' | 'running' | 'succeeded' | 'needs_review' | 'failed',
//                       extraction: { document_type, extraction_version, processed_at,
//                                     fields: [{ key, value, normalized, confidence (0–1), state, evidence }],
//                                     missing: [key], checks: [{ rule, ok, detail }] } }
//     IDauto stores extraction in lens_extraction (TECHNICAL fields only: the holder's name, CIN and address are never
//     kept — owner decision), extraction_version, processed_at, and sets processing_status DONE / FAILED.
//     Nothing changes on the vehicle until a person validates (validation_status VALIDATED / CORRECTED / REJECTED);
//     a verified identity field is never overwritten silently, and a VIN that differs from the vehicle's is a mismatch
//     to review, never an update.
// =====================================================

var STATUSES = ['NONE', 'PENDING_LENS', 'PROCESSING', 'DONE', 'FAILED'];

function enabled() { return false; }

function notEnabled() {
  return Object.assign(new Error('LENS is not integrated yet (owner decision 2026-11-18): documents stay PENDING_LENS'), { code: 'LENS_NOT_ENABLED', httpStatus: 503 });
}
async function submit(doc) { throw notEnabled(); }            // eslint-disable-line no-unused-vars
async function status(jobRef) { throw notEnabled(); }         // eslint-disable-line no-unused-vars

// What a newly stored source document is marked with: waiting for LENS, whatever its format.
function initialStatus() { return 'PENDING_LENS'; }

module.exports = { enabled: enabled, submit: submit, status: status, initialStatus: initialStatus, STATUSES: STATUSES };
