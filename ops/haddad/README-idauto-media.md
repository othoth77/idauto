# IDauto photographs — the Haddad copy (Update 3.1)

`idauto-media-receiver.js` keeps a second copy of every IDauto photograph on Haddad, by SHA-256.
idauto.tn (the VPS) stays the primary copy — the one in the nightly off-host backup — and sends each new
file here through `reference/replica/haddad-replica.js` (retried every 30 s; a failure is recorded and shown).

Install on Haddad (user service, nothing as root):

```
install -d -m 700 ~/.config/idauto-media /srv/hybrid/idauto-media
# ~/.config/idauto-media/receiver.env (mode 0600):
#   IDAUTO_MEDIA_RECEIVER_TOKEN=<32+ random characters, the same value as IDAUTO_HADDAD_MEDIA_TOKEN on the VPS>
#   IDAUTO_MEDIA_RECEIVER_ROOT=/srv/hybrid/idauto-media
#   IDAUTO_MEDIA_RECEIVER_PORT=8853
systemctl --user enable --now idauto-media-receiver     # unit: ExecStart=/usr/bin/node <repo>/ops/haddad/idauto-media-receiver.js
tailscale serve --bg --set-path /idauto-media http://127.0.0.1:8853   # private network only
```

On the VPS, in the idauto-api environment file: `IDAUTO_HADDAD_MEDIA_URL=https://<haddad tailnet name>/idauto-media`,
`IDAUTO_HADDAD_MEDIA_ADDR=<haddad tailnet address>` (the VPS does not resolve the tailnet name),
`IDAUTO_HADDAD_MEDIA_TOKEN=<the token>`.

`/srv/hybrid` is not covered by the VPS backup; the Haddad copy is a second copy, not the backup.
