<?php
/**
 * Plugin Name:       Kuchnia Vikinga - Wydarzenia
 * Plugin URI:        https://github.com/hkts7cjgms-svg/viking
 * Description:       Wydarzenia przypisane do dni kalendarza, doklejane automatycznie do opisow posilkow w jadlospisie. Pelny CRUD w panelu + REST API dla agentow.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.0
 * Author:            Kuchnia Vikinga
 * License:           GPL-2.0-or-later
 * Text Domain:       kv-wydarzenia
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const VERSION     = '1.0.0';
const PLUGIN_FILE = __FILE__;

/**
 * Prosty autoloader - jedna klasa na plik w katalogu includes/.
 */
spl_autoload_register(
	static function ( string $class_name ): void {
		$prefix = __NAMESPACE__ . '\\';

		if ( ! str_starts_with( $class_name, $prefix ) ) {
			return;
		}

		$relative = substr( $class_name, strlen( $prefix ) );
		$path     = __DIR__ . '/includes/' . str_replace( '\\', '/', $relative ) . '.php';

		if ( is_readable( $path ) ) {
			require_once $path;
		}
	}
);

require_once __DIR__ . '/includes/functions.php';

/**
 * Instancja wtyczki.
 */
function plugin(): Plugin {
	static $instance = null;

	if ( null === $instance ) {
		$instance = new Plugin();
	}

	return $instance;
}

plugin()->register();

register_activation_hook(
	__FILE__,
	static function (): void {
		EventPostType::register_post_type();
		flush_rewrite_rules();
	}
);

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
