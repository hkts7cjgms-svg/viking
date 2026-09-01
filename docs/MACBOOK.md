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

Jedno polecenie. Ścieżki wykrywa samo, nie ma czego podmieniać:

```bash
cd ~/Projekty/viking
npm run autostart
```

Domyślnie codziennie o 7:30. Inna godzina — podaj ją po `--`:

```bash
npm run autostart -- 6 45     # codziennie o 6:45
```

Nie czekaj do rana, sprawdź od razu:

```bash
launchctl start pl.kuchniavikinga.sync
tail -f sync.log
```

Wyłączenie:

```bash
launchctl unload ~/Library/LaunchAgents/pl.kuchniavikinga.sync.plist
```

> `launchd` uruchomi zadanie tylko gdy MacBook jest włączony. Jeśli o wyznaczonej
> godzinie był uśpiony, zadanie odpali się zaraz po wybudzeniu.

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

## Ile dni się pobiera

Tyle, ile catering opublikował — zwykle około dwóch tygodni do przodu.

**Przełom miesiąca jest obsłużony.** Kalendarz w panelu pokazuje jeden miesiąc
naraz, więc gdy dziś jest 25 września, część jadłospisu leży już w październiku.
Skrypt sam klika strzałkę „następny miesiąc" i pobiera także tamte dni. Sięga do
trzech miesięcy do przodu, ale przewija dalej tylko wtedy, gdy zamówienie
faktycznie trwa do końca bieżącego miesiąca.

**Dni bez menu są pomijane.** Gdy panel pokazuje karty w rodzaju
`Śniadanie - brak menu`, taki dzień nie trafia ani do kalendarza, ani do CSV —
to zapowiedź posiłku, nie posiłek. Dojdzie sam, gdy catering opublikuje menu.

Dlaczego pomijany, a nie zapisywany jako pusty: panel zostawia wtedy na ekranie
dania z poprzedniego dnia. Zapisanie tego, co widać, wpisałoby obiad
z 16 września pod datę 17 września — po cichu, bez żadnego błędu.

## Szczegóły posiłku — składniki i alergeny

Zbierane **domyślnie**. Skrypt otwiera okno każdego dania i wyciąga z niego:

| Pole | Przykład |
| --- | --- |
| Składniki | Schab wieprzowy, TWARÓG PÓŁTŁUSTY (MLEKO), Pomidor, CHLEB WIEJSKI (GLUTEN)… |
| Alergeny | TWARÓG PÓŁTŁUSTY (MLEKO), CHLEB WIEJSKI (GLUTEN) |
| Podanie | Na zimno |
| Energia | 479 kcal / 2005 kJ |
| Wartości odżywcze | Białko, Tłuszcz, Węglowodany, Błonnik, Cukry, Sól, NKT |

Alergeny są wyłuskiwane z tych składników, które panel wyróżnia grubszą czcionką
(pisane wielkimi literami, zgodnie z etykietowaniem żywności).

Wchodzenie w każde danie wydłuża przebieg. Gdy zależy Ci na czasie:

```bash
node agent/sync-to-calendar.mjs --no-details
```

**Bezpiecznik.** W oknie szczegółów są też akcje zmieniające zamówienie, więc
skrypt robi tam dokładnie dwie rzeczy: otwiera okno klikając w opis dania
i zamyka je krzyżykiem albo Escapem. Niczego innego nie dotyka.

## Starszy macOS (12 Monterey i okolice)

Rozpoznasz go po ostrzeżeniu Homebrew „You are using macOS 12 … not supported".
Wszystko da się uruchomić, ale trzy rzeczy robi się inaczej:

**1. Node.** Jeśli `brew install node` się wywali (na starym systemie Homebrew
buduje ze źródeł i to potrafi paść), pobierz instalator wprost:
[nodejs.org](https://nodejs.org) → **22 LTS** → plik `.pkg`. Node 22 wspiera
macOS 11 i nowsze; wersje 24+ wymagają już macOS 13.5.

**2. Ścieżki.** Na Macach z procesorem Intel node ląduje w `/usr/local/bin/node`.
`npm run autostart` wykrywa to sam, więc nie ma czego podmieniać ręcznie.

**3. Przeglądarka.** Nowe wydania Playwrighta nie mają buildów Chromium dla
macOS 12 — dlatego projekt przypina wersję 1.47.2, która je ma. Gdyby mimo to
`npx playwright install chromium` odmówił, dopisz w `agent/.env`:

```
PLAYWRIGHT_CHROMIUM_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

Skrypt użyje wtedy Twojego Chrome'a zamiast pobierać własnego Chromium.

## Gdy coś nie działa

| Objaw | Co zrobić |
| --- | --- |
| `panel nie pokazał kalendarza` | To nie błąd logowania. `npm run diagnose` wypisze, co panel wyświetla, i zapisze `panel.png` |
| `git pull` mówi o nadpisaniu `package.json` | `git checkout -- package.json` a potem `git pull` — zainstalowane paczki zostają nietknięte |
| `Nie znalazłem kalendarza "Jadłospis"` | Załóż kalendarz o tej nazwie (krok 3) albo popraw `KV_APPLE_CALENDAR` |
| `macOS nie pozwolił sterować Kalendarzem` | Ustawienia → Prywatność i ochrona → Automatyzacja → Terminal → Kalendarz |
| Logowanie się nie udaje | `KV_HEADLESS=0 npm run sync:dry` i zobacz, co pokazuje panel |
| `CybotCookiebotDialog intercepts pointer events` | Baner zgód zasłonił przycisk. Naprawione — zrób `git pull` i uruchom ponownie |
| `command not found: node` | `brew install node`, potem otwórz Terminal od nowa |
| `brak posiłków (dzień bez dostawy)` przy każdym dniu | Panel dociąga jadłospis wolniej niż zwykle. Zwiększ cierpliwość: `KV_MEALS_TIMEOUT=30000 npm run sync:dry` |
| `jadłospis jeszcze nieopublikowany` | Normalne. Catering publikuje menu z wyprzedzeniem kilkunastu dni — te dni dojdą same przy kolejnych uruchomieniach |
| Zero pobranych dni | `npm run diagnose` — wypisze każdy dzień z kalendarza i zrobi zrzut ekranu `panel.png` |
| Dni są, ale poza zakresem | Diagnoza pokaże zakres panelu; uruchom np. `node agent/sync-to-calendar.mjs --from 2026-09-02 --to 2026-09-22` |

## Bezpieczeństwo

Hasło do panelu to pełny dostęp do konta — nie da się go zawęzić tak jak hasła
aplikacji WordPressa. Dlatego: osobne konto tylko do tego, jeśli to możliwe,
`chmod 600` na pliku `.env` i włączone FileVault na MacBooku.
