# Wydarzenia w panelu klienta

Panel na `panel.kuchniavikinga.pl` to **osobna aplikacja React zewnętrznego dostawcy**
(zasoby z `ml-assets.com`). WordPress nie renderuje tam ani jednej linii, więc wtyczka
nie doklei niczego po stronie serwera.

Da się to obejść, bo w panelu **działa już Wasz własny JavaScript przez Google Tag
Managera** (kontener `GTM-KNK4TFX`; widać w kodzie strony własne tagi, m.in. liczniki
`kv_kidsbox_wyslane` i `kv_ppu_count`). Ta sama droga posłuży do wydarzeń.

## Jak to działa

```
WordPress (kuchniavikinga.pl)          Panel klienta (panel.kuchniavikinga.pl)
┌──────────────────────────┐           ┌──────────────────────────────────┐
│ Wydarzenia w panelu WP   │           │ GTM → skrypt panel-events.js     │
│ /wp-json/kv/v1/render ───┼──── CORS ─┼─→ czyta wybrany dzień z kalendarza│
└──────────────────────────┘           │   i dokleja treść do .meal-content│
                                       └──────────────────────────────────┘
```

Skrypt opiera się na strukturze panelu (stan na wrzesień 2026):

| Element | Selektor | Rola |
| --- | --- | --- |
| Dzień kalendarza | `div[data-date="RRRR-MM-DD"]` | źródło daty |
| Wybrany dzień | `li.day.is-selected` | który dzień jest otwarty |
| Karta posiłku | `ul.dashboard-meals-list > li.enhanced-meal-card` | jeden posiłek |
| Nazwa posiłku | `.meal-header .name` | „Śniadanie", „Obiad", „Kolacja" |
| Opis posiłku | `.meal-content` | **tu trafia wydarzenie** |

Karta posiłku nie niesie daty — dlatego dzień bierzemy z zaznaczonego kafelka kalendarza.
Gdy dostawca zmieni klasy CSS, skrypt po prostu nic nie zrobi; panel działa dalej.

## Konfiguracja

### 1. CORS po stronie WordPressa

*Wydarzenia → Ustawienia → Domeny czytające API*: wpisz `https://panel.kuchniavikinga.pl`.
Bez tego przeglądarka odrzuci odpowiedź — panel i WordPress to różne domeny.

Nagłówki idą tylko na trasy `kv/v1`, tylko dla wymienionych domen i **bez**
`Allow-Credentials`, więc obca domena może czytać opublikowane wydarzenia, ale nie zapisywać.

### 2. Tag w Google Tag Managerze

Nowy tag → **Custom HTML**, wyzwalacz *All Pages* (albo tylko panel):

```html
<script>
  window.kvPanelEventsConfig = {
    endpoint: 'https://kuchniavikinga.pl/wp-json/kv/v1/render'
  };
</script>
<script async
  src="https://kuchniavikinga.pl/wp-content/plugins/kuchnia-vikinga-wydarzenia/assets/panel-events.js"></script>
```

Ładowanie z WordPressa oznacza, że poprawki skryptu nie wymagają ruszania GTM-a.

### 3. Sprawdzenie

Otwórz panel, wejdź w dzień z wydarzeniem, otwórz konsolę przeglądarki.

- Widać treść pod opisem posiłku → gotowe.
- Błąd `blocked by CORS policy` → punkt 1 nie został zapisany albo adres się nie zgadza.
- Błąd `Refused to load … Content Security Policy` → patrz niżej.

## Zapis jadłospisu do Kalendarza Google

Ten sam skrypt dokłada w nagłówku karty dnia przycisk **„Zapisz w Kalendarzu Google"**.
Kliknięcie otwiera gotowy formularz Kalendarza Google z wpisem całodniowym na wybrany
dzień, a w opisie — jadłospis tego dnia:

```
ŚNIADANIE
Kanapka z chlebem wiejskim, pieczonym schabem i serem, twarożek szczypiorkowy, pomidor
479kcal · B: 46.7g · W: 27.7g · T: 20.2g

OBIAD
Pierogi z ziemniakami i twarogiem, okrasa z boczkiem, surówka z kiszonej kapusty
589kcal · B: 18.6g · W: 63.0g · T: 28.5g
```

To zwykły link — **żadnego OAuth ani dostępu do konta Google**. Zapisuje ten, kto klika,
na swoim koncie. Adres przelicza się przy każdej zmianie dnia, więc przycisk zawsze
dotyczy tego, co widać na ekranie. Nasze wydarzenia doklejone do opisów posiłków
do wpisu **nie** trafiają — do kalendarza idzie sam jadłospis.

Wyłączenie albo zmiana etykiety:

```html
<script>
  window.kvPanelEventsConfig = {
    endpoint: 'https://kuchniavikinga.pl/wp-json/kv/v1/render',
    saveButton: true,
    saveButtonLabel: 'Zapisz w kalendarzu',
    calendarTitle: 'Jadłospis — Kuchnia Vikinga'
  };
</script>
```

### Czego jeszcze nie obejmuje

Zbierane jest to, co widać na karcie dnia: nazwa posiłku, opis i wartości odżywcze.
**Szczegóły z bocznego panelu**, który otwiera się po kliknięciu w posiłek, nie —
nie znam jeszcze jego struktury HTML. Wklej ją (tak jak poprzednio), a dołożę składniki,
alergeny i cokolwiek tam jest.

## Czego ta droga nie załatwia

Dwie rzeczy trzeba powiedzieć wprost:

**Aplikacja mobilna tego nie zobaczy.** GTM działa w przeglądarce. Natywna apka
pobiera dane wprost z API dostawcy i żaden skrypt się tam nie wykona. Jeśli wydarzenia
mają być również w apce, jedyna droga to API dostawcy panelu.

**To wstrzykiwanie do cudzej aplikacji.** Działa, dopóki dostawca nie przebuduje panelu
albo nie zaostrzy Content Security Policy. Jeśli CSP zablokuje wczytanie skryptu lub
zapytanie do `kuchniavikinga.pl`, zostają dwie opcje: poprosić dostawcę o dopisanie
domeny do `script-src` i `connect-src`, albo wkleić treść skryptu wprost do tagu GTM
(kod GTM-a już się wykonuje, więc inline przejdzie) — ale wtedy fetch i tak wymaga
`connect-src`.

Docelowo warto zapytać dostawcę o API do jadłospisu. Logika dopasowania wydarzeń
(`EventMatcher`) jest napisana bez związku z WordPressem właśnie po to, żeby dało się
ją przełożyć na inne źródło bez przepisywania.

## Test

```bash
npm install          # jednorazowo, dla jsdom
node tests/panel-events.test.mjs
```

Test odtwarza fragment prawdziwego HTML-a panelu i sprawdza m.in., że wydarzenie trafia
do właściwego posiłku, że ponowny przebieg nie dubluje treści i że zmiana dnia
podmienia treść zamiast ją doklejać.
