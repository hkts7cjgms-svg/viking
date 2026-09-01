# Wydarzenia w kalendarzu

Wtyczka wystawia kanał iCal. Subskrybujesz go raz, a potem każde wydarzenie dodane
w panelu WordPressa albo przez agenta samo pojawia się w kalendarzu — i samo znika,
gdy je usuniesz.

```
https://kuchniavikinga.pl/wp-json/kv/v1/calendar.ics
```

Dokładny adres jest też w *Wydarzenia → Ustawienia → Kalendarz*, gotowy do skopiowania.

## Subskrypcja

**Kalendarz Google** — *Inne kalendarze* → **+** → *Utwórz na podstawie adresu URL* →
wklej adres → **Dodaj kalendarz**. Google odświeża takie kanały co kilka–kilkanaście
godzin; to jego decyzja, nie nasza, i nie da się jej przyspieszyć.

**Outlook** — *Dodaj kalendarz* → *Subskrybuj z internetu* → wklej adres.

**iPhone / iPad** — *Ustawienia → Aplikacje → Kalendarz → Konta → Dodaj konto → Inne →
Dodaj subskrybowany kalendarz* → wklej adres. Tu odświeżanie ustawiasz sam.

**Ważne:** subskrybuj przez adres URL, nie pobieraj pliku. Pobrany plik to zdjęcie stanu
z jednej chwili i nigdy się nie zaktualizuje.

## Zawężanie kanału

Do adresu można dopisać filtry — przydatne, gdy kuchnia i marketing chcą widzieć różne rzeczy:

```
…/calendar.ics?meal=obiad     tylko wydarzenia obiadowe
…/calendar.ics?diet=smart     tylko wydarzenia diety smart
```

## Jak wydarzenia mapują się na wpisy

| Wydarzenie | Wpis w kalendarzu |
| --- | --- |
| Jeden dzień (`od` = `do`) | całodniowy wpis w tym dniu |
| Zakres dat | jeden całodniowy wpis przez cały zakres |
| Zakres + dni tygodnia | cykliczny wpis (`RRULE`), np. co sobotę i niedzielę do końca zakresu |
| `od` bez `do` | jeden dzień — bez daty końca nie ma czego rozciągać |
| **Bez dat („zawsze")** | **nie trafia do kalendarza** — wpis bez terminu nie miałby sensu |

Tytuł wpisu to etykieta i tytuł wydarzenia, opis zawiera treść zamienioną na czysty
tekst plus informację, których posiłków i diet dotyczy.

## Uwagi

- Kanał zawiera tylko wydarzenia **opublikowane**; szkice są pomijane.
- Kanał jest publiczny — kto zna adres, ten go odczyta. To treść marketingowa,
  nie dane klientów, ale nie wklejaj go tam, gdzie ma nie trafić.
- Odpowiedź jest cache'owana na 15 minut, żeby regularne odpytywanie przez kalendarze
  nie obciążało strony.

## Test

```bash
php tests/IcsBuilderTest.php
```

45 asercji: struktura pliku, daty (w tym `DTEND`, które w iCal jest wyłączne), reguły
cykliczne, escapowanie przecinków i średników oraz zawijanie długich linii bez
rozbijania polskich znaków. Wynik był dodatkowo sprawdzony niezależnym parserem
(`icalendar`), który przyjął plik i odczytał wszystkie pola poprawnie.
