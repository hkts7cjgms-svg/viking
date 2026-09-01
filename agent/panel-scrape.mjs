/**
 * Odczyt jadlospisu ze struktury panelu klienta.
 *
 * Funkcje sa CELOWO samowystarczalne - bez importow i domkniec - bo Playwright
 * serializuje je i wykonuje w kontekscie strony. Stad powtorzony slug: nie da
 * sie tam siegnac po nic spoza ciała funkcji.
 */

/**
 * Daty dostepne w kalendarzu panelu i ta aktualnie otwarta.
 *
 * @returns {{dates: string[], selected: string|null}}
 */
export function extractDates() {
	var holders = document.querySelectorAll( '.calendar-slider-items [data-date]' );
	var dates = [];
	var days = [];
	var selected = null;

	for ( var i = 0; i < holders.length; i++ ) {
		var holder = holders[ i ];
		var date = holder.getAttribute( 'data-date' );

		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( date || '' ) ) {
			continue;
		}

		if ( -1 !== dates.indexOf( date ) ) {
			continue;
		}

		var tile = holder.querySelector( 'li.day' );
		var labelNode = holder.querySelector( '.day-label' );
		var label = labelNode ? labelNode.textContent.replace( /\s+/g, ' ' ).trim() : '';

		dates.push( date );

		days.push( {
			date: date,
			// "Zobacz" albo "Edytuj" - tylko takie dni maja co pokazac.
			label: label,
			isActive: Boolean( tile && tile.classList.contains( 'is-active' ) ),
			// UWAGA: w tym panelu is-disabled znaczy "nie mozesz juz zmienic",
			// a nie "brak danych". Dzien z jadlospisem bywa is-disabled.
			isDisabled: Boolean( tile && tile.classList.contains( 'is-disabled' ) ),
			isSelected: Boolean( tile && tile.classList.contains( 'is-selected' ) ),
		} );

		if ( tile && tile.classList.contains( 'is-selected' ) ) {
			selected = date;
		}
	}

	return { dates: dates, days: days, selected: selected };
}

/**
 * Jadlospis dnia otwartego w panelu.
 *
 * @returns {{date: string|null, meals: Array, summary: string}}
 */
export function extractDay() {
	function slug( value ) {
		var map = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };

		return String( value == null ? '' : value )
			.toLowerCase()
			.replace( /[ąćęłńóśźż]/g, function ( char ) {
				return map[ char ] || char;
			} )
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' );
	}

	function clean( value ) {
		return String( value == null ? '' : value ).replace( /\s+/g, ' ' ).trim();
	}

	var selectedHolder = null;
	var holders = document.querySelectorAll( '.calendar-slider-items [data-date]' );

	for ( var h = 0; h < holders.length; h++ ) {
		if ( holders[ h ].querySelector( 'li.day.is-selected' ) ) {
			selectedHolder = holders[ h ];
			break;
		}
	}

	var date = selectedHolder ? selectedHolder.getAttribute( 'data-date' ) : null;
	var cards = document.querySelectorAll( 'ul.dashboard-meals-list > li.enhanced-meal-card' );
	var meals = [];

	for ( var i = 0; i < cards.length; i++ ) {
		var card = cards[ i ];
		var nameNode = card.querySelector( '.meal-header .name' );
		var bodyNode = card.querySelector( '.meal-content' );

		if ( ! nameNode && ! bodyNode ) {
			continue;
		}

		var nutritionNodes = card.querySelectorAll( '.meal-nutritions .nutrition-summary__item' );
		var nutrition = [];

		for ( var n = 0; n < nutritionNodes.length; n++ ) {
			var value = clean( nutritionNodes[ n ].textContent );

			if ( value ) {
				nutrition.push( value );
			}
		}

		meals.push( {
			id: card.id ? card.id.replace( 'mealCard-', '' ) : '',
			slug: nameNode ? slug( nameNode.textContent ) : '',
			name: nameNode ? clean( nameNode.textContent ) : '',
			description: bodyNode ? clean( bodyNode.textContent ) : '',
			nutrition: nutrition,
			details: {},
		} );
	}

	var summaryNode = document.querySelector( '#nutrientsDaySummary' );

	return {
		date: date,
		meals: meals,
		summary: summaryNode ? clean( summaryNode.textContent ) : '',
	};
}

/**
 * Szczegoly posilku z okna otwieranego klinieciem w danie.
 *
 * Struktura okna (stan 09.2026):
 *   .details-ingredients            <- najpewniejszy punkt zaczepienia
 *     div  "Składniki"
 *     p    <span>skladnik, </span><span class="font-medium">ALERGEN, </span>…
 *   ul > li > span + span           <- Białko / 46.7g, Tłuszcz / 20.2g, …
 *   p "479 kcal / 2005 kJ"
 *
 * Alergeny sa w spanach font-medium - tak oznacza je ten panel, zgodnie
 * z etykietowaniem zywnosci (skladniki alergenne pisane wielkimi literami).
 *
 * @returns {object} Mapa etykieta => tresc.
 */
export function extractSidebarDetails() {
	function clean( value ) {
		return String( value == null ? '' : value ).replace( /\s+/g, ' ' ).trim();
	}

	var anchor = document.querySelector( '.details-ingredients' );
	var box = anchor ? anchor.closest( 'div.bg-white, [class*="overflow-y-auto"]' ) : null;

	if ( ! box ) {
		box = document.querySelector( '#sideBar' );
	}

	if ( ! box ) {
		return {};
	}

	var details = {};

	// Sposob podania, np. "Na zimno".
	var serving = box.querySelector( '[class*="_cold_"], [class*="_hot_"]' );

	if ( serving && clean( serving.textContent ) ) {
		details[ 'Podanie' ] = clean( serving.textContent );
	}

	// Energia - jedyny akapit z "kcal".
	var paragraphs = box.querySelectorAll( 'p' );

	for ( var i = 0; i < paragraphs.length; i++ ) {
		var text = clean( paragraphs[ i ].textContent );

		if ( /\d\s*kcal/i.test( text ) && text.length < 40 ) {
			details[ 'Energia' ] = text;
			break;
		}
	}

	// Tabela wartosci odzywczych: dwa spany w wierszu.
	var rows = box.querySelectorAll( 'li' );

	for ( var r = 0; r < rows.length; r++ ) {
		var spans = rows[ r ].querySelectorAll( 'span' );

		if ( 2 !== spans.length ) {
			continue;
		}

		var label = clean( spans[ 0 ].textContent ).replace( /:$/, '' );
		var value = clean( spans[ 1 ].textContent );

		if ( label && value && label.length < 30 ) {
			details[ label ] = value;
		}
	}

	if ( anchor ) {
		var list = anchor.querySelector( 'p' );

		if ( list ) {
			details[ 'Składniki' ] = clean( list.textContent ).replace( /,\s*$/, '' );

			// Alergeny wyroznione grubsza czcionka.
			var bold = list.querySelectorAll( '.font-medium' );
			var allergens = [];

			for ( var b = 0; b < bold.length; b++ ) {
				var item = clean( bold[ b ].textContent ).replace( /,\s*$/, '' );

				if ( item && -1 === allergens.indexOf( item ) ) {
					allergens.push( item );
				}
			}

			if ( allergens.length ) {
				details[ 'Alergeny' ] = allergens.join( ', ' );
			}
		}
	}

	// Gdy nic nie rozpoznano, oddajemy surowy tekst - lepsze niz nic.
	if ( 0 === Object.keys( details ).length ) {
		var raw = clean( box.textContent );

		if ( raw ) {
			details[ 'Szczegóły' ] = raw;
		}
	}

	return details;
}

/**
 * Dzien i miesiac z naglowka karty dnia ("Środa, 2 września").
 *
 * Naglowek jest niezalezny od klas CSS, wiec sluzy jako drugi, pewniejszy
 * dowod na to, ktory dzien panel faktycznie pokazuje.
 *
 * @returns {{day: number, month: number}|null}
 */
export function extractDayHeading() {
	var node = document.querySelector( '#day-details-date' );

	if ( ! node ) {
		return null;
	}

	var months = [
		'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
		'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
	];

	var text = node.textContent.toLowerCase();
	var match = text.match( /(\d{1,2})\s+([a-ząćęłńóśźż]+)/ );

	if ( ! match ) {
		return null;
	}

	var month = months.indexOf( match[ 2 ] );

	if ( -1 === month ) {
		return null;
	}

	return { day: Number( match[ 1 ] ), month: month + 1 };
}

/** Podpis aktualnie pokazywanego miesiaca, np. "Wrzesień 2026". */
export function extractMonthLabel() {
	var node = document.querySelector( '#calendar-current-month' );

	return node ? node.textContent.replace( /\s+/g, ' ' ).trim() : '';
}
