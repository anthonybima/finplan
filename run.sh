#!/bin/sh
# FinPlan on a VPS without any registry: runs inside the stock caddy:2-alpine image.
# Downloads the built site from this repo's `site` branch (published by GitHub Actions),
# serves it with Caddy (automatic HTTPS for $SITE_ADDRESS), and checks every 5 minutes
# for a newer build, swapping it in without downtime.
REPO="${FINPLAN_REPO:-anthonybima/finplan}"
BR="${FINPLAN_BRANCH:-site}"
TARBALL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BR"

fetch() {
  rm -rf /srv/new && mkdir -p /srv/new || return 1
  wget -qO- "$TARBALL" | tar xz -C /srv/new --strip-components=1 || return 1
  [ -f /srv/new/www/index.html ] && [ -f /srv/new/Caddyfile ] || return 1
  rm -rf /srv/old
  [ -d /srv/finplan ] && mv /srv/finplan /srv/old
  mv /srv/new /srv/finplan && cp /srv/finplan/Caddyfile /etc/caddy/Caddyfile
}
rev() {
  wget -qO- -U finplan-updater --header 'Accept: application/vnd.github.sha' \
    "https://api.github.com/repos/$REPO/commits/$BR" 2>/dev/null
}

until fetch; do echo "finplan: download failed, retrying in 15s"; sleep 15; done
echo "finplan: site ready"

(
  cur=$(rev)
  while true; do
    sleep 300
    new=$(rev)
    if [ -n "$new" ] && [ "$new" != "$cur" ] && fetch; then
      caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && cur=$new && echo "finplan: updated to $new"
    fi
  done
) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
