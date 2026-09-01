<?php
/**
 * Kolumny na liscie wydarzen + filtr "obowiazuje dnia".
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class AdminColumns {

	public function register(): void {
		add_filter( 'manage_' . EventPostType::POST_TYPE . '_posts_columns', array( $this, 'columns' ) );
		add_action( 'manage_' . EventPostType::POST_TYPE . '_posts_custom_column', array( $this, 'column' ), 10, 2 );
		add_action( 'restrict_manage_posts', array( $this, 'day_filter' ) );
		add_action( 'pre_get_posts', array( $this, 'apply_day_filter' ) );
	}

	/**
	 * @param array<string, string> $columns Kolumny listy.
	 *
	 * @return array<string, string>
	 */
	public function columns( array $columns ): array {
		$date = $columns['date'] ?? '';
		unset( $columns['date'] );

		$columns['kv_range']    = __( 'Termin', 'kv-wydarzenia' );
		$columns['kv_meals']    = __( 'Posiłki', 'kv-wydarzenia' );
		$columns['kv_diets']    = __( 'Diety', 'kv-wydarzenia' );
		$columns['kv_priority'] = __( 'Priorytet', 'kv-wydarzenia' );

		if ( '' !== $date ) {
			$columns['date'] = $date;
		}

		return $columns;
	}

	public function column( string $column, int $post_id ): void {
		$event = Repository::find( $post_id );

		if ( null === $event ) {
			return;
		}

		switch ( $column ) {
			case 'kv_range':
				echo esc_html( $this->format_range( $event ) );
				break;

			case 'kv_meals':
				echo esc_html( $this->format_slugs( $event['meals'], __( 'wszystkie', 'kv-wydarzenia' ) ) );
				break;

			case 'kv_diets':
				echo esc_html( $this->format_slugs( $event['diets'], __( 'wszystkie', 'kv-wydarzenia' ) ) );
				break;

			case 'kv_priority':
				echo esc_html( (string) $event['priority'] );
				break;
		}
	}

	/**
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 */
	private function format_range( array $event ): string {
		$from = $event['date_from'] ?? null;
		$to   = $event['date_to'] ?? null;

		if ( null === $from && null === $to ) {
			$range = __( 'zawsze', 'kv-wydarzenia' );
		} elseif ( null === $to ) {
			/* translators: %s: data. */
			$range = sprintf( __( 'od %s', 'kv-wydarzenia' ), $from );
		} elseif ( null === $from ) {
			/* translators: %s: data. */
			$range = sprintf( __( 'do %s', 'kv-wydarzenia' ), $to );
		} elseif ( $from === $to ) {
			$range = (string) $from;
		} else {
			$range = $from . ' – ' . $to;
		}

		$weekdays = (array) ( $event['weekdays'] ?? array() );

		if ( array() === $weekdays ) {
			return $range;
		}

		$names = array( 1 => 'pon', 2 => 'wt', 3 => 'śr', 4 => 'czw', 5 => 'pt', 6 => 'sob', 7 => 'nd' );
		$short = array_map( static fn( int $day ): string => $names[ $day ] ?? (string) $day, $weekdays );

		return $range . ' (' . implode( ', ', $short ) . ')';
	}

	/**
	 * @param mixed  $slugs    Lista slugow.
	 * @param string $fallback Tekst dla pustej listy.
	 */
	private function format_slugs( $slugs, string $fallback ): string {
		$slugs = (array) $slugs;

		if ( array() === $slugs ) {
			return $fallback;
		}

		return implode( ', ', array_map( array( Settings::class, 'label' ), $slugs ) );
	}

	/**
	 * Pole "obowiązuje dnia" nad lista wydarzen.
	 */
	public function day_filter( string $post_type ): void {
		if ( EventPostType::POST_TYPE !== $post_type ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- filtr listy, tylko odczyt.
		$value = isset( $_GET['kv_day'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['kv_day'] ) ) : '';

		printf(
			'<label class="screen-reader-text" for="kv_day">%s</label><input type="date" id="kv_day" name="kv_day" value="%s">',
			esc_html__( 'Obowiązuje dnia', 'kv-wydarzenia' ),
			esc_attr( $value )
		);
	}

	/**
	 * Filtrowanie po dniu robimy w PHP (na ID), bo warunek "pusta data = zawsze"
	 * jest nie do wyrazenia sensownym meta_query.
	 */
	public function apply_day_filter( \WP_Query $query ): void {
		if ( ! is_admin() || ! $query->is_main_query() ) {
			return;
		}

		if ( EventPostType::POST_TYPE !== $query->get( 'post_type' ) ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- filtr listy, tylko odczyt.
		$day = isset( $_GET['kv_day'] ) ? sanitize_text_field( wp_unslash( (string) $_GET['kv_day'] ) ) : '';
		$day = EventMatcher::normalize_date( $day );

		if ( null === $day ) {
			return;
		}

		$ids = array_column( Repository::for_day( $day ), 'id' );

		// Pusta tablica w post__in zostalaby zignorowana, wiec dajemy niemozliwe ID.
		$query->set( 'post__in', array() === $ids ? array( 0 ) : $ids );
	}
}
