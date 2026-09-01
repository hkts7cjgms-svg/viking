<?php
/**
 * Metaboks z polami wydarzenia w panelu (dodawanie / edycja).
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MetaBox {

	private const NONCE_ACTION = 'kv_wydarzenia_save';
	private const NONCE_NAME   = 'kv_wydarzenia_nonce';

	public function register(): void {
		add_action( 'add_meta_boxes', array( $this, 'add_meta_box' ) );
		add_action( 'save_post_' . EventPostType::POST_TYPE, array( $this, 'save' ), 10, 2 );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue' ) );
	}

	public function enqueue( string $hook ): void {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php', 'edit.php' ), true ) ) {
			return;
		}

		$screen = get_current_screen();

		if ( ! $screen instanceof \WP_Screen || EventPostType::POST_TYPE !== $screen->post_type ) {
			return;
		}

		wp_enqueue_style( 'kv-wydarzenia-admin', plugin_dir_url( PLUGIN_FILE ) . 'assets/admin.css', array(), VERSION );
	}

	public function add_meta_box(): void {
		add_meta_box(
			'kv-wydarzenia-terminy',
			__( 'Kiedy i gdzie pokazać', 'kv-wydarzenia' ),
			array( $this, 'render' ),
			EventPostType::POST_TYPE,
			'normal',
			'high'
		);
	}

	public function render( \WP_Post $post ): void {
		wp_nonce_field( self::NONCE_ACTION, self::NONCE_NAME );

		$event = EventPostType::to_array( $post );
		$meals = Settings::meals();
		$diets = Settings::diets();

		require dirname( __DIR__ ) . '/templates/meta-box.php';
	}

	public function save( int $post_id, \WP_Post $post ): void {
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		if ( wp_is_post_revision( $post_id ) ) {
			return;
		}

		$nonce = isset( $_POST[ self::NONCE_NAME ] )
			? sanitize_text_field( wp_unslash( (string) $_POST[ self::NONCE_NAME ] ) )
			: '';

		if ( '' === $nonce || ! wp_verify_nonce( $nonce, self::NONCE_ACTION ) ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		unset( $post );

		// phpcs:disable WordPress.Security.NonceVerification.Missing -- nonce sprawdzony wyzej.
		$fields = array(
			'date_from' => $this->text( 'kv_date_from' ),
			'date_to'   => $this->text( 'kv_date_to' ),
			'badge'     => $this->text( 'kv_badge' ),
			'placement' => $this->text( 'kv_placement' ),
			'priority'  => (int) $this->text( 'kv_priority' ),
			'weekdays'  => $this->list( 'kv_weekdays' ),
			'meals'     => $this->list( 'kv_meals' ),
			'diets'     => $this->list( 'kv_diets' ),
		);
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		EventPostType::save_fields( $post_id, $fields );
	}

	private function text( string $key ): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce sprawdzony w save().
		$value = $_POST[ $key ] ?? '';

		return is_scalar( $value ) ? sanitize_text_field( wp_unslash( (string) $value ) ) : '';
	}

	/**
	 * @return string[]
	 */
	private function list( string $key ): array {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- nonce sprawdzony w save().
		$value = $_POST[ $key ] ?? array();

		if ( is_string( $value ) ) {
			return array_map( 'sanitize_text_field', preg_split( '/[,\r\n]+/', wp_unslash( $value ) ) ?: array() );
		}

		if ( ! is_array( $value ) ) {
			return array();
		}

		return array_map(
			static fn( $item ): string => is_scalar( $item ) ? sanitize_text_field( wp_unslash( (string) $item ) ) : '',
			$value
		);
	}
}
