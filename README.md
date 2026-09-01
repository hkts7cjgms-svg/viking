# Kuchnia Vikinga — Wydarzenia

Wydarzenia przypisane do dni kalendarza, doklejane automatycznie do opisów posiłków
w jadłospisie na kuchniavikinga.pl (WordPress, motyw `viking` na `understrap`).

Dodajesz raz „Dzień Kuchni Polskiej, 15.09.2026, obiad, dieta smart" — i tekst sam
pojawia się przy obiedzie tego dnia, sam znika dzień później.

## Co jest w repozytorium

| Katalog | Zawartość |
| --- | --- |
| `plugin/kuchnia-vikinga-wydarzenia/` | Wtyczka WordPressa: panel CRUD, doklejanie do jadłospisu, REST API |
| `agent/kv-events.mjs` | CLI do zarządzania wydarzeniami z terminala lub crona |
| `agent/mcp-server.mjs` | Serwer MCP — asystent zarządza wydarzeniami sam, bez panelu |
| `tests/` | Testy: logika dat w PHP, CLI i MCP na atrapie API |
| `docs/` | [Instalacja](docs/INSTALACJA.md) i [opis API](docs/API.md) |

## Jak to działa

Wydarzenie to wpis z zakresem dat i filtrami:

- **od / do** — oba dni wliczone; puste pole znaczy „bez ograniczenia"
- **dni tygodnia** — np. tylko soboty w obrębie zakresu
- **posiłki** — np. tylko obiad; puste = każdy posiłek danego dnia
- **diety** — np. tylko `smart`; puste = wszystkie diety
- **pozycja** — nad albo pod opisem posiłku
- **priorytet** — kolejność, gdy jednego dnia wypada kilka wydarzeń

Doklejanie działa w jednym z dwóch trybów, do wyboru w *Wydarzenia → Ustawienia*:

1. **Przez motyw** (zalecany) — w szablonie jadłospisu jedna linia:
   ```php
   <?php echo kv_opis_posilku( $opis, $data, $posilek, $dieta ); ?>
   ```
   Renderowanie po stronie serwera, więc treść trafia do cache'u strony i do Google.

2. **Przez przeglądarkę** — bez ruszania motywu. Skrypt znajduje bloki posiłków po
   selektorze CSS, czyta datę z atrybutu i dokleja wydarzenia z REST API.
   Warunek: w kodzie strony musi dać się rozpoznać, do którego dnia należy blok.

Jest też shortcode do ręcznego wstawienia gdziekolwiek:

```
[kv_wydarzenia data="2026-09-15" posilek="obiad" dieta="smart"]
```

## Bez klikania w panelu

Wtyczka wystawia REST API pod `/wp-json/kv/v1`. Zapis autoryzuje **hasło aplikacji**
WordPressa — osobne od hasła do panelu, cofalne jednym kliknięciem, bez dostępu do
zmiany hasła czy adresu e-mail konta.

```bash
cp agent/.env.example agent/.env   # uzupełnij KV_SITE_URL, KV_USER, KV_APP_PASSWORD

node agent/kv-events.mjs meta
node agent/kv-events.mjs day 2026-09-15 --diet smart
node agent/kv-events.mjs range 2026-09-01 2026-09-30
node agent/kv-events.mjs add --title "Dzień Kuchni Polskiej" \
    --from 2026-09-15 --to 2026-09-15 --meals obiad --diets smart \
    --body "Dziś obiad w klimacie tradycyjnej kuchni polskiej."
node agent/kv-events.mjs edit 123 --priority 10
node agent/kv-events.mjs rm 123
```

Ten sam zestaw operacji jako serwer MCP — po podpięciu asystent dodaje, zmienia
i usuwa wydarzenia sam. Konfiguracja w [docs/INSTALACJA.md](docs/INSTALACJA.md#agent-mcp).

## Testy

```bash
bash tests/run.sh
```

Sprawdzają składnię wszystkich plików, logikę dopasowania dat (33 asercje) oraz
CLI i serwer MCP na atrapie API (27 asercji) — bez potrzeby stawiania WordPressa.
