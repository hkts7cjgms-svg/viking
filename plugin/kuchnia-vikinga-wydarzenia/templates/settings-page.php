<?php
/**
 * Strona ustawien wtyczki.
 *
 * @var array<string, mixed> $settings Aktualne ustawienia.
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$kv_option = Settings::OPTION;

?>
<div class="wrap">
	<h1><?php esc_html_e( 'Wydarzenia — ustawienia', 'kv-wydarzenia' ); ?></h1>

	<form method="post" action="options.php">
		<?php settings_fields( Settings::GROUP ); ?>

		<h2><?php esc_html_e( 'Sposób wyświetlania', 'kv-wydarzenia' ); ?></h2>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><?php esc_html_e( 'Tryb', 'kv-wydarzenia' ); ?></th>
				<td>
					<fieldset class="kv-settings__mode">
						<label>
							<input type="radio" name="<?php echo esc_attr( $kv_option ); ?>[mode]" value="filter"
								<?php checked( 'filter', $settings['mode'] ); ?>>
							<strong><?php esc_html_e( 'Przez motyw (zalecane)', 'kv-wydarzenia' ); ?></strong>
							— <?php esc_html_e( 'jedna linia w szablonie jadłospisu, renderowanie po stronie serwera.', 'kv-wydarzenia' ); ?>
						</label><br>
						<label>
							<input type="radio" name="<?php echo esc_attr( $kv_option ); ?>[mode]" value="js"
								<?php checked( 'js', $settings['mode'] ); ?>>
							<strong><?php esc_html_e( 'Przez przeglądarkę', 'kv-wydarzenia' ); ?></strong>
							— <?php esc_html_e( 'bez zmian w motywie; skrypt dokleja wydarzenia po selektorze CSS.', 'kv-wydarzenia' ); ?>
						</label><br>
						<label>
							<input type="radio" name="<?php echo esc_attr( $kv_option ); ?>[mode]" value="off"
								<?php checked( 'off', $settings['mode'] ); ?>>
							<strong><?php esc_html_e( 'Tylko shortcode', 'kv-wydarzenia' ); ?></strong>
							— <?php esc_html_e( 'nic nie dzieje się automatycznie.', 'kv-wydarzenia' ); ?>
						</label>
					</fieldset>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="kv_filter_hook"><?php esc_html_e( 'Nazwa filtra', 'kv-wydarzenia' ); ?></label>
				</th>
				<td>
					<input type="text" class="regular-text code" id="kv_filter_hook"
						name="<?php echo esc_attr( $kv_option ); ?>[filter_hook]"
						value="<?php echo esc_attr( (string) $settings['filter_hook'] ); ?>">
					<p class="description"><?php esc_html_e( 'Dotyczy trybu „Przez motyw”. Wstaw w szablonie jadłospisu:', 'kv-wydarzenia' ); ?></p>
					<pre class="kv-settings__snippet"><code>&lt;?php echo kv_opis_posilku( $opis, $data, $posilek, $dieta ); ?&gt;</code></pre>
					<p class="description">
						<?php esc_html_e( 'Albo, jeśli wolisz nie wołać funkcji wtyczki wprost:', 'kv-wydarzenia' ); ?>
					</p>
					<pre class="kv-settings__snippet"><code>&lt;?php echo apply_filters( '<?php echo esc_html( (string) $settings['filter_hook'] ); ?>', $opis, $data, $posilek, $dieta ); ?&gt;</code></pre>
				</td>
			</tr>
			<tr>
				<th scope="row">
					<label for="kv_js_selector"><?php esc_html_e( 'Selektor bloku posiłku', 'kv-wydarzenia' ); ?></label>
				</th>
				<td>
					<input type="text" class="regular-text code" id="kv_js_selector"
						name="<?php echo esc_attr( $kv_option ); ?>[js_selector]"
						value="<?php echo esc_attr( (string) $settings['js_selector'] ); ?>">
					<p class="description"><?php esc_html_e( 'Dotyczy trybu „Przez przeglądarkę”. Selektor CSS elementu, do którego doklejamy wydarzenia.', 'kv-wydarzenia' ); ?></p>
				</td>
			</tr>
			<?php
			$kv_attrs = array(
				'js_date_attr' => __( 'Atrybut z datą', 'kv-wydarzenia' ),
				'js_meal_attr' => __( 'Atrybut z posiłkiem', 'kv-wydarzenia' ),
				'js_diet_attr' => __( 'Atrybut z dietą', 'kv-wydarzenia' ),
			);
			?>
			<?php foreach ( $kv_attrs as $kv_key => $kv_label ) : ?>
				<tr>
					<th scope="row">
						<label for="kv_<?php echo esc_attr( $kv_key ); ?>"><?php echo esc_html( $kv_label ); ?></label>
					</th>
					<td>
						<input type="text" class="regular-text code" id="kv_<?php echo esc_attr( $kv_key ); ?>"
							name="<?php echo esc_attr( $kv_option ); ?>[<?php echo esc_attr( $kv_key ); ?>]"
							value="<?php echo esc_attr( (string) $settings[ $kv_key ] ); ?>">
					</td>
				</tr>
			<?php endforeach; ?>
			<tr>
				<th scope="row">
					<label for="kv_js_pages"><?php esc_html_e( 'Tylko na stronach', 'kv-wydarzenia' ); ?></label>
				</th>
				<td>
					<input type="text" class="regular-text code" id="kv_js_pages"
						name="<?php echo esc_attr( $kv_option ); ?>[js_pages]"
						value="<?php echo esc_attr( implode( ', ', (array) $settings['js_pages'] ) ); ?>"
						placeholder="jadlospis, menu">
					<p class="description"><?php esc_html_e( 'Slugi stron po przecinku. Puste = skrypt ładuje się wszędzie.', 'kv-wydarzenia' ); ?></p>
				</td>
			</tr>
		</table>

		<h2><?php esc_html_e( 'Słowniki', 'kv-wydarzenia' ); ?></h2>

		<table class="form-table" role="presentation">
			<tr>
				<th scope="row"><label for="kv_meals"><?php esc_html_e( 'Posiłki', 'kv-wydarzenia' ); ?></label></th>
				<td>
					<input type="text" class="large-text code" id="kv_meals"
						name="<?php echo esc_attr( $kv_option ); ?>[meals]"
						value="<?php echo esc_attr( implode( ', ', (array) $settings['meals'] ) ); ?>">
					<p class="description"><?php esc_html_e( 'Slugi po przecinku, w kolejności podawania. Puste przywraca domyślne.', 'kv-wydarzenia' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="kv_diets"><?php esc_html_e( 'Diety', 'kv-wydarzenia' ); ?></label></th>
				<td>
					<input type="text" class="large-text code" id="kv_diets"
						name="<?php echo esc_attr( $kv_option ); ?>[diets]"
						value="<?php echo esc_attr( implode( ', ', (array) $settings['diets'] ) ); ?>"
						placeholder="smart, keto, wegetarianska">
					<p class="description"><?php esc_html_e( 'Puste = wydarzenia nie są filtrowane po diecie.', 'kv-wydarzenia' ); ?></p>
				</td>
			</tr>
			<tr>
				<th scope="row"><label for="kv_wrapper_class"><?php esc_html_e( 'Klasa CSS', 'kv-wydarzenia' ); ?></label></th>
				<td>
					<input type="text" class="regular-text code" id="kv_wrapper_class"
						name="<?php echo esc_attr( $kv_option ); ?>[wrapper_class]"
						value="<?php echo esc_attr( (string) $settings['wrapper_class'] ); ?>">
				</td>
			</tr>
		</table>

		<?php submit_button(); ?>
	</form>

	<h2><?php esc_html_e( 'Dostęp dla agenta', 'kv-wydarzenia' ); ?></h2>
	<p>
		<?php esc_html_e( 'Wydarzeniami można zarządzać skryptem przez REST API, bez wchodzenia do panelu. Bazowy adres:', 'kv-wydarzenia' ); ?>
	</p>
	<pre class="kv-settings__snippet"><code><?php echo esc_html( rest_url( RestController::REST_NAMESPACE ) ); ?></code></pre>
	<p>
		<?php esc_html_e( 'Do zapisu potrzebne jest hasło aplikacji użytkownika z uprawnieniem „edytuj wpisy” — tworzy się je w Użytkownicy → Profil → Hasła aplikacji.', 'kv-wydarzenia' ); ?>
	</p>
</div>
