<?php
/**
 * Budowanie HTML-a wydarzen i doklejanie go do opisu posilku.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Renderer {

	/**
	 * Renderuje liste wydarzen. Pusta lista daje pusty string, nigdy pustego <div>.
	 *
	 * @param array[] $events Znormalizowane wydarzenia.
	 */
	public static function render( array $events, string $date = '', ?string $meal = null ): string {
		if ( array() === $events ) {
			return '';
		}

		$wrapper_class = (string) Settings::get( 'wrapper_class' );
		$template      = dirname( __DIR__ ) . '/templates/events.php';

		/**
		 * Podmiana szablonu listy wydarzen (np. na plik z motywu).
		 *
		 * @param string $template Sciezka do pliku szablonu.
		 */
		$template = (string) apply_filters( 'kv_wydarzenia_szablon', $template );

		if ( ! is_readable( $template ) ) {
			return '';
		}

		ob_start();

		require $template;

		return (string) ob_get_clean();
	}

	/**
	 * Zwraca opis posilku z doklejonymi wydarzeniami danego dnia.
	 *
	 * @param string      $description Oryginalny opis posilku (HTML).
	 * @param string      $date        Data 'Y-m-d'.
	 * @param string|null $meal        Slug posilku.
	 * @param string|null $diet        Slug diety.
	 */
	public static function decorate( string $description, string $date, ?string $meal = null, ?string $diet = null ): string {
		if ( ! EventMatcher::is_valid_date( $date ) ) {
			return $description;
		}

		$events = Repository::for_day( $date, $meal, $diet );

		if ( array() === $events ) {
			return $description;
		}

		$split = EventMatcher::split_by_placement( $events );

		return self::render( $split['before'], $date, $meal )
			. $description
			. self::render( $split['after'], $date, $meal );
	}

	/**
	 * Tresc pojedynczego wydarzenia - dopuszczamy podstawowy HTML z edytora.
	 *
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 */
	public static function body_html( array $event ): string {
		$body = (string) ( $event['body'] ?? '' );

		if ( '' === trim( $body ) ) {
			return '';
		}

		// wpautop odtwarza akapity z edytora, wp_kses_post ucina niebezpieczne tagi.
		return wp_kses_post( wpautop( $body ) );
	}
}
