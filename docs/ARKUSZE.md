# Jadłospis w Arkuszu Google

Drugi, niezależny tryb pracy agenta: **bez logowania do panelu**. Czyta publiczną
stronę Kuchni Vikinga, bierze z niej jadłospis **wszystkich diet** i raz dziennie
dopisuje go do arkusza w Twoim Google.

|  | `npm run sync` | `npm run sheet` |
| --- | --- | --- |
| Skąd dane | panel klienta (logowanie) | publiczna strona (bez logowania) |
| Ile diet | tylko Twoja | wszystkie, jakie strona pokazuje |
| Dokąd zapis | Kalendarz + CSV | Arkusz Google + CSV |
| Czego wymaga | login i hasło do panelu | nic poza dostępem do Arkuszy |

Oba mogą działać obok siebie — piszą do tego samego zestawu kolumn i nigdy sobie
nie kasują wierszy. Kolumna **dieta** jest pusta przy danych z panelu (panel zna
tylko jedną dietę) i wypełniona przy danych z publicznej strony.

## 1. Sprawdź, czy strona w ogóle udostępnia jadłospis

```bash
npm run discover
```

Skrypt niczego nie zapisuje — pyta stronę o jej własne API i wypisuje, co znalazł.
Wynik wklej do rozmowy: jeśli nazwy pól okażą się inne niż zakładane, dopisanie ich
to jedna linijka w `agent/public-menu.mjs` (tablica `FIELDS` na górze pliku).

Gdy strona nie wystawia jadłospisu publicznie, `npm run sheet` powie to wprost —
wtedy jedyną drogą zostaje panel (`npm run sync`).

## 2. Dostęp do Arkuszy

Potrzebna jest zgoda obejmująca zakres `https://www.googleapis.com/auth/spreadsheets`.
Jeśli masz już skonfigurowany Kalendarz Google, **to nie wystarczy** — token wydany
tylko na kalendarz dostanie przy arkuszu błąd 403. Zgodę trzeba wydać jeszcze raz,
z obydwoma zakresami.

**Zwykłe konto gmail.com — refresh token.** W [Google Cloud Console](https://console.cloud.google.com/)
włącz *Google Sheets API*, utwórz dane logowania typu *OAuth client ID* → *Desktop app*,
a potem wydaj zgodę na oba zakresy naraz:

```
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/spreadsheets
```

Otrzymane trzy wartości trafiają do `agent/.env`:

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
GOOGLE_REFRESH_TOKEN=…
```

**Konto usługowe.** Zamiast powyższych wypełnij `GOOGLE_SERVICE_ACCOUNT_EMAIL`
i `GOOGLE_PRIVATE_KEY`. Konto usługowe ma własny Dysk, więc arkusz **załóż ręcznie
u siebie** i udostępnij go temu adresowi do edycji — inaczej zapis się uda, ale
plik powstanie tam, gdzie go nie zobaczysz.

## 3. Arkusz

Masz swój arkusz? Weź długi ciąg z jego adresu:

```
https://docs.google.com/spreadsheets/d/TEN_CIĄG/edit
```

i wpisz go do `agent/.env` jako `GOOGLE_SHEET_ID`.

Nie masz? Załóż jednym poleceniem — wypisze gotową linię do wklejenia:

```bash
npm run sheet:create
```

## 4. Uruchomienie

```bash
npm run sheet:dry     # pokazuje, co by zapisał, i nie rusza arkusza
npm run sheet         # zapisuje
```

Codziennie, bez pamiętania o tym (macOS):

```bash
npm run autostart -- 7 30 sheet
```

Wpis w launchd nazywa się `pl.kuchniavikinga.sheet`, log leci do `sheet.log`
w katalogu projektu — jest niezależny od codziennej synchronizacji z kalendarzem.

## Co ląduje w arkuszu

Jeden wiersz to jeden posiłek jednego dnia jednej diety:

| data | dieta | posilek | nazwa | opis | kcal | bialko_g | wegle_g | tluszcz_g | skladniki | alergeny | zaktualizowano |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

**Nic nie znika.** Kolejne uruchomienia dopisują nowe dni i poprawiają zmienione,
ale nigdy nie kasują wierszy — także tych dopisanych ręcznie. Kolumna
`zaktualizowano` zmienia się tylko wtedy, gdy treść posiłku faktycznie się zmieniła,
więc od razu widać, co catering podmienił.

Zakładka (domyślnie `Jadłospis`) zakłada się sama, jeśli jej nie ma.

## Gdy coś nie działa

| Komunikat | Co zrobić |
| --- | --- |
| `nie wystawia REST API WordPressa` | strona nie oddaje danych bez logowania — użyj `npm run sync` |
| `nie ma w nim typu treści z jadłospisem` | uruchom `npm run discover` i pokaż wydruk |
| `Arkusze Google: 403` | zgoda nie obejmuje zakresu `spreadsheets` albo konto usługowe nie ma dostępu do arkusza |
| `Brakuje GOOGLE_SHEET_ID` | uzupełnij `agent/.env` albo załóż arkusz przez `npm run sheet:create` |

## Test

```bash
node tests/public-menu.test.mjs
node tests/sheets.test.mjs
```

Oba stawiają atrapy (WordPressa i API Arkuszy) na localhoście — nie wychodzą
w internet i niczego nie zapisują w Twoim Google.
