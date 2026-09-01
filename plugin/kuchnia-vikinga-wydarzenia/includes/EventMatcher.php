<?php
/**
 * Czysta logika dopasowania wydarzenia do dnia / posilku / diety.
 * Celowo bez zadnych zaleznosci od WordPressa - dzieki temu da sie ja
 * przetestowac zwyklym PHP CLI (patrz tests/EventMatcherTest.php).
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) && PHP_SAPI !== 'cli' ) {
	exit;
}

/**
 * Znormalizowana tablica wydarzenia (klucze uzywane w calej wtyczce):
 *
 * id         int     ID wpisu
 * title      string  tytul wydarzenia
 * body       string  tresc doklejana do opisu posilku
 * badge      string  krotka etykieta / emoji przy tytule
 * date_from  ?string 'Y-m-d' lub null = od zawsze
 * date_to    ?string 'Y-m-d' lub null = bez konca
 * weekdays   int[]   1=pon ... 7=nd; pusta tablica = wszystkie dni
 * meals      string[] slugi posilkow; pusta tablica = wszystkie posilki
 * diets      string[] slugi diet; pusta tablica = wszystkie diety
 * placement  string  'before' | 'after'
 * priority   int     wieksza liczba = wyzej na liscie
 */
final class EventMatcher {

	public const PLACEMENT_BEFORE = 'before';
	public const PLACEMENT_AFTER  = 'after';

	/**
	 * Czy wydarzenie obowiazuje w danym dniu (i opcjonalnie dla danego posilku/diety).
	 *
	 * @param array       $event Znormalizowane wydarzenie.
	 * @param string      $date  Data w formacie 'Y-m-d'.
	 * @param string|null $meal  Slug posilku albo null = pytamy o caly dzien.
	 * @param string|null $diet  Slug diety albo null = pytamy o wszystkie diety.
	 */
	public static function matches( array $event, string $date, ?string $meal = null, ?string $diet = null ): bool {
		if ( ! self::is_valid_date( $date ) ) {
			return false;
		}

		$from = self::normalize_date( $event['date_from'] ?? null );
		$to   = self::normalize_date( $event['date_to'] ?? null );

		if ( null !== $from && $date < $from ) {
			return false;
		}

		if ( null !== $to && $date > $to ) {
			return false;
		}

		$weekdays = self::normalize_int_list( $event['weekdays'] ?? array() );

		if ( array() !== $weekdays && ! in_array( self::weekday( $date ), $weekdays, true ) ) {
			return false;
		}

		if ( ! self::matches_slug_list( $event['meals'] ?? array(), $meal ) ) {
			return false;
		}

		if ( ! self::matches_slug_list( $event['diets'] ?? array(), $diet ) ) {
			return false;
		}

		return true;
	}

	/**
	 * Filtruje liste wydarzen do tych obowiazujacych w danym dniu i sortuje je.
	 *
	 * @param array[] $events Lista znormalizowanych wydarzen.
	 *
	 * @return array[]
	 */
	public static function filter( array $events, string $date, ?string $meal = null, ?string $diet = null ): array {
		$matched = array_values(
			array_filter(
				$events,
				static fn( $event ) => is_array( $event ) && self::matches( $event, $date, $meal, $diet )
			)
		);

		return self::sort( $matched );
	}

	/**
	 * Sortowanie: priorytet malejaco, potem data startu rosnaco, potem ID rosnaco.
	 *
	 * @param array[] $events Lista znormalizowanych wydarzen.
	 *
	 * @return array[]
	 */
	public static function sort( array $events ): array {
		usort(
			$events,
			static function ( array $a, array $b ): int {
				$by_priority = ( (int) ( $b['priority'] ?? 0 ) ) <=> ( (int) ( $a['priority'] ?? 0 ) );

				if ( 0 !== $by_priority ) {
					return $by_priority;
				}

				// Wydarzenia bez daty startu traktujemy jako "od zawsze".
				$a_from = self::normalize_date( $a['date_from'] ?? null ) ?? '0000-00-00';
				$b_from = self::normalize_date( $b['date_from'] ?? null ) ?? '0000-00-00';

				$by_date = strcmp( $a_from, $b_from );

				if ( 0 !== $by_date ) {
					return $by_date;
				}

				return ( (int) ( $a['id'] ?? 0 ) ) <=> ( (int) ( $b['id'] ?? 0 ) );
			}
		);

		return $events;
	}

	/**
	 * Dzieli dopasowane wydarzenia na te przed i po opisie posilku.
	 *
	 * @param array[] $events Lista znormalizowanych wydarzen.
	 *
	 * @return array{before: array[], after: array[]}
	 */
	public static function split_by_placement( array $events ): array {
		$before = array();
		$after  = array();

		foreach ( $events as $event ) {
			if ( self::PLACEMENT_BEFORE === ( $event['placement'] ?? self::PLACEMENT_AFTER ) ) {
				$before[] = $event;
				continue;
			}

			$after[] = $event;
		}

		return array(
			'before' => $before,
			'after'  => $after,
		);
	}

	/**
	 * Pusta lista slugow = "dotyczy wszystkiego". Null po stronie zapytania =
	 * "pytam o caly dzien", wiec tez pasuje.
	 *
	 * @param mixed $list Lista slugow z wydarzenia.
	 */
	private static function matches_slug_list( $list, ?string $needle ): bool {
		$list = self::normalize_slug_list( $list );

		if ( array() === $list || null === $needle ) {
			return true;
		}

		return in_array( self::normalize_slug( $needle ), $list, true );
	}

	/**
	 * @param mixed $list Surowa lista slugow.
	 *
	 * @return string[]
	 */
	public static function normalize_slug_list( $list ): array {
		if ( is_string( $list ) ) {
			$list = preg_split( '/[,\r\n]+/', $list ) ?: array();
		}

		if ( ! is_array( $list ) ) {
			return array();
		}

		$slugs = array();

		foreach ( $list as $item ) {
			if ( ! is_scalar( $item ) ) {
				continue;
			}

			$slug = self::normalize_slug( (string) $item );

			// '*' jest synonimem "wszystkie" - czyli pustej listy.
			if ( '' === $slug || '*' === $slug ) {
				continue;
			}

			$slugs[ $slug ] = true;
		}

		return array_keys( $slugs );
	}

	public static function normalize_slug( string $value ): string {
		$value = trim( mb_strtolower( $value, 'UTF-8' ) );

		$map = array(
			'ą' => 'a',
			'ć' => 'c',
			'ę' => 'e',
			'ł' => 'l',
			'ń' => 'n',
			'ó' => 'o',
			'ś' => 's',
			'ź' => 'z',
			'ż' => 'z',
		);

		$value = strtr( $value, $map );
		$value = preg_replace( '/[^a-z0-9]+/', '-', $value ) ?? '';

		return trim( $value, '-' );
	}

	/**
	 * @param mixed $list Surowa lista dni tygodnia.
	 *
	 * @return int[]
	 */
	public static function normalize_int_list( $list ): array {
		if ( is_string( $list ) ) {
			$list = preg_split( '/[^0-9]+/', $list ) ?: array();
		}

		if ( ! is_array( $list ) ) {
			return array();
		}

		$out = array();

		foreach ( $list as $item ) {
			if ( ! is_numeric( $item ) ) {
				continue;
			}

			$day = (int) $item;

			if ( $day >= 1 && $day <= 7 ) {
				$out[ $day ] = true;
			}
		}

		$days = array_keys( $out );
		sort( $days );

		return $days;
	}

	/**
	 * @param mixed $value Surowa data.
	 */
	public static function normalize_date( $value ): ?string {
		if ( ! is_string( $value ) ) {
			return null;
		}

		$value = trim( $value );

		if ( '' === $value ) {
			return null;
		}

		return self::is_valid_date( $value ) ? $value : null;
	}

	public static function is_valid_date( string $date ): bool {
		if ( 1 !== preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m ) ) {
			return false;
		}

		return checkdate( (int) $m[2], (int) $m[3], (int) $m[1] );
	}

	/**
	 * Dzien tygodnia wg ISO: 1 = poniedzialek ... 7 = niedziela.
	 */
	public static function weekday( string $date ): int {
		return (int) ( new \DateTimeImmutable( $date . ' 00:00:00', new \DateTimeZone( 'UTC' ) ) )->format( 'N' );
	}
}
