<?php
/**
 * Sprzatanie po odinstalowaniu wtyczki.
 *
 * Kasujemy ustawienia i cache. Same wydarzenia zostaja - to tresc,
 * a nie konfiguracja; usuniecie ich musi byc swiadoma decyzja w panelu.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'kv_wydarzenia_settings' );
delete_transient( 'kv_wydarzenia_index' );
