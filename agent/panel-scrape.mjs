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
	var selected = null;

	for ( var i = 0; i < holders.length; i++ ) {
		var holder = holders[ i ];
		var date = holder.getAttribute( 'data-date' );

		if ( ! /^\d{4}-\d{2}-\d{2}$/.test( date || '' ) ) {
			continue;
		}

		if ( -1 === dates.indexOf( date ) ) {
			dates.push( date );
		}

		if ( holder.querySelector( 'li.day.is-selected' ) ) {
			selected = date;
		}
	}

	return { dates: dates, selected: selected };
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
