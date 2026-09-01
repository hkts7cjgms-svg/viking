<?php
/**
 * Spina wszystkie czesci wtyczki.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Plugin {

	public function register(): void {
		( new EventPostType() )->register();
		( new Repository() )->register();
		( new Settings() )->register();
		( new MetaBox() )->register();
		( new AdminColumns() )->register();
		( new Shortcode() )->register();
		( new Injector() )->register();
		( new RestController() )->register();

		add_action( 'init', array( $this, 'load_textdomain' ) );
	}

	public function load_textdomain(): void {
		load_plugin_textdomain( 'kv-wydarzenia', false, dirname( plugin_basename( PLUGIN_FILE ) ) . '/languages' );
	}
}

/**
 * Funkcja dla motywu: zwraca opis posilku z doklejonymi wydarzeniami.
 *
 * Uzycie w szablonie jadlospisu:
 *
 *     echo kv_opis_posilku( $opis, '2026-09-15', 'obiad', 'smart' );
 *
 * @param string      $description Oryginalny opis posilku.
 * @param string      $date        Data 'Y-m-d'.
 * @param string|null $meal        Slug posilku.
 * @param string|null $diet        Slug diety.
 */
function opis_posilku( string $description, string $date, ?string $meal = null, ?string $diet = null ): string {
	return Renderer::decorate( $description, $date, $meal, $diet );
}

/**
 * Funkcja dla motywu: sam HTML wydarzen danego dnia.
 *
 * @param string      $date Data 'Y-m-d'.
 * @param string|null $meal Slug posilku.
 * @param string|null $diet Slug diety.
 */
function wydarzenia_dnia( string $date, ?string $meal = null, ?string $diet = null ): string {
	return Renderer::render( Repository::for_day( $date, $meal, $diet ), $date, $meal );
}
