<?php
/**
 * Testy budowania kanalu iCal. Uruchomienie: php tests/IcsBuilderTest.php
 */

declare( strict_types = 1 );

require __DIR__ . '/../plugin/kuchnia-vikinga-wydarzenia/includes/EventMatcher.php';
require __DIR__ . '/../plugin/kuchnia-vikinga-wydarzenia/includes/IcsBuilder.php';

use KuchniaVikinga\Wydarzenia\IcsBuilder;

$passed   = 0;
$failures = array();

function ok( bool $condition, string $label ): void {
	global $passed, $failures;

	if ( $condition ) {
		++$passed;
		return;
	}

	$failures[] = $label;
}

/**
 * @param mixed $expected Oczekiwana wartosc.
 * @param mixed $actual   Otrzymana wartosc.
 */
function same( $expected, $actual, string $label ): void {
	global $passed, $failures;

	if ( $expected === $actual ) {
		++$passed;
		return;
	}

	$failures[] = sprintf(
		"%s\n    oczekiwano: %s\n    otrzymano:  %s",
		$label,
		var_export( $expected, true ),
		var_export( $actual, true )
	);
}

/**
 * @param array<string, mixed> $overrides Nadpisania pol.
 *
 * @return array<string, mixed>
 */
function ev( array $overrides = array() ): array {
	return array_merge(
		array(
			'id'        => 7,
			'title'     => 'Dzień Kuchni Polskiej',
			'body'      => '',
			'badge'     => '',
			'date_from' => null,
			'date_to'   => null,
			'weekdays'  => array(),
			'meals'     => array(),
			'diets'     => array(),
			'placement' => 'after',
			'priority'  => 0,
		),
		$overrides
	);
}

/**
 * @param array[] $events Wydarzenia.
 */
function build( array $events ): string {
	return IcsBuilder::build(
		$events,
		array(
			'name'    => 'Wydarzenia Kuchni Vikinga',
			'host'    => 'kuchniavikinga.pl',
			'dtstamp' => '20260901T080000Z',
		)
	);
}

/**
 * Rozwija zawijanie linii, zeby dalo sie sprawdzic pelne wartosci.
 *
 * @return string[]
 */
function unfolded_lines( string $ics ): array {
	return explode( "\r\n", str_replace( "\r\n ", '', $ics ) );
}

// --- szkielet kalendarza -------------------------------------------------
$ics = build( array( ev( array( 'date_from' => '2026-09-15', 'date_to' => '2026-09-15' ) ) ) );

ok( str_starts_with( $ics, "BEGIN:VCALENDAR\r\n" ), 'kalendarz zaczyna sie od BEGIN:VCALENDAR' );
ok( str_ends_with( $ics, "END:VCALENDAR\r\n" ), 'kalendarz konczy sie na END:VCALENDAR' );
ok( str_contains( $ics, "VERSION:2.0\r\n" ), 'jest wersja 2.0' );
ok( ! str_contains( str_replace( "\r\n", '', $ics ), "\n" ), 'linie lamane wylacznie przez CRLF' );
same( 1, substr_count( $ics, 'BEGIN:VEVENT' ), 'jedno wydarzenie daje jeden VEVENT' );

$lines = unfolded_lines( $ics );

ok( in_array( 'UID:kv-wydarzenie-7@kuchniavikinga.pl', $lines, true ), 'UID zawiera ID i domene' );
ok( in_array( 'DTSTAMP:20260901T080000Z', $lines, true ), 'DTSTAMP z opcji' );
ok( in_array( 'SUMMARY:Dzień Kuchni Polskiej', $lines, true ), 'SUMMARY to tytul wydarzenia' );

// --- wydarzenie jednodniowe ---------------------------------------------
ok( in_array( 'DTSTART;VALUE=DATE:20260915', $lines, true ), 'DTSTART na dzien wydarzenia' );
ok( in_array( 'DTEND;VALUE=DATE:20260916', $lines, true ), 'DTEND jest wylaczne, czyli dzien pozniej' );

// --- zakres dat ----------------------------------------------------------
$range = unfolded_lines( build( array( ev( array( 'date_from' => '2026-09-01', 'date_to' => '2026-09-03' ) ) ) ) );

ok( in_array( 'DTSTART;VALUE=DATE:20260901', $range, true ), 'zakres: DTSTART na pierwszym dniu' );
ok( in_array( 'DTEND;VALUE=DATE:20260904', $range, true ), 'zakres: DTEND doba po ostatnim dniu' );

// --- brak daty konca -----------------------------------------------------
$open = unfolded_lines( build( array( ev( array( 'date_from' => '2026-09-10' ) ) ) ) );

ok( in_array( 'DTEND;VALUE=DATE:20260911', $open, true ), 'bez daty konca wychodzi jeden dzien' );

// --- wydarzenie bez dat jest pomijane ------------------------------------
$dateless = build( array( ev() ) );

same( 0, substr_count( $dateless, 'BEGIN:VEVENT' ), 'wydarzenie bez dat nie trafia do kalendarza' );
ok( str_contains( $dateless, 'END:VCALENDAR' ), 'pusty kalendarz nadal jest poprawny' );

// --- powtarzalne w wybrane dni tygodnia ----------------------------------
// 2026-09-01 to wtorek; pierwszy weekend wypada 5 wrzesnia (sobota).
$weekly = unfolded_lines(
	build(
		array(
			ev(
				array(
					'date_from' => '2026-09-01',
					'date_to'   => '2026-09-30',
					'weekdays'  => array( 6, 7 ),
				)
			),
		)
	)
);

ok( in_array( 'DTSTART;VALUE=DATE:20260905', $weekly, true ), 'powtarzalne startuje w pierwszy pasujacy dzien' );
ok( in_array( 'DTEND;VALUE=DATE:20260906', $weekly, true ), 'powtarzalne trwa jeden dzien' );
ok( in_array( 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU;UNTIL=20260930', $weekly, true ), 'RRULE z dniami i data konca' );

$weekly_open = unfolded_lines( build( array( ev( array( 'date_from' => '2026-09-01', 'weekdays' => array( 1 ) ) ) ) ) );

ok( in_array( 'RRULE:FREQ=WEEKLY;BYDAY=MO', $weekly_open, true ), 'bez daty konca RRULE nie ma UNTIL' );
ok( in_array( 'DTSTART;VALUE=DATE:20260907', $weekly_open, true ), 'pierwszy poniedzialek po 1 wrzesnia to 7 wrzesnia' );

// Zakres krotszy niz odstep do wybranego dnia - nic nie wypada.
$impossible = build(
	array( ev( array( 'date_from' => '2026-09-01', 'date_to' => '2026-09-02', 'weekdays' => array( 6 ) ) ) )
);

same( 0, substr_count( $impossible, 'BEGIN:VEVENT' ), 'gdy zaden dzien nie wypada, wydarzenia nie ma' );

// --- etykieta, opis, kategorie -------------------------------------------
$rich = unfolded_lines(
	build(
		array(
			ev(
				array(
					'badge'     => '🇵🇱',
					'body'      => '<p>Dziś obiad<br>z pomysłem.</p>',
					'meals'     => array( 'obiad' ),
					'diets'     => array( 'smart' ),
					'date_from' => '2026-09-15',
					'date_to'   => '2026-09-15',
				)
			),
		)
	)
);

ok( in_array( 'SUMMARY:🇵🇱 Dzień Kuchni Polskiej', $rich, true ), 'etykieta trafia przed tytul' );
ok( in_array( 'CATEGORIES:obiad', $rich, true ), 'posilki jako kategorie' );

$description = '';

foreach ( $rich as $line ) {
	if ( str_starts_with( $line, 'DESCRIPTION:' ) ) {
		$description = $line;
	}
}

ok( str_contains( $description, 'Dziś obiad\nz pomysłem.' ), 'HTML zamieniony na tekst, nowa linia zescapowana' );
ok( str_contains( $description, 'Posiłki: obiad' ), 'opis mowi, ktorych posilkow dotyczy' );
ok( str_contains( $description, 'Diety: smart' ), 'opis mowi, ktorych diet dotyczy' );

// --- escapowanie ---------------------------------------------------------
same( 'a\\,b', IcsBuilder::escape( 'a,b' ), 'przecinek escapowany' );
same( 'a\;b', IcsBuilder::escape( 'a;b' ), 'srednik escapowany' );
same( 'a\\\\b', IcsBuilder::escape( 'a\\b' ), 'backslash escapowany' );
same( 'a\\nb', IcsBuilder::escape( "a\nb" ), 'nowa linia escapowana' );
same( 'a\\nb', IcsBuilder::escape( "a\r\nb" ), 'CRLF tez escapowany' );

// --- zawijanie linii -----------------------------------------------------
$long   = 'SUMMARY:' . str_repeat( 'zażółć gęślą jaźń ', 12 );
$folded = IcsBuilder::fold( $long );

foreach ( explode( "\r\n", $folded ) as $index => $line ) {
	ok( strlen( $line ) <= 75, sprintf( 'zawinieta linia %d nie przekracza 75 oktetow', $index ) );

	if ( $index > 0 ) {
		ok( str_starts_with( $line, ' ' ), sprintf( 'kontynuacja %d zaczyna sie spacja', $index ) );
	}
}

same( $long, str_replace( "\r\n ", '', $folded ), 'rozwiniecie zawijania daje oryginal' );
ok( null !== json_encode( $folded ), 'zawijanie nie rozbija znakow wielobajtowych' );
same( 'krotka', IcsBuilder::fold( 'krotka' ), 'krotka linia zostaje bez zmian' );

// --- kolejnosc i liczba wydarzen ----------------------------------------
$many = build(
	array(
		ev( array( 'id' => 1, 'date_from' => '2026-09-01', 'date_to' => '2026-09-01' ) ),
		ev( array( 'id' => 2, 'date_from' => '2026-09-02', 'date_to' => '2026-09-02' ) ),
		ev( array( 'id' => 3 ) ),
	)
);

same( 2, substr_count( $many, 'BEGIN:VEVENT' ), 'do kalendarza trafiaja tylko wydarzenia z datami' );
same( substr_count( $many, 'BEGIN:VEVENT' ), substr_count( $many, 'END:VEVENT' ), 'kazdy VEVENT jest domkniety' );

if ( array() === $failures ) {
	printf( "OK - %d asercji przeszlo\n", $passed );
	exit( 0 );
}

printf( "FAIL - %d przeszlo, %d nie przeszlo\n", $passed, count( $failures ) );

foreach ( $failures as $failure ) {
	printf( "  - %s\n", $failure );
}

exit( 1 );
