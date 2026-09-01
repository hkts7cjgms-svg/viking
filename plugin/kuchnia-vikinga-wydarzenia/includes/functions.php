<?php
/**
 * Aliasy w globalnej przestrzeni nazw - wygodne w plikach motywu.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! function_exists( 'kv_opis_posilku' ) ) {
	/**
	 * Opis posilku z doklejonymi wydarzeniami danego dnia.
	 *
	 * @param string      $description Oryginalny opis posilku.
	 * @param string      $date        Data 'Y-m-d'.
	 * @param string|null $meal        Slug posilku.
	 * @param string|null $diet        Slug diety.
	 */
	function kv_opis_posilku( string $description, string $date, ?string $meal = null, ?string $diet = null ): string {
		return \KuchniaVikinga\Wydarzenia\opis_posilku( $description, $date, $meal, $diet );
	}
}

if ( ! function_exists( 'kv_wydarzenia_dnia' ) ) {
	/**
	 * Sam HTML wydarzen danego dnia.
	 *
	 * @param string      $date Data 'Y-m-d'.
	 * @param string|null $meal Slug posilku.
	 * @param string|null $diet Slug diety.
	 */
	function kv_wydarzenia_dnia( string $date, ?string $meal = null, ?string $diet = null ): string {
		return \KuchniaVikinga\Wydarzenia\wydarzenia_dnia( $date, $meal, $diet );
	}
}
