#!/usr/bin/env bash
# Wszystkie testy projektu. Uruchomienie: bash tests/run.sh
set -euo pipefail

cd "$( dirname "${BASH_SOURCE[0]}" )/.."

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
