<?php
/**
 * Odczyt wydarzen z bazy + cache.
 *
 * Wydarzen w cateringu sa dziesiatki, nie miliony, wiec czytamy caly indeks
 * raz na request i filtrujemy w PHP. Dzieki temu jeden dzien jadlospisu z
 * piecioma posilkami to jedno zapytanie do bazy, a nie piec.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Repository {

	private const TRANSIENT = 'kv_wydarzenia_index';

	/** @var array[]|null */
	private static ?array $memo = null;

	public function register(): void {
		foreach ( array( 'save_post_' . EventPostType::POST_TYPE, 'deleted_post', 'trashed_post', 'untrashed_post' ) as $hook ) {
			add_action( $hook, array( self::class, 'flush_cache' ) );
		}
	}

	/**
	 * Wszystkie opublikowane wydarzenia, znormalizowane i posortowane.
	 *
	 * @return array[]
	 */
	public static function all(): array {
		if ( null !== self::$memo ) {
			return self::$memo;
		}

		$cached = get_transient( self::TRANSIENT );

		if ( is_array( $cached ) ) {
			self::$memo = $cached;

			return self::$memo;
		}

		/**
		 * Gorny limit wydarzen trzymanych w indeksie.
		 *
		 * @param int $limit Domyslnie 500.
		 */
		$limit = (int) apply_filters( 'kv_wydarzenia_index_limit', 500 );

		$posts = get_posts(
			array(
				'post_type'              => EventPostType::POST_TYPE,
				'post_status'            => 'publish',
				'posts_per_page'         => $limit,
				'orderby'                => 'ID',
				'order'                  => 'ASC',
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				'suppress_filters'       => false,
			)
		);

		$events = array();

		foreach ( $posts as $post ) {
			$events[] = EventPostType::to_array( $post );
		}

		$events = EventMatcher::sort( $events );

		set_transient( self::TRANSIENT, $events, DAY_IN_SECONDS );
		self::$memo = $events;

		return $events;
	}

	/**
	 * Wydarzenia obowiazujace danego dnia (opcjonalnie dla posilku i diety).
	 *
	 * @return array[]
	 */
	public static function for_day( string $date, ?string $meal = null, ?string $diet = null ): array {
		$events = EventMatcher::filter( self::all(), $date, $meal, $diet );

		/**
		 * Ostatnie slowo w sprawie tego, co trafia na strone danego dnia.
		 *
		 * @param array[]     $events Dopasowane wydarzenia.
		 * @param string      $date   Data 'Y-m-d'.
		 * @param string|null $meal   Slug posilku.
		 * @param string|null $diet   Slug diety.
		 */
		return apply_filters( 'kv_wydarzenia_dla_dnia', $events, $date, $meal, $diet );
	}

	/**
	 * Wydarzenia w zakresie dat - do podgladu w panelu i w API.
	 *
	 * @return array<string, array[]> Mapa 'Y-m-d' => lista wydarzen.
	 */
	public static function for_range( string $from, string $to, ?string $meal = null, ?string $diet = null ): array {
		if ( ! EventMatcher::is_valid_date( $from ) || ! EventMatcher::is_valid_date( $to ) || $to < $from ) {
			return array();
		}

		$start  = new \DateTimeImmutable( $from . ' 00:00:00', new \DateTimeZone( 'UTC' ) );
		$end    = new \DateTimeImmutable( $to . ' 00:00:00', new \DateTimeZone( 'UTC' ) );
		$days   = (int) $start->diff( $end )->days;
		$result = array();

		// Bezpiecznik na wypadek zapytania o kilka lat naraz.
		$days = min( $days, 366 );

		for ( $i = 0; $i <= $days; $i++ ) {
			$date            = $start->modify( sprintf( '+%d days', $i ) )->format( 'Y-m-d' );
			$result[ $date ] = self::for_day( $date, $meal, $diet );
		}

		return $result;
	}

	/**
	 * Pojedyncze wydarzenie po ID - takze nieopublikowane (dla panelu i API).
	 *
	 * @return array<string, mixed>|null
	 */
	public static function find( int $id ): ?array {
		$post = get_post( $id );

		if ( ! $post instanceof \WP_Post || EventPostType::POST_TYPE !== $post->post_type ) {
			return null;
		}

		return EventPostType::to_array( $post );
	}

	public static function flush_cache(): void {
		self::$memo = null;
		delete_transient( self::TRANSIENT );
	}
}
