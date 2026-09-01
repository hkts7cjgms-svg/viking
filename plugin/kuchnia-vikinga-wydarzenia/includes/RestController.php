<?php
/**
 * REST API - to przez nie agent (skrypt, cron, asystent) dodaje, edytuje
 * i usuwa wydarzenia bez klikania w panelu.
 *
 * Autoryzacja zapisu: haslo aplikacji WordPressa (Basic auth) uzytkownika
 * z uprawnieniem edit_posts. Odczyt opublikowanych wydarzen jest publiczny,
 * bo z niego korzysta front strony.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RestController {

	public const REST_NAMESPACE = 'kv/v1';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_filter( 'rest_post_dispatch', array( $this, 'send_cors_headers' ), 10, 3 );
	}

	/**
	 * Naglowki CORS wylacznie dla tras kv/v1.
	 *
	 * Panel klienta stoi na innej domenie niz WordPress, wiec bez tego przegladarka
	 * odrzuci odpowiedz. Wpuszczamy tylko domeny z ustawien i tylko odczyt - stad
	 * brak Allow-Credentials: zapis przez przegladarke z obcej domeny ma nie dzialac.
	 *
	 * @param \WP_REST_Response $response Odpowiedz.
	 * @param \WP_REST_Server   $server   Serwer REST.
	 * @param \WP_REST_Request  $request  Zadanie.
	 *
	 * @return \WP_REST_Response
	 */
	public function send_cors_headers( $response, $server, $request ) {
		unset( $server );

		if ( ! $response instanceof \WP_REST_Response || ! $request instanceof \WP_REST_Request ) {
			return $response;
		}

		if ( ! str_starts_with( ltrim( (string) $request->get_route(), '/' ), self::REST_NAMESPACE . '/' ) ) {
			return $response;
		}

		// Vary ustawiamy zawsze, zeby cache nie podal odpowiedzi z cudzym Origin.
		$response->header( 'Vary', 'Origin', false );

		$origin = (string) $request->get_header( 'origin' );

		if ( '' === $origin || ! in_array( $origin, Settings::cors_origins(), true ) ) {
			return $response;
		}

		$response->header( 'Access-Control-Allow-Origin', $origin );
		$response->header( 'Access-Control-Allow-Methods', 'GET, OPTIONS' );
		$response->header( 'Access-Control-Allow-Headers', 'Content-Type' );
		$response->header( 'Access-Control-Max-Age', '600' );

		return $response;
	}

	public function register_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			'/events',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'list_events' ),
					'permission_callback' => '__return_true',
					'args'                => $this->list_args(),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( $this, 'create_event' ),
					'permission_callback' => array( $this, 'can_edit' ),
					'args'                => $this->write_args( true ),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/events/(?P<id>\d+)',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_event' ),
					'permission_callback' => '__return_true',
				),
				array(
					'methods'             => 'POST, PUT, PATCH',
					'callback'            => array( $this, 'update_event' ),
					'permission_callback' => array( $this, 'can_edit' ),
					'args'                => $this->write_args( false ),
				),
				array(
					'methods'             => 'DELETE',
					'callback'            => array( $this, 'delete_event' ),
					'permission_callback' => array( $this, 'can_edit' ),
					'args'                => array(
						'force' => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => __( 'true = usuń trwale, false = przenieś do kosza.', 'kv-wydarzenia' ),
						),
					),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/day/(?P<date>\d{4}-\d{2}-\d{2})',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_day' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'meal' => array( 'type' => 'string' ),
					'diet' => array( 'type' => 'string' ),
				),
			)
		);

		register_rest_route(
			self::REST_NAMESPACE,
			'/range',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_range' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'from' => array(
						'type'     => 'string',
						'required' => true,
					),
					'to'   => array(
						'type'     => 'string',
						'required' => true,
					),
					'meal' => array( 'type' => 'string' ),
					'diet' => array( 'type' => 'string' ),
					'only_with_events' => array(
						'type'    => 'boolean',
						'default' => true,
					),
				),
			)
		);

		// Uzywane przez skrypt frontu w trybie 'js'.
		register_rest_route(
			self::REST_NAMESPACE,
			'/render',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'render_events' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'date' => array(
						'type'     => 'string',
						'required' => true,
					),
					'meal' => array( 'type' => 'string' ),
					'diet' => array( 'type' => 'string' ),
				),
			)
		);

		// Slowniki - agent moze sprawdzic, jakie slugi posilkow i diet sa poprawne.
		register_rest_route(
			self::REST_NAMESPACE,
			'/meta',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_meta' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function can_edit(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * @return array<string, array<string, mixed>>
	 */
	private function list_args(): array {
		return array(
			'date'     => array(
				'type'        => 'string',
				'description' => __( 'Zwróć tylko wydarzenia obowiązujące tego dnia (Y-m-d).', 'kv-wydarzenia' ),
			),
			'from'     => array( 'type' => 'string' ),
			'to'       => array( 'type' => 'string' ),
			'meal'     => array( 'type' => 'string' ),
			'diet'     => array( 'type' => 'string' ),
			'status'   => array(
				'type'    => 'string',
				'enum'    => array( 'publish', 'draft', 'any' ),
				'default' => 'publish',
			),
			'search'   => array( 'type' => 'string' ),
			'per_page' => array(
				'type'    => 'integer',
				'default' => 50,
				'minimum' => 1,
				'maximum' => 200,
			),
			'page'     => array(
				'type'    => 'integer',
				'default' => 1,
				'minimum' => 1,
			),
		);
	}

	/**
	 * @return array<string, array<string, mixed>>
	 */
	private function write_args( bool $creating ): array {
		return array(
			'title'     => array(
				'type'     => 'string',
				'required' => $creating,
			),
			'body'      => array( 'type' => 'string' ),
			'badge'     => array( 'type' => 'string' ),
			'date_from' => array( 'type' => array( 'string', 'null' ) ),
			'date_to'   => array( 'type' => array( 'string', 'null' ) ),
			'weekdays'  => array( 'type' => array( 'array', 'string' ) ),
			'meals'     => array( 'type' => array( 'array', 'string' ) ),
			'diets'     => array( 'type' => array( 'array', 'string' ) ),
			'placement' => array(
				'type' => 'string',
				'enum' => array( EventMatcher::PLACEMENT_BEFORE, EventMatcher::PLACEMENT_AFTER ),
			),
			'priority'  => array( 'type' => 'integer' ),
			'status'    => array(
				'type' => 'string',
				'enum' => array( 'publish', 'draft' ),
			),
		);
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function list_events( \WP_REST_Request $request ) {
		$status = (string) $request->get_param( 'status' );

		if ( 'publish' !== $status && ! $this->can_edit() ) {
			return new \WP_Error(
				'kv_forbidden',
				__( 'Podgląd szkiców wymaga zalogowania.', 'kv-wydarzenia' ),
				array( 'status' => rest_authorization_required_code() )
			);
		}

		$events = 'publish' === $status
			? Repository::all()
			: $this->all_with_status( $status );

		$date = EventMatcher::normalize_date( $request->get_param( 'date' ) );
		$meal = $this->slug_param( $request, 'meal' );
		$diet = $this->slug_param( $request, 'diet' );

		if ( null !== $date ) {
			$events = EventMatcher::filter( $events, $date, $meal, $diet );
		} else {
			$events = $this->filter_by_overlap( $events, $request, $meal, $diet );
		}

		$search = trim( (string) $request->get_param( 'search' ) );

		if ( '' !== $search ) {
			$events = array_values(
				array_filter(
					$events,
					static function ( array $event ) use ( $search ): bool {
						$haystack = mb_strtolower( $event['title'] . ' ' . $event['body'], 'UTF-8' );

						return str_contains( $haystack, mb_strtolower( $search, 'UTF-8' ) );
					}
				)
			);
		}

		$total    = count( $events );
		$per_page = (int) $request->get_param( 'per_page' );
		$page     = (int) $request->get_param( 'page' );
		$slice    = array_slice( $events, ( $page - 1 ) * $per_page, $per_page );

		$response = new \WP_REST_Response( array_map( array( $this, 'prepare' ), $slice ) );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) max( 1, (int) ceil( $total / $per_page ) ) );

		return $response;
	}

	/**
	 * Zawezenie listy do wydarzen, ktore zahaczaja o zakres from-to.
	 *
	 * @param array[] $events Wydarzenia.
	 *
	 * @return array[]
	 */
	private function filter_by_overlap( array $events, \WP_REST_Request $request, ?string $meal, ?string $diet ): array {
		$from = EventMatcher::normalize_date( $request->get_param( 'from' ) );
		$to   = EventMatcher::normalize_date( $request->get_param( 'to' ) );

		return array_values(
			array_filter(
				$events,
				static function ( array $event ) use ( $from, $to, $meal, $diet ): bool {
					// Filtr posilku i diety dziala tu w oderwaniu od dat.
					$meals = $event['meals'] ?? array();

					if ( null !== $meal && array() !== $meals && ! in_array( $meal, $meals, true ) ) {
						return false;
					}

					$diets = $event['diets'] ?? array();

					if ( null !== $diet && array() !== $diets && ! in_array( $diet, $diets, true ) ) {
						return false;
					}

					$event_from = $event['date_from'] ?? null;
					$event_to   = $event['date_to'] ?? null;

					if ( null !== $to && null !== $event_from && $event_from > $to ) {
						return false;
					}

					if ( null !== $from && null !== $event_to && $event_to < $from ) {
						return false;
					}

					return true;
				}
			)
		);
	}

	/**
	 * @return array[]
	 */
	private function all_with_status( string $status ): array {
		$posts = get_posts(
			array(
				'post_type'      => EventPostType::POST_TYPE,
				'post_status'    => 'any' === $status ? array( 'publish', 'draft', 'pending', 'private' ) : $status,
				'posts_per_page' => 500,
				'orderby'        => 'ID',
				'order'          => 'ASC',
				'no_found_rows'  => true,
			)
		);

		return EventMatcher::sort( array_map( array( EventPostType::class, 'to_array' ), $posts ) );
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_event( \WP_REST_Request $request ) {
		$event = Repository::find( (int) $request['id'] );

		if ( null === $event ) {
			return $this->not_found();
		}

		if ( 'publish' !== $event['status'] && ! $this->can_edit() ) {
			return $this->not_found();
		}

		return new \WP_REST_Response( $this->prepare( $event ) );
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function create_event( \WP_REST_Request $request ) {
		$title = trim( (string) $request->get_param( 'title' ) );

		if ( '' === $title ) {
			return new \WP_Error(
				'kv_missing_title',
				__( 'Pole "title" jest wymagane.', 'kv-wydarzenia' ),
				array( 'status' => 400 )
			);
		}

		$invalid = $this->validate_dates( $request );

		if ( $invalid instanceof \WP_Error ) {
			return $invalid;
		}

		$status = (string) ( $request->get_param( 'status' ) ?? 'publish' );

		$post_id = wp_insert_post(
			array(
				'post_type'    => EventPostType::POST_TYPE,
				'post_title'   => $title,
				'post_content' => (string) ( $request->get_param( 'body' ) ?? '' ),
				'post_status'  => in_array( $status, array( 'publish', 'draft' ), true ) ? $status : 'publish',
			),
			true
		);

		if ( is_wp_error( $post_id ) ) {
			return $post_id;
		}

		EventPostType::save_fields( (int) $post_id, $this->writable_fields( $request ) );

		$event = Repository::find( (int) $post_id );

		return new \WP_REST_Response( $this->prepare( $event ?? array() ), 201 );
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function update_event( \WP_REST_Request $request ) {
		$id    = (int) $request['id'];
		$event = Repository::find( $id );

		if ( null === $event ) {
			return $this->not_found();
		}

		$invalid = $this->validate_dates( $request );

		if ( $invalid instanceof \WP_Error ) {
			return $invalid;
		}

		$post_data = array( 'ID' => $id );

		if ( null !== $request->get_param( 'title' ) ) {
			$post_data['post_title'] = (string) $request->get_param( 'title' );
		}

		if ( null !== $request->get_param( 'body' ) ) {
			$post_data['post_content'] = (string) $request->get_param( 'body' );
		}

		if ( null !== $request->get_param( 'status' ) ) {
			$post_data['post_status'] = (string) $request->get_param( 'status' );
		}

		if ( count( $post_data ) > 1 ) {
			$updated = wp_update_post( $post_data, true );

			if ( is_wp_error( $updated ) ) {
				return $updated;
			}
		}

		EventPostType::save_fields( $id, $this->writable_fields( $request ) );

		$fresh = Repository::find( $id );

		return new \WP_REST_Response( $this->prepare( $fresh ?? array() ) );
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function delete_event( \WP_REST_Request $request ) {
		$id    = (int) $request['id'];
		$event = Repository::find( $id );

		if ( null === $event ) {
			return $this->not_found();
		}

		$force   = (bool) $request->get_param( 'force' );
		$deleted = $force ? wp_delete_post( $id, true ) : wp_trash_post( $id );

		if ( ! $deleted ) {
			return new \WP_Error(
				'kv_delete_failed',
				__( 'Nie udało się usunąć wydarzenia.', 'kv-wydarzenia' ),
				array( 'status' => 500 )
			);
		}

		Repository::flush_cache();

		return new \WP_REST_Response(
			array(
				'deleted'  => true,
				'forced'   => $force,
				'previous' => $this->prepare( $event ),
			)
		);
	}

	public function get_day( \WP_REST_Request $request ): \WP_REST_Response {
		$date   = (string) $request['date'];
		$meal   = $this->slug_param( $request, 'meal' );
		$diet   = $this->slug_param( $request, 'diet' );
		$events = Repository::for_day( $date, $meal, $diet );

		return new \WP_REST_Response(
			array(
				'date'   => $date,
				'meal'   => $meal,
				'diet'   => $diet,
				'count'  => count( $events ),
				'events' => array_map( array( $this, 'prepare' ), $events ),
				'html'   => Renderer::render( $events, $date, $meal ),
			)
		);
	}

	/**
	 * Kalendarz: co wypada w kolejnych dniach zakresu.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_range( \WP_REST_Request $request ) {
		$from = EventMatcher::normalize_date( $request->get_param( 'from' ) );
		$to   = EventMatcher::normalize_date( $request->get_param( 'to' ) );

		if ( null === $from || null === $to ) {
			return new \WP_Error(
				'kv_bad_date',
				__( 'Parametry "from" i "to" muszą mieć format RRRR-MM-DD.', 'kv-wydarzenia' ),
				array( 'status' => 400 )
			);
		}

		if ( $to < $from ) {
			return new \WP_Error(
				'kv_bad_range',
				__( 'Data "to" nie może być wcześniejsza niż "from".', 'kv-wydarzenia' ),
				array( 'status' => 400 )
			);
		}

		$meal      = $this->slug_param( $request, 'meal' );
		$diet      = $this->slug_param( $request, 'diet' );
		$only_used = (bool) $request->get_param( 'only_with_events' );
		$days      = array();

		foreach ( Repository::for_range( $from, $to, $meal, $diet ) as $date => $events ) {
			if ( $only_used && array() === $events ) {
				continue;
			}

			$days[] = array(
				'date'   => $date,
				'count'  => count( $events ),
				'events' => array_map( array( $this, 'prepare' ), $events ),
			);
		}

		return new \WP_REST_Response(
			array(
				'from' => $from,
				'to'   => $to,
				'days' => $days,
			)
		);
	}

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function render_events( \WP_REST_Request $request ) {
		$date = EventMatcher::normalize_date( $request->get_param( 'date' ) );

		if ( null === $date ) {
			return new \WP_Error(
				'kv_bad_date',
				__( 'Parametr "date" musi mieć format RRRR-MM-DD.', 'kv-wydarzenia' ),
				array( 'status' => 400 )
			);
		}

		$meal   = $this->slug_param( $request, 'meal' );
		$diet   = $this->slug_param( $request, 'diet' );
		$events = Repository::for_day( $date, $meal, $diet );
		$split  = EventMatcher::split_by_placement( $events );

		return new \WP_REST_Response(
			array(
				'date'   => $date,
				'before' => Renderer::render( $split['before'], $date, $meal ),
				'after'  => Renderer::render( $split['after'], $date, $meal ),
			)
		);
	}

	public function get_meta( \WP_REST_Request $request ): \WP_REST_Response {
		unset( $request );

		return new \WP_REST_Response(
			array(
				'version'   => VERSION,
				'today'     => Shortcode::today(),
				'meals'     => array_map(
					static fn( string $slug ): array => array(
						'slug'  => $slug,
						'label' => Settings::label( $slug ),
					),
					Settings::meals()
				),
				'diets'     => Settings::diets(),
				'weekdays'  => array( 1 => 'pon', 2 => 'wt', 3 => 'śr', 4 => 'czw', 5 => 'pt', 6 => 'sob', 7 => 'nd' ),
				'placement' => array( EventMatcher::PLACEMENT_BEFORE, EventMatcher::PLACEMENT_AFTER ),
				'mode'      => Settings::get( 'mode' ),
			)
		);
	}

	/**
	 * Tylko te pola, ktore faktycznie przyszly w zadaniu - reszta zostaje bez zmian.
	 *
	 * @return array<string, mixed>
	 */
	private function writable_fields( \WP_REST_Request $request ): array {
		$fields = array();

		foreach ( array( 'date_from', 'date_to', 'badge', 'weekdays', 'meals', 'diets', 'placement', 'priority' ) as $field ) {
			if ( null !== $request->get_param( $field ) ) {
				$fields[ $field ] = $request->get_param( $field );
			}
		}

		return $fields;
	}

	/**
	 * @return \WP_Error|null
	 */
	private function validate_dates( \WP_REST_Request $request ): ?\WP_Error {
		foreach ( array( 'date_from', 'date_to' ) as $field ) {
			$value = $request->get_param( $field );

			if ( null === $value || '' === $value ) {
				continue;
			}

			if ( ! is_string( $value ) || ! EventMatcher::is_valid_date( $value ) ) {
				return new \WP_Error(
					'kv_bad_date',
					sprintf(
						/* translators: %s: nazwa pola. */
						__( 'Pole "%s" musi mieć format RRRR-MM-DD.', 'kv-wydarzenia' ),
						$field
					),
					array( 'status' => 400 )
				);
			}
		}

		$from = EventMatcher::normalize_date( $request->get_param( 'date_from' ) );
		$to   = EventMatcher::normalize_date( $request->get_param( 'date_to' ) );

		if ( null !== $from && null !== $to && $to < $from ) {
			return new \WP_Error(
				'kv_bad_range',
				__( 'Data "date_to" nie może być wcześniejsza niż "date_from".', 'kv-wydarzenia' ),
				array( 'status' => 400 )
			);
		}

		return null;
	}

	private function slug_param( \WP_REST_Request $request, string $key ): ?string {
		$value = $request->get_param( $key );

		if ( ! is_string( $value ) || '' === trim( $value ) ) {
			return null;
		}

		return EventMatcher::normalize_slug( $value );
	}

	private function not_found(): \WP_Error {
		return new \WP_Error(
			'kv_not_found',
			__( 'Nie znaleziono wydarzenia.', 'kv-wydarzenia' ),
			array( 'status' => 404 )
		);
	}

	/**
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 *
	 * @return array<string, mixed>
	 */
	private function prepare( array $event ): array {
		if ( array() === $event ) {
			return array();
		}

		$event['edit_link'] = get_edit_post_link( (int) $event['id'], 'raw' );

		return $event;
	}
}
