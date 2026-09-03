#!/usr/bin/env bash
# Wszystkie testy projektu. Uruchomienie: bash tests/run.sh
set -euo pipefail

cd "$( dirname "${BASH_SOURCE[0]}" )/.."

# Srodowiska z gotowym Chromium (np. Claude Code w chmurze) trzymaja go tutaj.
if [ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
	export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium
fi

echo "== lint PHP =="
find plugin -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null
echo "OK - wszystkie pliki PHP bez bledow skladni"

echo
echo "== lint JS =="
for file in agent/*.mjs tests/*.mjs; do
	node --check "$file"
done
echo "OK - wszystkie pliki JS bez bledow skladni"

echo
echo "== logika dopasowania (PHP) =="
php tests/EventMatcherTest.php

echo
echo "== kanal iCal (PHP) =="
php tests/IcsBuilderTest.php

echo
echo "== CLI na atrapie API =="
node tests/cli.test.mjs

echo
echo "== serwer MCP na atrapie API =="
node tests/mcp.test.mjs

echo
echo "== wstrzykiwacz do panelu klienta =="
node tests/panel-events.test.mjs

echo
echo "== odczyt jadlospisu z panelu =="
node tests/panel-scrape.test.mjs

echo
echo "== szczegoly posilku i etykieta miesiaca =="
node tests/panel-details.test.mjs

echo
echo "== synchronizacja z kalendarzem =="
node tests/calendar-sync.test.mjs

echo
echo "== wpisy dla Kalendarza Apple =="
node tests/apple-calendar.test.mjs

echo
echo "== archiwum jadlospisu =="
node tests/archive.test.mjs

echo
echo "== publiczny jadlospis (atrapa WordPressa) =="
node tests/public-menu.test.mjs

echo
echo "== zapis do Arkuszy Google (atrapa API) =="
node tests/sheets.test.mjs

echo
echo "== logowanie do panelu (prawdziwa przegladarka, atrapa panelu) =="
node tests/panel-login.test.mjs
