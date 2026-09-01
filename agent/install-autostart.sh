#!/usr/bin/env bash
# Ustawia codzienne uruchamianie synchronizacji na macOS (launchd).
#
#   npm run autostart          # codziennie o 7:30
#   npm run autostart -- 6 45  # codziennie o 6:45
#
# Sciezki wykrywa sam - nie ma czego podmieniac recznie.
set -euo pipefail

if [[ "$( uname )" != "Darwin" ]]; then
	echo "To jest narzędzie dla macOS. Na innym systemie użyj crona (docs/AUTOMAT.md)." >&2
	exit 1
fi

HOUR="${1:-7}"
MINUTE="${2:-30}"

PROJECT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
NODE="$( command -v node )"
LABEL="pl.kuchniavikinga.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ -z "$NODE" ]]; then
	echo "Nie znalazłem node. Zainstaluj go i uruchom ponownie." >&2
	exit 1
fi

if [[ ! -f "$PROJECT/agent/.env" ]]; then
	echo "Brakuje $PROJECT/agent/.env — najpierw uzupełnij dane dostępowe." >&2
	exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Wczesniejsza wersja moze dzialac - wyladowujemy ja, zanim nadpiszemy plik.
launchctl unload "$PLIST" 2> /dev/null || true

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$NODE</string>
		<string>agent/sync-to-calendar.mjs</string>
	</array>
	<key>WorkingDirectory</key><string>$PROJECT</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key><integer>$HOUR</integer>
		<key>Minute</key><integer>$MINUTE</integer>
	</dict>
	<key>StandardOutPath</key><string>$PROJECT/sync.log</string>
	<key>StandardErrorPath</key><string>$PROJECT/sync.log</string>
</dict>
</plist>
PLIST_END

# Sprawdzenie skladni - lepiej zlapac blad tu niz cisza o 7:30.
plutil -lint "$PLIST" > /dev/null

launchctl load "$PLIST"

printf 'Gotowe. Synchronizacja będzie się uruchamiać codziennie o %02d:%02d.\n' "$HOUR" "$MINUTE"
echo
echo "  Projekt:  $PROJECT"
echo "  Node:     $NODE"
echo "  Log:      $PROJECT/sync.log"
echo
echo "Uruchom teraz, nie czekając do rana:  launchctl start $LABEL"
echo "Podgląd działania:                    tail -f $PROJECT/sync.log"
echo "Wyłączenie:                           launchctl unload $PLIST"
