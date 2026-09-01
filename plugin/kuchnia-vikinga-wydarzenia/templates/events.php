<?php
/**
 * Szablon listy wydarzen doklejanej do opisu posilku.
 *
 * Dostepne zmienne:
 *
 * @var array[] $events        Znormalizowane wydarzenia.
 * @var string  $date          Data 'Y-m-d'.
 * @var ?string $meal          Slug posilku.
 * @var string  $wrapper_class Klasa CSS kontenera.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

?>
<div class="<?php echo esc_attr( $wrapper_class ); ?>" data-kv-events-date="<?php echo esc_attr( $date ); ?>">
	<?php foreach ( $events as $event ) : ?>
		<?php
		$badge = trim( (string) ( $event['badge'] ?? '' ) );
		$title = trim( (string) ( $event['title'] ?? '' ) );
		$body  = Renderer::body_html( $event );
		?>
		<div class="<?php echo esc_attr( $wrapper_class ); ?>__item" data-kv-event-id="<?php echo esc_attr( (string) ( $event['id'] ?? 0 ) ); ?>">
			<?php if ( '' !== $title ) : ?>
				<p class="<?php echo esc_attr( $wrapper_class ); ?>__title">
					<?php if ( '' !== $badge ) : ?>
						<span class="<?php echo esc_attr( $wrapper_class ); ?>__badge"><?php echo esc_html( $badge ); ?></span>
					<?php endif; ?>
					<span class="<?php echo esc_attr( $wrapper_class ); ?>__name"><?php echo esc_html( $title ); ?></span>
				</p>
			<?php endif; ?>

			<?php if ( '' !== $body ) : ?>
				<div class="<?php echo esc_attr( $wrapper_class ); ?>__body"><?php echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- juz przepuszczone przez wp_kses_post(). ?></div>
			<?php endif; ?>
		</div>
	<?php endforeach; ?>
</div>
