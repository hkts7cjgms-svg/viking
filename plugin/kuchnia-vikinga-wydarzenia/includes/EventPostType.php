<?php
/**
 * Typ tresci "Wydarzenie" wraz z polami dodatkowymi.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class EventPostType {

	public const POST_TYPE = 'kv_event';

	public const META_DATE_FROM = '_kv_date_from';
	public const META_DATE_TO   = '_kv_date_to';
	public const META_WEEKDAYS  = '_kv_weekdays';
	public const META_MEALS     = '_kv_meals';
	public const META_DIETS     = '_kv_diets';
	public const META_PLACEMENT = '_kv_placement';
	public const META_PRIORITY  = '_kv_priority';
	public const META_BADGE     = '_kv_badge';

	public function register(): void {
		add_action( 'init', array( self::class, 'register_post_type' ) );
		add_action( 'init', array( self::class, 'register_meta' ) );

		// Klasyczny edytor - metaboksy z polami dat dzialaja wtedy bez kombinowania.
		add_filter(
			'use_block_editor_for_post_type',
			static function ( bool $use, string $post_type ): bool {
				return self::POST_TYPE === $post_type ? false : $use;
			},
			10,
			2
		);
	}

	public static function register_post_type(): void {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'          => array(
					'name'               => __( 'Wydarzenia', 'kv-wydarzenia' ),
					'singular_name'      => __( 'Wydarzenie', 'kv-wydarzenia' ),
					'add_new'            => __( 'Dodaj nowe', 'kv-wydarzenia' ),
					'add_new_item'       => __( 'Dodaj wydarzenie', 'kv-wydarzenia' ),
					'edit_item'          => __( 'Edytuj wydarzenie', 'kv-wydarzenia' ),
					'new_item'           => __( 'Nowe wydarzenie', 'kv-wydarzenia' ),
					'view_item'          => __( 'Zobacz wydarzenie', 'kv-wydarzenia' ),
					'search_items'       => __( 'Szukaj wydarzeń', 'kv-wydarzenia' ),
					'not_found'          => __( 'Brak wydarzeń', 'kv-wydarzenia' ),
					'not_found_in_trash' => __( 'Brak wydarzeń w koszu', 'kv-wydarzenia' ),
					'menu_name'          => __( 'Wydarzenia', 'kv-wydarzenia' ),
				),
				'public'          => false,
				'show_ui'         => true,
				'show_in_menu'    => true,
				'show_in_rest'    => true,
				'menu_icon'       => 'dashicons-calendar-alt',
				'menu_position'   => 26,
				'supports'        => array( 'title', 'editor', 'author', 'revisions' ),
				'has_archive'     => false,
				'rewrite'         => false,
				'capability_type' => 'post',
			)
		);
	}

	public static function register_meta(): void {
		$string_meta = array(
			self::META_DATE_FROM,
			self::META_DATE_TO,
			self::META_PLACEMENT,
			self::META_BADGE,
		);

		foreach ( $string_meta as $key ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'              => 'string',
					'single'            => true,
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
					'show_in_rest'      => false,
					'auth_callback'     => static fn(): bool => current_user_can( 'edit_posts' ),
				)
			);
		}

		register_post_meta(
			self::POST_TYPE,
			self::META_PRIORITY,
			array(
				'type'              => 'integer',
				'single'            => true,
				'default'           => 0,
				'sanitize_callback' => 'intval',
				'show_in_rest'      => false,
				'auth_callback'     => static fn(): bool => current_user_can( 'edit_posts' ),
			)
		);

		// Listy trzymamy jako pojedyncze meta z tablica - prosciej niz wiele wierszy.
		foreach ( array( self::META_WEEKDAYS, self::META_MEALS, self::META_DIETS ) as $key ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'          => 'array',
					'single'        => true,
					'default'       => array(),
					'show_in_rest'  => false,
					'auth_callback' => static fn(): bool => current_user_can( 'edit_posts' ),
				)
			);
		}
	}

	/**
	 * Zamienia wpis WP na znormalizowana tablice rozumiana przez EventMatcher.
	 *
	 * @return array<string, mixed>
	 */
	public static function to_array( \WP_Post $post ): array {
		$placement = (string) get_post_meta( $post->ID, self::META_PLACEMENT, true );

		return array(
			'id'        => (int) $post->ID,
			'status'    => (string) $post->post_status,
			'title'     => (string) $post->post_title,
			'body'      => (string) $post->post_content,
			'badge'     => (string) get_post_meta( $post->ID, self::META_BADGE, true ),
			'date_from' => EventMatcher::normalize_date( get_post_meta( $post->ID, self::META_DATE_FROM, true ) ),
			'date_to'   => EventMatcher::normalize_date( get_post_meta( $post->ID, self::META_DATE_TO, true ) ),
			'weekdays'  => EventMatcher::normalize_int_list( get_post_meta( $post->ID, self::META_WEEKDAYS, true ) ),
			'meals'     => EventMatcher::normalize_slug_list( get_post_meta( $post->ID, self::META_MEALS, true ) ),
			'diets'     => EventMatcher::normalize_slug_list( get_post_meta( $post->ID, self::META_DIETS, true ) ),
			'placement' => EventMatcher::PLACEMENT_BEFORE === $placement
				? EventMatcher::PLACEMENT_BEFORE
				: EventMatcher::PLACEMENT_AFTER,
			'priority'  => (int) get_post_meta( $post->ID, self::META_PRIORITY, true ),
		);
	}

	/**
	 * Zapisuje pola dodatkowe. Klucze nieobecne w $fields zostaja bez zmian -
	 * dzieki temu PATCH z REST API moze aktualizowac pojedyncze pole.
	 *
	 * @param array<string, mixed> $fields Pola do zapisania.
	 */
	public static function save_fields( int $post_id, array $fields ): void {
		$dates = array(
			'date_from' => self::META_DATE_FROM,
			'date_to'   => self::META_DATE_TO,
		);

		foreach ( $dates as $field => $meta_key ) {
			if ( array_key_exists( $field, $fields ) ) {
				update_post_meta( $post_id, $meta_key, EventMatcher::normalize_date( $fields[ $field ] ) ?? '' );
			}
		}

		if ( array_key_exists( 'badge', $fields ) ) {
			$badge = is_scalar( $fields['badge'] ) ? sanitize_text_field( (string) $fields['badge'] ) : '';

			update_post_meta( $post_id, self::META_BADGE, $badge );
		}

		if ( array_key_exists( 'weekdays', $fields ) ) {
			update_post_meta( $post_id, self::META_WEEKDAYS, EventMatcher::normalize_int_list( $fields['weekdays'] ) );
		}

		if ( array_key_exists( 'meals', $fields ) ) {
			update_post_meta( $post_id, self::META_MEALS, EventMatcher::normalize_slug_list( $fields['meals'] ) );
		}

		if ( array_key_exists( 'diets', $fields ) ) {
			update_post_meta( $post_id, self::META_DIETS, EventMatcher::normalize_slug_list( $fields['diets'] ) );
		}

		if ( array_key_exists( 'placement', $fields ) ) {
			$placement = EventMatcher::PLACEMENT_BEFORE === $fields['placement']
				? EventMatcher::PLACEMENT_BEFORE
				: EventMatcher::PLACEMENT_AFTER;

			update_post_meta( $post_id, self::META_PLACEMENT, $placement );
		}

		if ( array_key_exists( 'priority', $fields ) ) {
			update_post_meta( $post_id, self::META_PRIORITY, (int) $fields['priority'] );
		}

		Repository::flush_cache();
	}
}
