<?php
/**
 * Automatyczne doklejanie wydarzen do opisow posilkow.
 *
 * Dwa tryby, bo nie kazdy motyw da sie ruszyc:
 *
 * 1. 'filter' - motyw wola apply_filters( 'kv_meal_description', $opis, $data, $posilek, $dieta ).
 *               Jedna linia w szablonie, renderowanie po stronie serwera, dziala w cache'u strony.
 * 2. 'js'     - nic nie ruszamy w motywie. Skrypt na froncie znajduje bloki posilkow
 *               po selektorze CSS, czyta date z atrybutu i dokleja wydarzenia z REST API.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Injector {

	public function register(): void {
		add_action( 'init', array( $this, 'hook_theme_filter' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend' ) );
	}

	/**
	 * Podpina sie pod hook wolany przez motyw (tryb 'filter').
	 */
	public function hook_theme_filter(): void {
		if ( 'filter' !== Settings::get( 'mode' ) ) {
			return;
		}

		$hook = (string) Settings::get( 'filter_hook' );

		if ( '' === $hook ) {
			return;
		}

		add_filter( $hook, array( $this, 'filter_meal_description' ), 10, 4 );
	}

	/**
	 * Callback filtra: dostaje opis posilku, oddaje opis z wydarzeniami.
	 *
	 * @param mixed       $description Opis posilku z motywu.
	 * @param mixed       $date        Data - 'Y-m-d' albo cokolwiek, co da sie na nia zamienic.
	 * @param string|null $meal        Slug posilku.
	 * @param string|null $diet        Slug diety.
	 */
	public function filter_meal_description( $description, $date = '', $meal = null, $diet = null ): string {
		$description = is_scalar( $description ) ? (string) $description : '';
		$date        = self::to_date( $date );

		if ( null === $date ) {
			return $description;
		}

		return Renderer::decorate(
			$description,
			$date,
			is_string( $meal ) && '' !== $meal ? EventMatcher::normalize_slug( $meal ) : null,
			is_string( $diet ) && '' !== $diet ? EventMatcher::normalize_slug( $diet ) : null
		);
	}

	/**
	 * Skrypt i style frontu. Style ladujemy zawsze (tryb 'filter' tez ich potrzebuje),
	 * skrypt tylko w trybie 'js'.
	 */
	public function enqueue_frontend(): void {
		$settings = Settings::all();

		if ( 'off' === $settings['mode'] ) {
			return;
		}

		$base = plugin_dir_url( PLUGIN_FILE );

		wp_enqueue_style( 'kv-wydarzenia', $base . 'assets/frontend.css', array(), VERSION );

		if ( 'js' !== $settings['mode'] || ! $this->should_load_js( $settings ) ) {
			return;
		}

		wp_enqueue_script( 'kv-wydarzenia', $base . 'assets/frontend.js', array(), VERSION, true );

		wp_localize_script(
			'kv-wydarzenia',
			'kvWydarzenia',
			array(
				'endpoint'     => esc_url_raw( rest_url( RestController::REST_NAMESPACE . '/render' ) ),
				'selector'     => $settings['js_selector'],
				'dateAttr'     => $settings['js_date_attr'],
				'mealAttr'     => $settings['js_meal_attr'],
				'dietAttr'     => $settings['js_diet_attr'],
			)
		);
	}

	/**
	 * Ograniczenie skryptu do wybranych stron (pusto = wszedzie).
	 *
	 * @param array<string, mixed> $settings Ustawienia wtyczki.
	 */
	private function should_load_js( array $settings ): bool {
		$pages = EventMatcher::normalize_slug_list( $settings['js_pages'] ?? array() );

		if ( array() === $pages ) {
			return true;
		}

		$post = get_post();

		if ( ! $post instanceof \WP_Post ) {
			return false;
		}

		return in_array( EventMatcher::normalize_slug( (string) $post->post_name ), $pages, true );
	}

	/**
	 * Przyjmuje 'Y-m-d', timestamp, DateTimeInterface albo cokolwiek dla strtotime().
	 *
	 * @param mixed $value Surowa data.
	 */
	public static function to_date( $value ): ?string {
		if ( $value instanceof \DateTimeInterface ) {
			return $value->format( 'Y-m-d' );
		}

		if ( is_int( $value ) ) {
			return (string) wp_date( 'Y-m-d', $value );
		}

		if ( ! is_string( $value ) ) {
			return null;
		}

		$value = trim( $value );

		if ( '' === $value ) {
			return null;
		}

		$normalized = EventMatcher::normalize_date( $value );

		if ( null !== $normalized ) {
			return $normalized;
		}

		$timestamp = strtotime( $value );

		return false === $timestamp ? null : (string) wp_date( 'Y-m-d', $timestamp );
	}
}
