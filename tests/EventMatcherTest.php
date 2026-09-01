<?php
/**
 * Testy czystej logiki dopasowania. Uruchomienie: php tests/EventMatcherTest.php
 */

declare( strict_types = 1 );

require __DIR__ . '/../plugin/kuchnia-vikinga-wydarzenia/includes/EventMatcher.php';

use KuchniaVikinga\Wydarzenia\EventMatcher;

final class TestRunner {

	private int $passed = 0;

	/** @var string[] */
	private array $failures = array();

	public function ok( bool $condition, string $label ): void {
		if ( $condition ) {
			++$this->passed;
			return;
		}

		$this->failures[] = $label;
	}

	/**
	 * @param mixed $expected Oczekiwana wartosc.
	 * @param mixed $actual   Otrzymana wartosc.
	 */
	public function same( $expected, $actual, string $label ): void {
		if ( $expected === $actual ) {
			++$this->passed;
			return;
		}

		$this->failures[] = sprintf(
			"%s\n    oczekiwano: %s\n    otrzymano:  %s",
			$label,
			var_export( $expected, true ),
			var_export( $actual, true )
		);
	}

	public function summary(): int {
		if ( array() === $this->failures ) {
			printf( "OK - %d asercji przeszlo\n", $this->passed );
			return 0;
		}

		printf( "FAIL - %d przeszlo, %d nie przeszlo\n", $this->passed, count( $this->failures ) );

		foreach ( $this->failures as $failure ) {
			printf( "  - %s\n", $failure );
		}

		return 1;
	}
}

/**
 * @param array<string, mixed> $overrides Nadpisania pol wydarzenia.
 *
 * @return array<string, mixed>
 */
function event( array $overrides = array() ): array {
	return array_merge(
		array(
			'id'        => 1,
			'title'     => 'Wydarzenie',
			'body'      => 'Tresc',
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

$t = new TestRunner();

// --- zakres dat ---------------------------------------------------------
$range = event(
	array(
		'date_from' => '2026-09-01',
		'date_to'   => '2026-09-03',
	)
);

$t->ok( EventMatcher::matches( $range, '2026-09-01' ), 'pierwszy dzien zakresu jest wlaczony' );
$t->ok( EventMatcher::matches( $range, '2026-09-02' ), 'srodek zakresu pasuje' );
$t->ok( EventMatcher::matches( $range, '2026-09-03' ), 'ostatni dzien zakresu jest wlaczony' );
$t->ok( ! EventMatcher::matches( $range, '2026-08-31' ), 'dzien przed zakresem nie pasuje' );
$t->ok( ! EventMatcher::matches( $range, '2026-09-04' ), 'dzien po zakresie nie pasuje' );

$open_start = event( array( 'date_to' => '2026-09-03' ) );
$t->ok( EventMatcher::matches( $open_start, '2020-01-01' ), 'brak daty od = od zawsze' );
$t->ok( ! EventMatcher::matches( $open_start, '2026-09-04' ), 'brak daty od nadal respektuje date do' );

$open_end = event( array( 'date_from' => '2026-09-03' ) );
$t->ok( EventMatcher::matches( $open_end, '2030-01-01' ), 'brak daty do = bez konca' );
$t->ok( ! EventMatcher::matches( $open_end, '2026-09-02' ), 'brak daty do nadal respektuje date od' );

$t->ok( EventMatcher::matches( event(), '2026-09-01' ), 'wydarzenie bez dat pasuje zawsze' );
$t->ok( ! EventMatcher::matches( event(), '2026-02-30' ), 'niepoprawna data nie pasuje' );
$t->ok( ! EventMatcher::matches( event(), '01-09-2026' ), 'zly format daty nie pasuje' );

// --- dni tygodnia -------------------------------------------------------
// 2026-09-01 to wtorek (2), 2026-09-05 to sobota (6).
$t->same( 2, EventMatcher::weekday( '2026-09-01' ), '2026-09-01 to wtorek' );
$t->same( 6, EventMatcher::weekday( '2026-09-05' ), '2026-09-05 to sobota' );

$weekend = event( array( 'weekdays' => array( 6, 7 ) ) );
$t->ok( EventMatcher::matches( $weekend, '2026-09-05' ), 'sobota pasuje do filtra weekendowego' );
$t->ok( ! EventMatcher::matches( $weekend, '2026-09-01' ), 'wtorek nie pasuje do filtra weekendowego' );

// --- posilki ------------------------------------------------------------
$lunch = event( array( 'meals' => array( 'obiad' ) ) );
$t->ok( EventMatcher::matches( $lunch, '2026-09-01', 'obiad' ), 'obiad pasuje do wydarzenia obiadowego' );
$t->ok( ! EventMatcher::matches( $lunch, '2026-09-01', 'kolacja' ), 'kolacja nie pasuje do wydarzenia obiadowego' );
$t->ok( EventMatcher::matches( $lunch, '2026-09-01' ), 'zapytanie o caly dzien pasuje mimo filtra posilku' );
$t->ok( EventMatcher::matches( event(), '2026-09-01', 'kolacja' ), 'pusta lista posilkow = wszystkie posilki' );
$t->ok( EventMatcher::matches( event( array( 'meals' => array( '*' ) ) ), '2026-09-01', 'kolacja' ), 'gwiazdka = wszystkie posilki' );

// Slugi z polskimi znakami i spacjami maja pasowac do znormalizowanej formy.
$second_breakfast = event( array( 'meals' => array( 'II Śniadanie' ) ) );
$t->ok( EventMatcher::matches( $second_breakfast, '2026-09-01', 'ii-sniadanie' ), 'slug posilku jest normalizowany' );

// --- diety --------------------------------------------------------------
$keto = event( array( 'diets' => array( 'keto' ) ) );
$t->ok( EventMatcher::matches( $keto, '2026-09-01', null, 'keto' ), 'dieta keto pasuje' );
$t->ok( ! EventMatcher::matches( $keto, '2026-09-01', null, 'wegetarianska' ), 'inna dieta nie pasuje' );

// --- normalizacja -------------------------------------------------------
$t->same( array( 'obiad', 'kolacja' ), EventMatcher::normalize_slug_list( 'obiad, kolacja' ), 'lista slugow z przecinkow' );
$t->same( array( 'obiad' ), EventMatcher::normalize_slug_list( array( 'Obiad', 'obiad', '', '*' ) ), 'duplikaty i gwiazdka odpadaja' );
$t->same( 'ii-sniadanie', EventMatcher::normalize_slug( 'II śniadanie' ), 'polskie znaki i spacje w slugu' );
$t->same( array( 1, 5 ), EventMatcher::normalize_int_list( array( '5', 1, 9, 0, 'x' ) ), 'dni tygodnia poza 1-7 odpadaja' );
$t->same( null, EventMatcher::normalize_date( '  ' ), 'pusta data to null' );
$t->same( '2026-09-01', EventMatcher::normalize_date( ' 2026-09-01 ' ), 'data jest przycinana' );

// --- filtrowanie i sortowanie ------------------------------------------
$events = array(
	event(
		array(
			'id'        => 10,
			'title'     => 'Niski priorytet',
			'priority'  => 0,
			'date_from' => '2026-09-01',
		)
	),
	event(
		array(
			'id'        => 11,
			'title'     => 'Wysoki priorytet',
			'priority'  => 10,
			'date_from' => '2026-09-01',
		)
	),
	event(
		array(
			'id'        => 12,
			'title'     => 'Poza zakresem',
			'date_from' => '2026-10-01',
		)
	),
	event(
		array(
			'id'        => 13,
			'title'     => 'Ten sam priorytet, wczesniejsza data',
			'priority'  => 10,
			'date_from' => '2026-08-01',
		)
	),
);

$filtered = EventMatcher::filter( $events, '2026-09-01' );
$t->same( array( 13, 11, 10 ), array_column( $filtered, 'id' ), 'filtr + sortowanie po priorytecie i dacie' );

$split = EventMatcher::split_by_placement(
	array(
		event( array( 'id' => 1, 'placement' => 'after' ) ),
		event( array( 'id' => 2, 'placement' => 'before' ) ),
	)
);
$t->same( array( 2 ), array_column( $split['before'], 'id' ), 'podzial - przed opisem' );
$t->same( array( 1 ), array_column( $split['after'], 'id' ), 'podzial - po opisie' );

exit( $t->summary() );
