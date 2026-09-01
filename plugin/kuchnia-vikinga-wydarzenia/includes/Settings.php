<?php
/**
 * Ustawienia wtyczki (opcja w wp_options) + strona ustawien w panelu.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Settings {

	public const OPTION = 'kv_wydarzenia_settings';
	public const GROUP  = 'kv_wydarzenia_settings_group';

	/**
	 * Domyslne posilki dla cateringu pudelkowego.
	 *
	 * @return string[]
	 */
	public static function default_meals(): array {
		return array( 'sniadanie', 'ii-sniadanie', 'obiad', 'podwieczorek', 'kolacja' );
	}

	/**
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			// 'filter' = motyw wola apply_filters(), 'js' = wstrzykiwanie w przegladarce, 'off' = tylko shortcode.
			'mode'          => 'filter',
			'meals'         => self::default_meals(),
			'diets'         => array(),
			// Tryb 'filter': nazwa hooka, ktory wola motyw.
			'filter_hook'   => 'kv_meal_description',
			// Tryb 'js': selektor bloku posilku i atrybuty z data/posilkiem.
			'js_selector'   => '[data-kv-date]',
			'js_date_attr'  => 'data-kv-date',
			'js_meal_attr'  => 'data-kv-meal',
			'js_diet_attr'  => 'data-kv-diet',
			// Strony (slugi), na ktorych ladujemy skrypt trybu 'js'. Pusto = wszedzie.
			'js_pages'      => array(),
			'wrapper_class' => 'kv-wydarzenia',
		);
	}

	/**
	 * @return array<string, mixed>
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION, array() );

		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		return array_merge( self::defaults(), $stored );
	}

	/**
	 * @return mixed
	 */
	public static function get( string $key ) {
		$all = self::all();

		return $all[ $key ] ?? null;
	}

	/**
	 * Lista slugow posilkow uzywana w metaboksie i walidacji REST.
	 *
	 * @return string[]
	 */
	public static function meals(): array {
		$meals = EventMatcher::normalize_slug_list( self::get( 'meals' ) );

		return array() === $meals ? self::default_meals() : $meals;
	}

	/**
	 * @return string[]
	 */
	public static function diets(): array {
		return EventMatcher::normalize_slug_list( self::get( 'diets' ) );
	}

	/**
	 * Czytelna etykieta dla sluga posilku - 'ii-sniadanie' => 'II śniadanie'.
	 */
	public static function label( string $slug ): string {
		$known = array(
			'sniadanie'    => __( 'Śniadanie', 'kv-wydarzenia' ),
			'ii-sniadanie' => __( 'II śniadanie', 'kv-wydarzenia' ),
			'obiad'        => __( 'Obiad', 'kv-wydarzenia' ),
			'podwieczorek' => __( 'Podwieczorek', 'kv-wydarzenia' ),
			'kolacja'      => __( 'Kolacja', 'kv-wydarzenia' ),
		);

		if ( isset( $known[ $slug ] ) ) {
			return $known[ $slug ];
		}

		return ucfirst( str_replace( '-', ' ', $slug ) );
	}

	public function register(): void {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'register_page' ) );
	}

	public function register_settings(): void {
		register_setting(
			self::GROUP,
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize' ),
				'default'           => self::defaults(),
			)
		);
	}

	/**
	 * @param mixed $input Surowe dane z formularza.
	 *
	 * @return array<string, mixed>
	 */
	public function sanitize( $input ): array {
		if ( ! is_array( $input ) ) {
			return self::defaults();
		}

		$modes = array( 'filter', 'js', 'off' );
		$mode  = isset( $input['mode'] ) ? (string) $input['mode'] : 'filter';

		$meals = EventMatcher::normalize_slug_list( $input['meals'] ?? array() );

		return array(
			'mode'          => in_array( $mode, $modes, true ) ? $mode : 'filter',
			'meals'         => array() === $meals ? self::default_meals() : $meals,
			'diets'         => EventMatcher::normalize_slug_list( $input['diets'] ?? array() ),
			'filter_hook'   => $this->sanitize_hook_name( $input['filter_hook'] ?? '' ),
			'js_selector'   => $this->sanitize_text( $input['js_selector'] ?? '', '[data-kv-date]' ),
			'js_date_attr'  => $this->sanitize_attr_name( $input['js_date_attr'] ?? '', 'data-kv-date' ),
			'js_meal_attr'  => $this->sanitize_attr_name( $input['js_meal_attr'] ?? '', 'data-kv-meal' ),
			'js_diet_attr'  => $this->sanitize_attr_name( $input['js_diet_attr'] ?? '', 'data-kv-diet' ),
			'js_pages'      => EventMatcher::normalize_slug_list( $input['js_pages'] ?? array() ),
			'wrapper_class' => $this->sanitize_css_class( $input['wrapper_class'] ?? '', 'kv-wydarzenia' ),
		);
	}

	/**
	 * @param mixed $value Surowa wartosc.
	 */
	private function sanitize_hook_name( $value ): string {
		$value = is_scalar( $value ) ? (string) $value : '';
		$value = preg_replace( '/[^a-zA-Z0-9_\/]/', '', $value ) ?? '';

		return '' === $value ? 'kv_meal_description' : $value;
	}

	/**
	 * @param mixed $value Surowa wartosc.
	 */
	private function sanitize_attr_name( $value, string $fallback ): string {
		$value = is_scalar( $value ) ? (string) $value : '';
		$value = strtolower( preg_replace( '/[^a-zA-Z0-9_-]/', '', $value ) ?? '' );

		return '' === $value ? $fallback : $value;
	}

	/**
	 * @param mixed $value Surowa wartosc.
	 */
	private function sanitize_css_class( $value, string $fallback ): string {
		$value = is_scalar( $value ) ? sanitize_html_class( (string) $value ) : '';

		return '' === $value ? $fallback : $value;
	}

	/**
	 * @param mixed $value Surowa wartosc.
	 */
	private function sanitize_text( $value, string $fallback ): string {
		$value = is_scalar( $value ) ? sanitize_text_field( (string) $value ) : '';

		return '' === $value ? $fallback : $value;
	}

	public function register_page(): void {
		add_submenu_page(
			'edit.php?post_type=' . EventPostType::POST_TYPE,
			__( 'Ustawienia wydarzeń', 'kv-wydarzenia' ),
			__( 'Ustawienia', 'kv-wydarzenia' ),
			'manage_options',
			'kv-wydarzenia-ustawienia',
			array( $this, 'render_page' )
		);
	}

	public function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings = self::all();

		require dirname( __DIR__ ) . '/templates/settings-page.php';
	}
}
