# Uruchomienie na MacBooku

Co robi: loguje się do panelu klienta, czyta jadłospis dzień po dniu, zapisuje go
do **Kalendarza Apple** i dopisuje wszystko do **pliku CSV**, który otwiera się
w Numbers i w Arkuszach Google.

**Nic nigdy nie jest usuwane.** Gdy dzień zniknie z panelu — bo zamówienie się
skończyło albo jadłospis się zmienił — wpis w kalendarzu i wiersz w pliku zostają.

## Krok 1 — narzędzia

Otwórz **Terminal** (Cmd+Spacja → „Terminal") i wklej po kolei:

```bash
# Homebrew, jeśli jeszcze nie masz
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node git
```

Sprawdź, że działa:

```bash
node --version      # powinno pokazać v20 albo wyżej
```

## Krok 2 — pobranie projektu

```bash
mkdir -p ~/Projekty && cd ~/Projekty
git clone https://github.com/hkts7cjgms-svg/viking.git
cd viking
git checkout claude/kuchnia-vikinga-events-q9j530

npm install
npx playwright install chromium
```

## Krok 3 — kalendarz w aplikacji Kalendarz

Otwórz **Kalendarz** → menu **Plik → Nowy kalendarz** → nazwij go **Jadłospis**.

Zrób go osobnym kalendarzem, nie mieszaj z prywatnym. Wtedy widać jednym
kliknięciem, co jest z synchronizacji, i można go schować albo udostępnić osobno.
Jeśli założysz go pod iCloud, wpisy pojawią się też na iPhonie.

## Krok 4 — dane dostępowe

```bash
cp agent/.env.example agent/.env
open -e agent/.env
```

Wypełnij:

```
KV_PANEL_URL=https://panel.kuchniavikinga.pl
KV_PANEL_USER=twój@email
KV_PANEL_PASSWORD=twoje-hasło

KV_APPLE_CALENDAR=Jadłospis
KV_ARCHIVE_CSV=~/Documents/kuchnia-vikinga/jadlospis.csv
```

Zapisz (Cmd+S) i zamknij. Potem zabezpiecz plik, żeby czytał go tylko Twój użytkownik:

```bash
chmod 600 agent/.env
```

Ten plik nigdy nie trafia do repozytorium — blokuje to `.gitignore`.

## Krok 5 — pierwsze uruchomienie

Zacznij od próby na sucho. Nic nie zapisze, tylko pokaże, co by zrobiła:

```bash
cd ~/Projekty/viking
npm run sync:dry
```

Za pierwszym razem macOS zapyta, czy Terminal może sterować **Kalendarzem** —
kliknij **OK**. Jeśli klikniesz przez pomyłkę „Nie zezwalaj":
*Ustawienia systemowe → Prywatność i ochrona → Automatyzacja → Terminal →
zaznacz Kalendarz*.

Gdy chcesz zobaczyć, co robi przeglądarka:

```bash
KV_HEADLESS=0 npm run sync:dry
```

Jak wygląda dobrze — naprawdę:

```bash
npm run sync
```

## Jak działa logowanie

Nie musisz nic klikać — skrypt robi to, co Ty zrobiłbyś ręcznie:

1. Otwiera przeglądarkę (niewidoczną) i wchodzi na panel.
2. **Najpierw próbuje użyć zapamiętanej sesji** z poprzedniego uruchomienia
   (plik `agent/.session.json` — jest w `.gitignore`). Jeśli sesja nadal żyje,
   logowanie w ogóle się nie odbywa; w logu zobaczysz „logowanie pominięte".
3. Dopiero gdy sesja wygasła, wypełnia formularz: e-mail, hasło, „Zaloguj" —
   i zapisuje nową sesję na następny raz.
4. Gdy hasło jest złe, zatrzymuje się z komunikatem, co poprawić — zamiast
   próbować w kółko i zablokować konto.

Efekt: przy codziennym uruchomieniu formularz logowania wypełnia się rzadko,
tylko po wygaśnięciu sesji po stronie panelu.

## Krok 6 — codziennie samo

macOS ma do tego `launchd`. Utwórz plik:

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/pl.kuchniavikinga.sync.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>pl.kuchniavikinga.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>agent/sync-to-calendar.mjs</string>
    <string>--days</string>
    <string>21</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/TWOJA-NAZWA/Projekty/viking</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/tmp/kv-sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/kv-sync.err</string>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/pl.kuchniavikinga.sync.plist
```

Podmień `TWOJA-NAZWA` na swoją nazwę użytkownika (pokaże ją `whoami`). Ścieżkę
do node sprawdzisz przez `which node` — na Macach z procesorem Intel będzie to
`/usr/local/bin/node`.

Podgląd logu: `tail -f /tmp/kv-sync.log`

Wyłączenie: `launchctl unload ~/Library/LaunchAgents/pl.kuchniavikinga.sync.plist`

> Uwaga: `launchd` uruchomi zadanie tylko gdy MacBook jest włączony. Jeśli o 7:30
> był uśpiony, zadanie odpali się po wybudzeniu.

## Archiwum jadłospisu

Każdy przebieg dopisuje dni do `~/Documents/kuchnia-vikinga/jadlospis.csv` —
jeden wiersz na posiłek:

| data | posilek | nazwa | opis | kcal | bialko_g | wegle_g | tluszcz_g | skladniki | alergeny | zaktualizowano |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

- **Numbers** — po prostu kliknij plik dwa razy
- **Arkusze Google** — *Plik → Importuj → Prześlij* i wskaż plik

Wiersze nie znikają. Zmieniony posiłek jest nadpisywany, a kolumna
`zaktualizowano` mówi, kiedy treść faktycznie się zmieniła — jeśli się nie
zmieniła, znacznik zostaje stary. Ręczne dopiski w pliku też przetrwają
kolejną synchronizację (jest na to test).

## Szczegóły posiłku z okna, które wyskakuje

Domyślnie **wyłączone**. Włącza je flaga:

```bash
node agent/sync-to-calendar.mjs --details
```

Wtedy skrypt klika w każdy posiłek, czeka aż wysunie się boczny panel i zbiera
z niego tekst — trafia on do kolumn `skladniki` i `alergeny` oraz do opisu wpisu
w kalendarzu.

**Dlaczego to nie jest domyślne.** Nie znam jeszcze struktury tego panelu, więc
skrypt bierze jego tekst i próbuje rozpoznać nagłówki; gdy się nie uda, zapisuje
całość surowo. Wklej mi kod HTML tego okna, a rozbiorę go na konkretne pola.

**Bezpiecznik.** W tej aplikacji są akcje zmieniające zamówienie, więc skrypt
robi tam dokładnie dwie rzeczy: klika w opis dania i zamyka panel klawiszem
Escape. **Niczego wewnątrz panelu nie klika.** Mimo to pierwszy raz uruchom to
z `--dry-run` i `KV_HEADLESS=0`, żeby zobaczyć na własne oczy, co się dzieje.

## Starszy macOS (12 Monterey i okolice)

Rozpoznasz go po ostrzeżeniu Homebrew „You are using macOS 12 … not supported".
Wszystko da się uruchomić, ale trzy rzeczy robi się inaczej:

**1. Node.** Jeśli `brew install node` się wywali (na starym systemie Homebrew
buduje ze źródeł i to potrafi paść), pobierz instalator wprost:
[nodejs.org](https://nodejs.org) → **LTS** → plik `.pkg` → dwuklik, dalej, dalej.
Node LTS działa na macOS 12 bez problemu.

**2. Ścieżki.** Na Macach z procesorem Intel (instalacja w `/usr/local`) node
ląduje w `/usr/local/bin/node` — i taką ścieżkę wpisz w pliku launchd zamiast
`/opt/homebrew/bin/node`. Zawsze rozstrzyga wynik `which node`.

**3. Przeglądarka.** Nowe wydania Playwrighta nie mają już buildów Chromium dla
macOS 12 — `npx playwright install chromium` może odmówić. Wtedy, po kolei:

```bash
# a) starsza wersja Playwrighta, która jeszcze wspiera macOS 12
npm install --save-exact playwright@1.47.2
npx playwright install chromium
```

Jeśli i to odmówi — użyj Chrome'a, którego masz zainstalowanego. Dopisz
w `agent/.env` jedną linię:

```
PLAYWRIGHT_CHROMIUM_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Skrypt użyje wtedy Twojego Chrome'a zamiast pobierać własnego Chromium.

## Gdy coś nie działa

| Objaw | Co zrobić |
| --- | --- |
| `Nie znalazłem kalendarza "Jadłospis"` | Załóż kalendarz o tej nazwie (krok 3) albo popraw `KV_APPLE_CALENDAR` |
| `macOS nie pozwolił sterować Kalendarzem` | Ustawienia → Prywatność i ochrona → Automatyzacja → Terminal → Kalendarz |
| Logowanie się nie udaje | `KV_HEADLESS=0 npm run sync:dry` i zobacz, co pokazuje panel |
| `command not found: node` | `brew install node`, potem otwórz Terminal od nowa |
| Zero pobranych dni | Sprawdź, czy zamówienie jest aktywne i czy `--days` obejmuje jego termin |

## Bezpieczeństwo

Hasło do panelu to pełny dostęp do konta — nie da się go zawęzić tak jak hasła
aplikacji WordPressa. Dlatego: osobne konto tylko do tego, jeśli to możliwe,
`chmod 600` na pliku `.env` i włączone FileVault na MacBooku.
