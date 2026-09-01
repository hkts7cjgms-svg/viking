# Instalacja

## 1. Wgranie wtyczki

Spakuj katalog wtyczki i wgraj go przez panel:

```bash
cd plugin && zip -r kuchnia-vikinga-wydarzenia.zip kuchnia-vikinga-wydarzenia
```

*Wtyczki → Dodaj nową → Wyślij wtyczkę na serwer* → wybierz plik → **Zainstaluj** → **Włącz**.

Alternatywnie przez FTP/SSH: wgraj katalog `kuchnia-vikinga-wydarzenia` do
`wp-content/plugins/` i włącz wtyczkę w panelu.

Po włączeniu w menu bocznym pojawia się **Wydarzenia**.

## 2. Ustawienia

*Wydarzenia → Ustawienia*:

- **Posiłki** — slugi po przecinku, domyślnie
  `sniadanie, ii-sniadanie, obiad, podwieczorek, kolacja`.
  Muszą odpowiadać temu, czym motyw opisuje posiłki w jadłospisie.
- **Diety** — slugi po przecinku, np. `smart, keto, wegetarianska`.
  Puste = wydarzenia nie są filtrowane po diecie.
- **Tryb** — patrz niżej.

## 3. Podpięcie do jadłospisu

### Tryb „przez motyw" (zalecany)

W szablonie jadłospisu w motywie `viking` znajdź miejsce, w którym wypisywany jest
opis posiłku, i owiń je funkcją wtyczki:

```php
<?php // przed: ?>
<div class="opis"><?php echo $posilek['opis']; ?></div>

<?php // po: ?>
<div class="opis"><?php echo kv_opis_posilku( $posilek['opis'], $data, $posilek['typ'], $dieta ); ?></div>
```

Argumenty:

| Argument | Znaczenie |
| --- | --- |
| `$opis` | oryginalny opis posiłku |
| `$data` | data dnia — `Y-m-d`, timestamp albo obiekt `DateTime` |
| `$posilek` | slug posiłku, np. `obiad` (opcjonalny) |
| `$dieta` | slug diety, np. `smart` (opcjonalny) |

Jeśli wolisz nie wołać funkcji wtyczki wprost, motyw może wołać sam filtr —
wtyczka podpina się pod nazwę z ustawień:

```php
<?php echo apply_filters( 'kv_meal_description', $opis, $data, $posilek, $dieta ); ?>
```

### Tryb „przez przeglądarkę" (bez zmian w motywie)

Wymaga, żeby blok posiłku w HTML-u niósł datę. Domyślnie wtyczka szuka
`[data-kv-date]`, ale selektor i nazwy atrybutów zmienia się w ustawieniach — jeśli
motyw ma już własne atrybuty z datą, wystarczy je wpisać.

Gdy jadłospis przeładowuje się AJAX-em, skrypt sam wyłapuje nowe bloki
(`MutationObserver`). Można też wymusić odświeżenie:

```js
document.dispatchEvent( new CustomEvent( 'kv-wydarzenia:refresh' ) );
```

## 4. Dodanie pierwszego wydarzenia

*Wydarzenia → Dodaj nowe*:

- **Tytuł** — np. `Dzień Kuchni Polskiej`
- **Treść** — tekst, który zobaczy klient przy posiłku
- **Od dnia / Do dnia** — `2026-09-15` w obu polach dla wydarzenia jednodniowego
- **Posiłki** — zaznacz `Obiad`
- **Diety** — zaznacz `smart`, jeśli dotyczy tylko tej diety

Opublikuj. Kontrola: *Wydarzenia* → pole **obowiązuje dnia** nad listą pokazuje,
co faktycznie wyświetli się danego dnia.

## 5. Dostęp dla agenta {#agent-mcp}

### Hasło aplikacji

*Użytkownicy → Profil → Hasła aplikacji* → nazwa np. `agent wydarzeń` → **Dodaj**.
Skopiuj wygenerowany ciąg — pokazuje się raz.

Konto powinno mieć rolę **Redaktor** (uprawnienie `edit_posts`). Nie używaj do tego
konta administratora, a hasło aplikacji trzymaj w `agent/.env` (plik jest w
`.gitignore`). W razie czego cofa się je jednym kliknięciem w tym samym miejscu.

### CLI

```bash
cp agent/.env.example agent/.env
node agent/kv-events.mjs meta          # sprawdzenie połączenia i słowników
```

### Serwer MCP

W konfiguracji klienta MCP:

```json
{
  "mcpServers": {
    "kuchnia-vikinga": {
      "command": "node",
      "args": [ "/pelna/sciezka/do/agent/mcp-server.mjs" ],
      "env": {
        "KV_SITE_URL": "https://kuchniavikinga.pl",
        "KV_USER": "agent",
        "KV_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

Udostępniane narzędzia: `kv_meta`, `kv_list_events`, `kv_get_day`, `kv_add_event`,
`kv_update_event`, `kv_delete_event`.

## Uwagi

- Wydarzenia widoczne na stronie to tylko te **opublikowane**; szkice są pomijane,
  także w filtrze „obowiązuje dnia".
- Indeks wydarzeń jest cache'owany na dobę i czyszczony przy każdym zapisie, więc
  zmiana z panelu lub z API jest widoczna od razu.
- Odinstalowanie wtyczki kasuje ustawienia, ale **zostawia wydarzenia** — to treść,
  nie konfiguracja.
