# Privacy — operational notes

**Last updated:** 2026-09-05 (IDA-V14). Architecture and boundaries: `PRIVACY_ARCHITECTURE.md`. This page answers the operational questions: what is stored where, who can read it, how it is deleted, and what is still to be defined.

## Registration document (carte grise) — IDA-V14

The carte grise image carries the holder's name, address and identity number. IDauto stores the **image** (the workshop needs the document in the vehicle file) but never extracts, stores or logs the holder's data.

| Question | Answer |
|---|---|
| Where are the images? | Private media root on the API host (`IDAUTO_MEDIA_STORAGE_PATH`, mode 0640, owner `deploy`), content-addressed by SHA-256, behind `RegistrationDocumentStorage` (`reference/documents/document-storage.js`). Never a public path; the browser only ever calls an authenticated route. |
| What is in PostgreSQL? | Metadata only (`idauto_vehicle_documents`): face, MIME, size, dimensions, hash, capture mode, and the **technical** OCR fields with confidences. No image bytes, no OCR text, no holder field. |
| Who can read them? | A signed-in user with `document:read` of the organisation that uploaded the face, or an admin. Another organisation gets 404. Anonymous visitors and the public passport see nothing. |
| Who can write / delete? | `document:write` (technician, manager, admin) to scan or replace; `document:delete` (manager, admin). |
| Audit | Every store, replace, thumbnail, OCR and delete writes an `idauto_audit_log` row with the actor and the organisation (metadata only). Reads emit a structured `registration_document_read` event (IVID, face, variant — never bytes). |
| OCR | Runs in the user's browser (Tesseract.js, fra + ara). The raw text is sent once to `POST …/registration-document/ocr`, parsed in memory by `TunisianRegistrationDocumentParser`, and discarded. Holder labels (nom, prénom, adresse, CIN, الاسم, العنوان…) drop the line before any field detector runs. Only technical fields are returned and stored. |
| Compression | In the browser: EXIF orientation applied, perspective-corrected crop, longest edge 1600 px, JPEG quality 0.85 (+ a 480 px thumbnail at 0.7). The phone photo (several MB) never leaves the device. Measured sizes are recorded (`original_byte_size` vs `byte_size`). |
| Browser storage | None. Previews are `blob:` URLs revoked on close; no localStorage, sessionStorage, IndexedDB or cookie access by the modules (asserted by tests). |
| Deletion | `DELETE …/registration-document/:face` removes the row and the bytes when no other row references the same content. Replacing a face removes the previous bytes the same way. |
| Retention | **À définir.** No retention period exists for any IDauto media (`config/idauto.example.json` `retention_placeholders` are all `null`, LEGAL-REVIEW-REQUIRED since IDA-1). Until one is decided, documents stay until deleted by an authorised user. |
| Legal basis | **À définir with the owner's legal review.** `carte_grise_scan.legal_status` is still `LEGAL-REVIEW-REQUIRED` in the configuration; the feature is delivered on the owner's explicit order of 2026-09-05 with the technical safeguards above, and that status is not changed by this code. |
