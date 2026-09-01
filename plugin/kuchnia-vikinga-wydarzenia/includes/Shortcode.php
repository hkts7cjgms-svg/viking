<?php
/**
 * Shortcode [kv_wydarzenia] - reczne wstawienie listy wydarzen w dowolnym miejscu.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Shortcode {

	public const TAG = 'kv_wydarzenia';

	public function register(): void {
		add_shortcode( self::TAG, array( $this, 'render' ) );
	}

	/**
	 * Uzycie: [kv_wydarzenia data="2026-09-01" posilek="obiad" dieta="keto"]
	 * Bez atrybutu "data" bierzemy dzisiejsza date w strefie czasowej strony.
	 *
	 * @param array<string, string>|string $atts Atrybuty shortcode'a.
	 */
	public function render( $atts ): string {
		$atts = shortcode_atts(
			array(
				'data'    => '',
				'posilek' => '',
				'dieta'   => '',
			),
			is_array( $atts ) ? $atts : array(),
			self::TAG
		);

		$date = EventMatcher::normalize_date( $atts['data'] ) ?? self::today();
		$meal = '' === $atts['posilek'] ? null : EventMatcher::normalize_slug( $atts['posilek'] );
		$diet = '' === $atts['dieta'] ? null : EventMatcher::normalize_slug( $atts['dieta'] );

		return Renderer::render( Repository::for_day( $date, $meal, $diet ), $date, $meal );
	}

	/**
	 * Dzisiejsza data w strefie czasowej ustawionej w WordPressie.
	 */
	public static function today(): string {
		return (string) wp_date( 'Y-m-d' );
	}
}
