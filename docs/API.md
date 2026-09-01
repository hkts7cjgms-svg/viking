# REST API

Baza: `https://kuchniavikinga.pl/wp-json/kv/v1`

Odczyt opublikowanych wydarzeń jest publiczny — korzysta z niego front strony.
Zapis wymaga hasła aplikacji WordPressa (Basic auth) użytkownika z uprawnieniem
`edit_posts`.

```bash
curl -u "agent:xxxx xxxx xxxx xxxx xxxx xxxx" \
     https://kuchniavikinga.pl/wp-json/kv/v1/events
```

## Obiekt wydarzenia

```json
{
  "id": 123,
  "status": "publish",
  "title": "Dzień Kuchni Polskiej",
  "body": "Dziś obiad w klimacie tradycyjnej kuchni polskiej.",
  "badge": "🇵🇱",
  "date_from": "2026-09-15",
  "date_to": "2026-09-15",
  "weekdays": [],
  "meals": [ "obiad" ],
  "diets": [ "smart" ],
  "placement": "after",
  "priority": 0,
  "edit_link": "https://kuchniavikinga.pl/wp-admin/post.php?post=123&action=edit"
}
```

| Pole | Znaczenie |
| --- | --- |
| `date_from` / `date_to` | `RRRR-MM-DD`; `null` = bez ograniczenia. Oba dni wliczone. |
| `weekdays` | `1` = poniedziałek … `7` = niedziela. Pusta lista = wszystkie dni zakresu. |
| `meals` | slugi posiłków. Pusta lista = każdy posiłek danego dnia. |
| `diets` | slugi diet. Pusta lista = wszystkie diety. |
| `placement` | `before` = nad opisem posiłku, `after` = pod nim. |
| `priority` | wyższa liczba = wyżej na liście danego dnia. |

Slugi są normalizowane: `II Śniadanie` i `ii-sniadanie` to ta sama wartość.

## Endpointy

### `GET /meta`

Słowniki: dostępne posiłki (slug + etykieta), diety, dzisiejsza data w strefie
czasowej strony, aktualny tryb wyświetlania. Warto zawołać jako pierwsze — mówi,
jakie wartości `meals` i `diets` mają sens.

### `GET /events`

| Parametr | Opis |
| --- | --- |
| `date` | tylko wydarzenia obowiązujące tego dnia |
| `from`, `to` | wydarzenia zahaczające o zakres |
| `meal`, `diet` | filtr po posiłku / diecie |
| `status` | `publish` (domyślnie), `draft`, `any` — inne niż `publish` wymagają autoryzacji |
| `search` | szukany tekst w tytule lub treści |
| `per_page`, `page` | stronicowanie; nagłówki `X-WP-Total`, `X-WP-TotalPages` |

### `GET /events/{id}`

Pojedyncze wydarzenie. Nieopublikowane widoczne po autoryzacji.

### `POST /events`

Tworzy wydarzenie. Wymagane `title`, reszta pól opcjonalna.

```bash
curl -u "agent:HASLO" -X POST \
  -H 'Content-Type: application/json' \
  -d '{"title":"Dzień Kuchni Polskiej","date_from":"2026-09-15","date_to":"2026-09-15","meals":["obiad"],"diets":["smart"],"body":"Dziś obiad z pomysłem."}' \
  https://kuchniavikinga.pl/wp-json/kv/v1/events
```

Zwraca `201` i utworzony obiekt.

### `PATCH /events/{id}`

Zmienia tylko przesłane pola — reszta zostaje bez zmian. Przyjmuje też `POST` i `PUT`.

```bash
curl -u "agent:HASLO" -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{"priority":10}' \
  https://kuchniavikinga.pl/wp-json/kv/v1/events/123
```

### `DELETE /events/{id}`

Domyślnie do kosza. `?force=true` kasuje trwale.

### `GET /day/{RRRR-MM-DD}`

Co pokaże się danego dnia: lista wydarzeń, ich liczba i gotowy HTML.
Opcjonalne `meal` i `diet`. Przydatne do podglądu przed publikacją zmiany.

### `GET /range`

Kalendarz: co wypada w kolejnych dniach zakresu. Wymaga `from` i `to`, przyjmuje
`meal` i `diet`. Domyślnie pomija dni bez wydarzeń — `only_with_events=false`
zwraca też puste.

```bash
curl 'https://kuchniavikinga.pl/wp-json/kv/v1/range?from=2026-09-01&to=2026-09-30&diet=smart'
```

### `GET /render`

Wersja dla frontu: zwraca `before` i `after` jako gotowe fragmenty HTML.
Wymaga `date`, przyjmuje `meal` i `diet`.

## Błędy

| Kod | Kiedy |
| --- | --- |
| `kv_missing_title` (400) | `POST` bez `title` |
| `kv_bad_date` (400) | data spoza formatu `RRRR-MM-DD` |
| `kv_bad_range` (400) | `date_to` wcześniejsze niż `date_from` |
| `kv_not_found` (404) | brak wydarzenia o tym ID |
| `kv_forbidden` (401/403) | odczyt szkiców lub zapis bez autoryzacji |

## Hooki dla motywu

```php
// Opis posiłku z doklejonymi wydarzeniami.
kv_opis_posilku( string $opis, string $data, ?string $posilek, ?string $dieta ): string

// Sam HTML wydarzeń danego dnia.
kv_wydarzenia_dnia( string $data, ?string $posilek, ?string $dieta ): string

// Ostatnie słowo w sprawie tego, co trafia na stronę danego dnia.
apply_filters( 'kv_wydarzenia_dla_dnia', array $wydarzenia, string $data, ?string $posilek, ?string $dieta )

// Podmiana szablonu listy wydarzeń na własny plik.
apply_filters( 'kv_wydarzenia_szablon', string $sciezka )

// Górny limit wydarzeń trzymanych w indeksie (domyślnie 500).
apply_filters( 'kv_wydarzenia_index_limit', int $limit )
```
