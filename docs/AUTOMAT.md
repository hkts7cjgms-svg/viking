# Automatyczny zapis jadłospisu do Kalendarza Google

Jedno polecenie robi całość: loguje się do panelu klienta, przechodzi po dniach
kalendarza, czyta jadłospis i zapisuje go do Kalendarza Google. Uruchamiane z crona
działa bez niczyjego udziału.

```bash
npm run sync:dry     # próba na sucho — pokazuje, co by zrobiło, nie rusza kalendarza
npm run sync         # naprawdę
```

## Co się dzieje krok po kroku

```
panel.kuchniavikinga.pl          →  jadłospis         →  Kalendarz Google
(Playwright, logowanie hasłem)      (dzień po dniu)      (jeden wpis na dzień)
```

Każdy dzień to jeden wpis całodniowy, w opisie posiłki z wartościami odżywczymi:

```
ŚNIADANIE
Kanapka z chlebem wiejskim, pieczonym schabem i serem
479kcal · B: 46.7g · W: 27.7g · T: 20.2g

OBIAD
Pierogi z ziemniakami i twarogiem, okrasa z boczkiem
589kcal · B: 18.6g · W: 63.0g · T: 28.5g
```

## Instalacja

```bash
npm install
npx playwright install chromium
cp agent/.env.example agent/.env
```

### Dostęp do panelu

W `agent/.env`:

```
KV_PANEL_URL=https://panel.kuchniavikinga.pl
KV_PANEL_USER=adres@email
KV_PANEL_PASSWORD=hasło
```

To jest zwykłe hasło do panelu i nie da się go zawęzić tak jak hasła aplikacji
WordPressa. Dlatego: osobne konto tylko do tego, plik `.env` z uprawnieniami `600`,
i nigdy do repozytorium (`.gitignore` już to blokuje).

### Dostęp do Kalendarza Google

Dwie drogi, obie bez oddawania komukolwiek hasła do Google.

**Refresh token** — działa też na zwykłym koncie gmail.com:

1. [Google Cloud Console](https://console.cloud.google.com/) → nowy projekt
2. *APIs & Services* → włącz **Google Calendar API**
3. *Credentials* → *Create credentials* → *OAuth client ID* → typ **Desktop app**
4. Jednorazowa zgoda w przeglądarce daje `refresh_token` — wpisz go do `.env`
   razem z `GOOGLE_CLIENT_ID` i `GOOGLE_CLIENT_SECRET`

**Konto usługowe** — wygodniejsze przy kalendarzu firmowym, bo nie wygasa i nie
wymaga niczyjej zgody:

1. *Credentials* → *Create credentials* → *Service account* → klucz JSON
2. `GOOGLE_SERVICE_ACCOUNT_EMAIL` i `GOOGLE_PRIVATE_KEY` z pliku JSON do `.env`
3. W Kalendarzu Google udostępnij kalendarz temu adresowi **z prawem edycji**
4. `GOOGLE_CALENDAR_ID` = identyfikator tego kalendarza (z ustawień kalendarza)

## Cron

Raz dziennie w nocy, trzy tygodnie do przodu:

```cron
15 3 * * * cd /sciezka/do/viking && /usr/bin/node agent/sync-to-calendar.mjs --days 21 >> /var/log/kv-sync.log 2>&1
```

## Opcje

| Flaga | Znaczenie |
| --- | --- |
| _(bez flag)_ | bierze wszystko, co kalendarz pokazuje od dziś |
| `--days 21` | ogranicz do N dni do przodu |
| `--from`, `--to` | konkretny zakres zamiast `--days` |
| `--dry-run` | pokazuje plan, nie rusza kalendarza |
| `--out menu.json` | sam odczyt jadłospisu do pliku, bez kalendarza |
| `--quiet` | bez wypisywania postępu |

## Synchronizacja, nie doklejanie

Kolejne uruchomienia **nie duplikują wpisów**. Każdy wpis niesie ukryty znacznik
`kvSource` i skrót treści, więc narzędzie wie, co jest jego:

- nowy dzień → **dodaje**
- dzień zmieniony w panelu → **poprawia** istniejący wpis
- dzień, który zniknął z jadłospisu → **usuwa** wpis
- dzień bez zmian → **zostawia w spokoju** (bez zbędnych zapisów)
- duplikat na ten sam dzień → **sprząta**

**Wpisy bez naszego znacznika nie są ruszane.** Urodziny, spotkania i wszystko inne
w tym kalendarzu jest bezpieczne — jest na to test.

## Ograniczenia, o których trzeba wiedzieć

**To sterowanie cudzą aplikacją przez przeglądarkę.** Panel należy do zewnętrznego
dostawcy. Jeśli przebuduje układ strony, odczyt przestanie działać — narzędzie wtedy
nic nie zapisze i powie o tym w logu, zamiast psuć kalendarz. Warto też sprawdzić,
czy regulamin dostawcy nie zabrania automatyzacji.

**Zbierane jest to, co widać na karcie dnia** — nazwa posiłku, opis i wartości
odżywcze. Szczegóły z bocznego panelu, który otwiera się po kliknięciu w posiłek,
jeszcze nie: nie znam jego struktury HTML. Miejsce na nie jest już przygotowane
(pole `details`), więc gdy wkleisz ten fragment kodu strony, składniki i alergeny
dojdą bez przebudowy.

**Docelowo lepsze jest API dostawcy.** Odczyt przez przeglądarkę jest wolniejszy
i wrażliwy na zmiany wyglądu. Jeśli dostaniecie dostęp do API, wymienia się jeden
plik (`agent/panel-sync.mjs`) — reszta łańcucha zostaje bez zmian.

## Testy

```bash
node tests/panel-scrape.test.mjs      # odczyt jadłospisu ze struktury panelu
node tests/calendar-sync.test.mjs     # planowanie synchronizacji
```

57 asercji, bez sieci i bez konta Google. Sprawdzają m.in. że powtórne uruchomienie
niczego nie duplikuje, że zmiana jadłospisu poprawia wpis zamiast dodawać drugi,
i że cudze wpisy w kalendarzu pozostają nietknięte.
