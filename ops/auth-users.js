#!/usr/bin/env node
'use strict';
// =====================================================
// IDauto — IDA-V13 — user provisioning (operator CLI)
// ops/auth-users.js
//
//   node ops/auth-users.js create  --email a@b.tn --name "Prénom Nom" --role admin|manager|technician [--org 3]
//   node ops/auth-users.js set-password --email a@b.tn
//   node ops/auth-users.js set-role     --email a@b.tn --role manager [--org 3]
//   node ops/auth-users.js list
//   node ops/auth-users.js revoke-sessions --email a@b.tn
//   node ops/auth-users.js delete --email a@b.tn
//
// The password is read from the terminal without echo (or from the
// IDAUTO_NEW_PASSWORD environment variable for non-interactive use). It is
// NEVER accepted on the command line — argv lands in shell history and in
// `ps` for every user on the host. Nothing here prints a password or a hash.
// Runs with the API's environment (same .env: database + IDAUTO_AUTH_SECRET).
// =====================================================

var readline = require('readline');
var path = require('path');
var db = require(path.join(__dirname, '..', 'reference', 'db.js'));
var authModule = require(path.join(__dirname, '..', 'reference', 'auth', 'auth.js'));

function arg(name) { var i = process.argv.indexOf('--' + name); return i !== -1 ? process.argv[i + 1] : undefined; }
function die(msg) { console.error(msg); process.exit(2); }
function askHidden(prompt) {
  if (process.env.IDAUTO_NEW_PASSWORD) return Promise.resolve(process.env.IDAUTO_NEW_PASSWORD);
  return new Promise(function (resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    var muted = false;
    rl._writeToOutput = function (s) { if (!muted) rl.output.write(s); };
    rl.question(prompt, function (v) { muted = false; rl.output.write('\n'); rl.close(); resolve(v); });
    muted = true;
  });
}
function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 12) die('Le mot de passe doit comporter au moins 12 caractères.');
  if (p.length > 128) die('Mot de passe trop long (128 max).');
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) die('Le mot de passe doit contenir des lettres et des chiffres.');
}
function checkRole(r) { if (authModule.ROLES.indexOf(r) === -1) die('Rôle invalide : ' + authModule.ROLES.join(' | ')); }

async function userByEmail(email) {
  var r = await db.query('SELECT "id", "name", "email", "role", "org_id" FROM idauto_auth_user WHERE "email" = $1', [email.toLowerCase()]);
  return r.rows[0] || null;
}

async function main() {
  var cmd = process.argv[2];
  var auth = authModule.getAuth();
  if (cmd === 'create') {
    var email = arg('email'), name = arg('name'), role = arg('role') || 'technician', org = arg('org');
    if (!email || !name) die('--email et --name sont requis');
    checkRole(role);
    if (role !== 'admin' && !org) die('--org est requis pour manager / technician');
    if (await userByEmail(email)) die('Cet e-mail existe déjà.');
    var password = await askHidden('Mot de passe (saisie masquée) : ');
    checkPassword(password);
    var created = await auth.api.signUpEmail({ body: { email: email.toLowerCase(), password: password, name: name } });
    var id = created.user.id;
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = $2, "emailVerified" = TRUE WHERE "id" = $3', [role, org ? parseInt(org, 10) : null, id]);
    console.log('Utilisateur créé : ' + email.toLowerCase() + ' (' + role + (org ? ', organisation ' + org : '') + ')');
  } else if (cmd === 'set-password') {
    var u = await userByEmail(arg('email') || die('--email requis'));
    if (!u) die('Utilisateur introuvable.');
    var np = await askHidden('Nouveau mot de passe (saisie masquée) : ');
    checkPassword(np);
    var ctx = await auth.$context;
    var hash = await ctx.password.hash(np);
    await ctx.internalAdapter.updatePassword(u.id, hash);
    await db.query('DELETE FROM idauto_auth_session WHERE "userId" = $1', [u.id]);
    console.log('Mot de passe remplacé ; toutes les sessions de ' + u.email + ' ont été révoquées.');
  } else if (cmd === 'set-role') {
    var u2 = await userByEmail(arg('email') || die('--email requis'));
    if (!u2) die('Utilisateur introuvable.');
    var r2 = arg('role') || die('--role requis'); checkRole(r2);
    var o2 = arg('org');
    if (r2 !== 'admin' && !o2 && !u2.org_id) die('--org est requis pour manager / technician');
    await db.query('UPDATE idauto_auth_user SET "role" = $1, "org_id" = COALESCE($2, "org_id"), "updatedAt" = NOW() WHERE "id" = $3', [r2, o2 ? parseInt(o2, 10) : null, u2.id]);
    await db.query('DELETE FROM idauto_auth_session WHERE "userId" = $1', [u2.id]);
    console.log('Rôle mis à jour ; sessions révoquées (le rôle est lu à la connexion).');
  } else if (cmd === 'list') {
    var rows = (await db.query('SELECT u."email", u."name", u."role", u."org_id", u."createdAt", (SELECT count(*) FROM idauto_auth_session s WHERE s."userId" = u."id" AND s."expiresAt" > NOW()) AS sessions FROM idauto_auth_user u ORDER BY u."createdAt"')).rows;
    rows.forEach(function (r) { console.log([r.email, r.name, r.role, r.org_id || '-', 'sessions:' + r.sessions].join('  ')); });
    if (!rows.length) console.log('(aucun utilisateur)');
  } else if (cmd === 'revoke-sessions') {
    var u3 = await userByEmail(arg('email') || die('--email requis'));
    if (!u3) die('Utilisateur introuvable.');
    var d = await db.query('DELETE FROM idauto_auth_session WHERE "userId" = $1', [u3.id]);
    console.log(d.rowCount + ' session(s) révoquée(s).');
  } else if (cmd === 'delete') {
    var u4 = await userByEmail(arg('email') || die('--email requis'));
    if (!u4) die('Utilisateur introuvable.');
    await db.query('DELETE FROM idauto_auth_user WHERE "id" = $1', [u4.id]);   // sessions and account cascade
    console.log('Utilisateur supprimé.');
  } else {
    die('Usage: create | set-password | set-role | list | revoke-sessions | delete (voir l\'en-tête du fichier)');
  }
  await db.closePool();
}
main().catch(function (e) { console.error('Erreur : ' + (e && e.message ? e.message : e)); process.exit(1); });
