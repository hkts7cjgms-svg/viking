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
 * Szczegoly posilku z bocznego panelu, ktory otwiera sie po kliknieciu w danie.
 *
 * Struktura tego panelu nie jest jeszcze rozpoznana, wiec bierzemy jego tekst
 * i probujemy rozbic go na pary "naglowek: tresc". Gdy sie nie uda, caly tekst
 * laduje pod kluczem "Szczegóły" - lepiej miec surowo niz nie miec wcale.
 *
 * @returns {object} Mapa etykieta => tresc.
 */
export function extractSidebarDetails() {
	function clean( value ) {
		return String( value == null ? '' : value ).replace( /\s+/g, ' ' ).trim();
	}

	var sidebar = document.querySelector( '#sideBar' );

	if ( ! sidebar ) {
		return {};
	}

	var text = clean( sidebar.textContent );

	if ( ! text ) {
		return {};
	}

	var details = {};
	var headings = sidebar.querySelectorAll( 'h1, h2, h3, h4, h5, h6, .h300, .h200, strong, dt, .item-title' );
	var used = false;

	for ( var i = 0; i < headings.length; i++ ) {
		var label = clean( headings[ i ].textContent ).replace( /:$/, '' );

		if ( ! label || label.length > 60 ) {
			continue;
		}

		// Tresc to zwykle nastepny element albo reszta rodzica.
		var valueNode = headings[ i ].nextElementSibling;
		var value = valueNode ? clean( valueNode.textContent ) : '';

		if ( ! value && headings[ i ].parentElement ) {
			value = clean( headings[ i ].parentElement.textContent ).replace( label, '' ).trim();
		}

		if ( value && value !== label ) {
			details[ label ] = value;
			used = true;
		}
	}

	if ( ! used ) {
		details[ 'Szczegóły' ] = text;
	}

	return details;
}
