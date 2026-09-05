'use strict';
// =====================================================
// IDauto — IDA-V12 — the error vocabulary of the identification path
// reference/vehicle/errors.js
//
// One typed error per failure the order lists (Phase 14): provider timeout,
// provider unavailable, invalid plate, invalid VIN, vehicle not found,
// catalogue unavailable / not configured, OCR low confidence, network
// failure. Each carries an HTTP status, a stable machine `code`, and a
// French `message_fr` a mechanic can read. Routes answer with toResponse();
// no raw driver or socket text ever reaches a client.
// =====================================================

var CATALOG = {
  INVALID_PLATE:          { status: 400, fr: 'La plaque saisie n\'est pas reconnue. Vérifiez le numéro et réessayez.' },
  PLATE_AMBIGUOUS:        { status: 400, fr: 'La lecture de la plaque est ambiguë. Séparez la série et le numéro.' },
  PLATE_PARTIAL:          { status: 400, fr: 'Lecture partielle : indiquez le type d\'immatriculation (TU ou RS).' },
  INVALID_VIN:            { status: 400, fr: 'Le numéro de châssis (VIN) doit comporter 17 caractères sans I, O ni Q.' },
  OCR_LOW_CONFIDENCE:     { status: 409, fr: 'Lecture incertaine. Confirmez ou corrigez la plaque avant de continuer.' },
  VEHICLE_NOT_FOUND:      { status: 404, fr: 'Véhicule introuvable. Saisissez le VIN ou choisissez marque, modèle et motorisation.' },
  PROVIDER_TIMEOUT:       { status: 504, fr: 'Le service d\'identification met trop de temps à répondre. Réessayez ou saisissez le véhicule manuellement.' },
  PROVIDER_UNAVAILABLE:   { status: 503, fr: 'Le service d\'identification est indisponible. La base locale et la saisie manuelle restent disponibles.' },
  NETWORK_FAILURE:        { status: 503, fr: 'Problème de connexion. Réessayez dans un instant.' },
  CATALOG_NOT_CONFIGURED: { status: 501, fr: 'Catalogue fournisseur non configuré.' },
  CATALOG_UNAVAILABLE:    { status: 503, fr: 'Catalogue fournisseur momentanément indisponible. Les pièces locales restent consultables.' },
  NOT_FOUND:              { status: 404, fr: 'Élément introuvable.' },
  VALIDATION:             { status: 400, fr: 'Données invalides.' },
  FORBIDDEN:              { status: 403, fr: 'Accès refusé.' },
  CONFLICT:               { status: 409, fr: 'Conflit avec un enregistrement existant.' }
};

function IdautoError(code, details, message) {
  var spec = CATALOG[code] || CATALOG.VALIDATION;
  var err = new Error(message || code);
  err.name = 'IdautoError';
  err.code = code;
  err.httpStatus = spec.status;
  err.message_fr = spec.fr;
  err.details = details || null;
  err.isIdautoError = true;
  return err;
}

function is(err, code) { return !!(err && err.isIdautoError && (!code || err.code === code)); }

// Shape every identification route answers on failure. Never includes a
// stack, a driver message or a socket error.
function toResponse(err) {
  if (err && err.isIdautoError) {
    var body = { error: err.code, message_fr: err.message_fr };
    if (err.details) body.details = err.details;
    return { status: err.httpStatus, body: body };
  }
  if (err && err.httpStatus) {
    return { status: err.httpStatus, body: { error: 'request_error', message_fr: 'La demande n\'a pas pu être traitée.' } };
  }
  return { status: 500, body: { error: 'internal', message_fr: 'Une erreur interne est survenue. Réessayez dans un instant.' } };
}

// Maps a Node network / timeout failure from a provider call onto the
// vocabulary. Anything unrecognised is PROVIDER_UNAVAILABLE.
function fromNetwork(err, providerName) {
  var code = err && err.code;
  if (code === 'ETIMEDOUT' || code === 'IDAUTO_TIMEOUT' || (err && /timeout/i.test(err.message || ''))) {
    return IdautoError('PROVIDER_TIMEOUT', { provider: providerName });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
    return IdautoError('NETWORK_FAILURE', { provider: providerName });
  }
  return IdautoError('PROVIDER_UNAVAILABLE', { provider: providerName });
}

module.exports = { CATALOG: CATALOG, IdautoError: IdautoError, is: is, toResponse: toResponse, fromNetwork: fromNetwork };
