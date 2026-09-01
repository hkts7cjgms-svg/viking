<?php
/**
 * Formularz wydarzenia w panelu.
 *
 * @var array<string, mixed> $event Znormalizowane wydarzenie.
 * @var string[]             $meals Slugi posilkow z ustawien.
 * @var string[]             $diets Slugi diet z ustawien.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$kv_weekday_labels = array(
	1 => __( 'pon', 'kv-wydarzenia' ),
	2 => __( 'wt', 'kv-wydarzenia' ),
	3 => __( 'śr', 'kv-wydarzenia' ),
	4 => __( 'czw', 'kv-wydarzenia' ),
	5 => __( 'pt', 'kv-wydarzenia' ),
	6 => __( 'sob', 'kv-wydarzenia' ),
	7 => __( 'nd', 'kv-wydarzenia' ),
);

?>
<table class="form-table kv-meta" role="presentation">
	<tr>
		<th scope="row"><label for="kv_date_from"><?php esc_html_e( 'Od dnia', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<input type="date" id="kv_date_from" name="kv_date_from" value="<?php echo esc_attr( (string) ( $event['date_from'] ?? '' ) ); ?>">
			<p class="description"><?php esc_html_e( 'Puste = od zawsze.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><label for="kv_date_to"><?php esc_html_e( 'Do dnia', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<input type="date" id="kv_date_to" name="kv_date_to" value="<?php echo esc_attr( (string) ( $event['date_to'] ?? '' ) ); ?>">
			<p class="description"><?php esc_html_e( 'Puste = bez końca. Oba dni są wliczone w zakres.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><?php esc_html_e( 'Dni tygodnia', 'kv-wydarzenia' ); ?></th>
		<td>
			<fieldset class="kv-checkboxes">
				<?php foreach ( $kv_weekday_labels as $kv_day => $kv_label ) : ?>
					<label>
						<input type="checkbox" name="kv_weekdays[]" value="<?php echo esc_attr( (string) $kv_day ); ?>"
							<?php checked( in_array( $kv_day, (array) ( $event['weekdays'] ?? array() ), true ) ); ?>>
						<?php echo esc_html( $kv_label ); ?>
					</label>
				<?php endforeach; ?>
			</fieldset>
			<p class="description"><?php esc_html_e( 'Nic nie zaznaczone = wszystkie dni w zakresie dat.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><?php esc_html_e( 'Posiłki', 'kv-wydarzenia' ); ?></th>
		<td>
			<fieldset class="kv-checkboxes">
				<?php foreach ( $meals as $kv_meal ) : ?>
					<label>
						<input type="checkbox" name="kv_meals[]" value="<?php echo esc_attr( $kv_meal ); ?>"
							<?php checked( in_array( $kv_meal, (array) ( $event['meals'] ?? array() ), true ) ); ?>>
						<?php echo esc_html( Settings::label( $kv_meal ) ); ?>
					</label>
				<?php endforeach; ?>
			</fieldset>
			<p class="description"><?php esc_html_e( 'Nic nie zaznaczone = wydarzenie pokaże się przy każdym posiłku danego dnia.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><label for="kv_diets"><?php esc_html_e( 'Diety', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<?php if ( array() !== $diets ) : ?>
				<fieldset class="kv-checkboxes">
					<?php foreach ( $diets as $kv_diet ) : ?>
						<label>
							<input type="checkbox" name="kv_diets[]" value="<?php echo esc_attr( $kv_diet ); ?>"
								<?php checked( in_array( $kv_diet, (array) ( $event['diets'] ?? array() ), true ) ); ?>>
							<?php echo esc_html( Settings::label( $kv_diet ) ); ?>
						</label>
					<?php endforeach; ?>
				</fieldset>
			<?php else : ?>
				<input type="text" class="regular-text" id="kv_diets" name="kv_diets"
					value="<?php echo esc_attr( implode( ', ', (array) ( $event['diets'] ?? array() ) ) ); ?>"
					placeholder="keto, wegetarianska">
			<?php endif; ?>
			<p class="description"><?php esc_html_e( 'Puste = wszystkie diety. Listę diet ustawia się w Wydarzenia → Ustawienia.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><label for="kv_badge"><?php esc_html_e( 'Etykieta', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<input type="text" class="regular-text" id="kv_badge" name="kv_badge"
				value="<?php echo esc_attr( (string) ( $event['badge'] ?? '' ) ); ?>" placeholder="🎄 Święta">
			<p class="description"><?php esc_html_e( 'Krótki dopisek pokazywany przed tytułem.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
	<tr>
		<th scope="row"><label for="kv_placement"><?php esc_html_e( 'Pozycja', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<select id="kv_placement" name="kv_placement">
				<option value="after" <?php selected( EventMatcher::PLACEMENT_AFTER, $event['placement'] ?? '' ); ?>>
					<?php esc_html_e( 'Pod opisem posiłku', 'kv-wydarzenia' ); ?>
				</option>
				<option value="before" <?php selected( EventMatcher::PLACEMENT_BEFORE, $event['placement'] ?? '' ); ?>>
					<?php esc_html_e( 'Nad opisem posiłku', 'kv-wydarzenia' ); ?>
				</option>
			</select>
		</td>
	</tr>
	<tr>
		<th scope="row"><label for="kv_priority"><?php esc_html_e( 'Priorytet', 'kv-wydarzenia' ); ?></label></th>
		<td>
			<input type="number" id="kv_priority" name="kv_priority" step="1"
				value="<?php echo esc_attr( (string) ( $event['priority'] ?? 0 ) ); ?>">
			<p class="description"><?php esc_html_e( 'Wyższa liczba = wyżej na liście, gdy jednego dnia wypada kilka wydarzeń.', 'kv-wydarzenia' ); ?></p>
		</td>
	</tr>
</table>
