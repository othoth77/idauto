#!/usr/bin/env python3
"""IDauto — IDA-UI-3 — writes the workspace page shells (reference/app-*.html and two admin pages).

Every page: <html lang="fr"> (the server switches it to ar/rtl), the Design System, the
shared shell stylesheet, an empty sidebar the shell fills, one <main> with a header, and
the scripts in a fixed order: Arabic catalogue, i18n, DS ui, shell, console helpers, page.
No inline script or style (CSP). Run: python3 ops/ui/build-pages.py
"""
import os, html
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'reference')

def page(fname, prefix, title, h1, sub, body, script, actions=''):
    a = '/atelier' if prefix == 'atelier' else '/admin'
    assets = '/atelier/assets' if prefix == 'atelier' else '/admin/assets'
    css = a + '/admin.css'
    scripts = [a + '/i18n-catalog-ar.js', a + '/i18n.js', assets + '/ui.js', a + '/shell.js', a + '/console.js', script]
    out = f'''<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>IDauto — {html.escape(title)}</title>
  <link rel="icon" type="image/svg+xml" href="{assets}/favicon.svg">
  <link rel="stylesheet" href="{assets}/tokens.css">
  <link rel="stylesheet" href="{assets}/base.css">
  <link rel="stylesheet" href="{assets}/components.css">
  <link rel="stylesheet" href="{css}">
</head>
<body>
<a class="ida-skip-link" href="#main">Aller au contenu</a>
<div class="ida-admin-shell">
<aside class="ida-admin-sidebar" data-admin-sidebar aria-label="Navigation principale"></aside>
<div class="ida-admin-main">
<main id="main" class="ida-container ida-u-pad-section">
  <div class="ida-stack-lg">
    <header class="ida-page-head">
      <div>
        <h1>{html.escape(h1)}</h1>
        <p class="ida-muted ida-u-maxch-52">{html.escape(sub)}</p>
      </div>
      <div class="ida-page-actions">{actions}</div>
    </header>
    <div id="page-status" aria-live="polite"></div>
{body}
  </div>
</main>
</div>
</div>
''' + ''.join(f'<script src="{s}"></script>\n' for s in scripts) + '</body>\n</html>\n'
    with open(os.path.join(ROOT, fname), 'w', encoding='utf-8') as f: f.write(out)

def frag(name):
    with open(os.path.join(os.path.dirname(__file__), 'fragments', name + '.html'), encoding='utf-8') as f: return f.read().rstrip('\n')

PAGES = [
  ('app-dashboard.html', 'atelier', 'Tableau de bord', 'Tableau de bord', "L'état réel de la base des véhicules, compté au chargement de la page.", 'dashboard', '/atelier/app-dashboard.js',
   '<a class="ida-btn ida-btn--secondary" href="/atelier/interventions?new=1">Nouvelle intervention</a><a class="ida-btn ida-btn--primary" href="/atelier/vehicules/nouveau">Ajouter un véhicule</a>'),
  ('app-vehicles.html', 'atelier', 'Véhicules', 'Véhicules', 'Les véhicules que votre atelier a enregistrés, documentés ou entretenus.', 'vehicles', '/atelier/app-vehicles.js',
   '<a class="ida-btn ida-btn--primary" href="/atelier/vehicules/nouveau">Ajouter un véhicule</a>'),
  ('app-register.html', 'atelier', 'Ajouter un véhicule', 'Ajouter un véhicule', 'Saisissez les informations de la carte grise. Les photos de la carte sont jointes au dossier comme pièces justificatives ; rien n\'est lu automatiquement.', 'register', '/atelier/app-register.js'),
  ('app-dossier.html', 'atelier', 'Dossier du véhicule', 'Dossier du véhicule', 'Identité, propriétaire, carte grise et historique d\'entretien du véhicule.', 'dossier', '/atelier/app-dossier.js',
   '<a class="ida-btn ida-btn--primary" id="act-intervention" href="/atelier/interventions?new=1">Nouvelle intervention</a>'),
  ('app-documents.html', 'atelier', 'Cartes grises', 'Cartes grises', 'Les cartes grises jointes aux dossiers des véhicules (faces 1 et 2), documents privés.', 'documents', '/atelier/app-documents.js'),
  ('app-interventions.html', 'atelier', 'Interventions', 'Interventions', 'Les interventions de votre atelier : ce qui a été fait, avec quelles pièces, et leur provenance.', 'interventions', '/atelier/app-interventions.js',
   '<a class="ida-btn ida-btn--secondary" href="/atelier">Identifier par la plaque</a><button type="button" class="ida-btn ida-btn--primary" id="act-new-intervention">Nouvelle intervention</button>'),
  ('app-parts-used.html', 'atelier', 'Pièces posées', 'Pièces posées', 'Chaque pièce posée ou réparée lors d\'une intervention, avec sa provenance telle que déclarée.', 'parts-used', '/atelier/app-parts-used.js'),
  ('app-workshops.html', 'atelier', 'Ateliers', 'Ateliers', 'Chaque atelier, les véhicules sur lesquels il a travaillé et les interventions qu\'il a enregistrées.', 'workshops', '/atelier/app-workshops.js'),
  ('app-technicians.html', 'atelier', 'Techniciens', 'Techniciens', 'Les comptes de votre atelier et leur activité enregistrée.', 'technicians', '/atelier/app-technicians.js'),
  ('app-catalogue.html', 'atelier', 'Catalogue des pièces', 'Catalogue des pièces', 'Le catalogue local des pièces et leurs références. Une fiche du catalogue ne prouve ni un stock, ni un achat.', 'catalogue', '/atelier/app-catalogue.js'),
  ('app-account.html', 'atelier', 'Mon compte', 'Mon compte', 'Votre profil, votre langue, votre mot de passe et vos sessions.', 'account', '/atelier/app-account.js'),
  ('admin-users.html', 'admin', 'Utilisateurs', 'Utilisateurs', 'Les comptes de la plateforme. Les comptes sont créés et modifiés par l\'opérateur (ops/auth-users.js).', 'users', '/admin/users-ui.js'),
  ('admin-roles.html', 'admin', 'Rôles et permissions', 'Rôles et permissions', 'Ce que chaque rôle peut faire, tel que le serveur l\'applique à chaque requête.', 'roles', '/admin/roles-ui.js'),
]
if __name__ == '__main__':
    for p in PAGES: page(p[0], p[1], p[2], p[3], p[4], frag(p[5]), p[6], p[7] if len(p) > 7 else '')
    print('wrote', len(PAGES), 'pages')
