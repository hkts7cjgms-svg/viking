/**
 * Wydarzenia w opisach posilkow w PANELU KLIENTA (panel.kuchniavikinga.pl).
 *
 * Panel to osobna aplikacja React zewnetrznego dostawcy - WordPress nie renderuje
 * tam ani jednej linii. Dlatego wydarzenia doklejamy po stronie przegladarki:
 * skrypt uruchamiany przez Google Tag Managera znajduje karty posilkow, ustala
 * dzien z kalendarza i pobiera gotowy HTML z REST API wtyczki.
 *
 * Struktura panelu, na ktorej to stoi (stan na 09.2026):
 *
 *   div[data-date="RRRR-MM-DD"] > … > li.day.is-selected      <- wybrany dzien
 *   ul.dashboard-meals-list > li.enhanced-meal-card           <- karta posilku
 *       .meal-header .name                                    <- "Śniadanie"
 *       .meal-content                                         <- opis posilku
 *
 * Gdy dostawca zmieni klasy, skrypt po prostu nic nie zrobi - panel dziala dalej.
 */
( function ( global ) {
	'use strict';

	var DEFAULTS = {
		endpoint: 'https://kuchniavikinga.pl/wp-json/kv/v1/render',
		daySelector: '[data-date]',
		selectedDaySelector: 'li.day.is-selected',
		mealCardSelector: 'ul.dashboard-meals-list > li.enhanced-meal-card',
		mealNameSelector: '.meal-header .name',
		mealBodySelector: '.meal-content',
		markerClass: 'kv-panel-event',
		debounceMs: 200,
	};

	var DIACRITICS = {
		'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
		'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
	};

	/**
	 * Odpowiednik EventMatcher::normalize_slug() z PHP - "II śniadanie" => "ii-sniadanie".
	 * Obie strony musza dawac ten sam wynik, inaczej filtr posilku nie zadziala.
	 */
	function normalizeSlug( value ) {
		return String( value == null ? '' : value )
			.toLowerCase()
			.replace( /[ąćęłńóśźż]/g, function ( char ) {
				return DIACRITICS[ char ] || char;
			} )
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' );
	}

	function isValidDate( value ) {
		return /^\d{4}-\d{2}-\d{2}$/.test( String( value == null ? '' : value ) );
	}

	/**
	 * Data dnia otwartego w panelu. Karta posilku nie niesie daty - jedyne
	 * wiarygodne zrodlo to zaznaczony dzien w kalendarzu.
	 */
	function findSelectedDate( root, config ) {
		var selected = root.querySelector( config.selectedDaySelector );

		if ( ! selected ) {
			return null;
		}

		var holder = selected.closest ? selected.closest( config.daySelector ) : null;

		if ( ! holder ) {
			return null;
		}

		var date = holder.getAttribute( 'data-date' );

		return isValidDate( date ) ? date : null;
	}

	/**
	 * Slug posilku z naglowka karty. Zwraca null, gdy karta nie ma nazwy.
	 */
	function readMealSlug( card, config ) {
		var name = card.querySelector( config.mealNameSelector );

		if ( ! name ) {
			return null;
		}

		var slug = normalizeSlug( name.textContent );

		return '' === slug ? null : slug;
	}

	function buildUrl( endpoint, date, meal ) {
		var url = new URL( endpoint );

		url.searchParams.set( 'date', date );

		if ( meal ) {
			url.searchParams.set( 'meal', meal );
		}

		return url.toString();
	}

	/**
	 * Usuwa wczesniej doklejone wydarzenia z karty - inaczej po przelaczeniu
	 * dnia tresci by sie nawarstwialy.
	 */
	function clearInjected( target, markerClass ) {
		var existing = target.querySelectorAll( '.' + markerClass );

		for ( var i = 0; i < existing.length; i++ ) {
			existing[ i ].remove();
		}
	}

	function injectHtml( target, html, position, markerClass ) {
		if ( ! html ) {
			return;
		}

		var holder = document.createElement( 'div' );
		holder.className = markerClass;
		holder.innerHTML = html;

		if ( 'before' === position ) {
			target.insertBefore( holder, target.firstChild );
		} else {
			target.appendChild( holder );
		}
	}

	function create( options ) {
		var config = Object.assign( {}, DEFAULTS, options || {} );
		var cache = new Map();
		var timer = null;

		function fetchDay( date, meal ) {
			var key = date + '|' + ( meal || '' );

			if ( cache.has( key ) ) {
				return cache.get( key );
			}

			var promise = global
				.fetch( buildUrl( config.endpoint, date, meal ), { credentials: 'omit', mode: 'cors' } )
				.then( function ( response ) {
					return response.ok ? response.json() : null;
				} )
				.catch( function () {
					// Panel ma dzialac dalej nawet gdy WordPress nie odpowiada.
					return null;
				} );

			cache.set( key, promise );

			return promise;
		}

		function run() {
			var date = findSelectedDate( document, config );

			if ( ! date ) {
				return;
			}

			var cards = document.querySelectorAll( config.mealCardSelector );

			for ( var i = 0; i < cards.length; i++ ) {
				processCard( cards[ i ], date );
			}
		}

		function processCard( card, date ) {
			var meal = readMealSlug( card, config );
			var body = card.querySelector( config.mealBodySelector );

			if ( ! body ) {
				return;
			}

			var stamp = date + '|' + ( meal || '' );

			// Ten sam dzien i posilek, a nasza tresc nadal jest w DOM - nie ruszamy.
			if ( body.dataset.kvEventsFor === stamp && body.querySelector( '.' + config.markerClass ) ) {
				return;
			}

			body.dataset.kvEventsFor = stamp;

			fetchDay( date, meal ).then( function ( data ) {
				// Zanim odpowiedz wrocila, uzytkownik mogl przelaczyc dzien.
				if ( ! data || body.dataset.kvEventsFor !== stamp ) {
					return;
				}

				clearInjected( body, config.markerClass );
				injectHtml( body, data.before, 'before', config.markerClass );
				injectHtml( body, data.after, 'after', config.markerClass );
			} );
		}

		function schedule() {
			global.clearTimeout( timer );
			timer = global.setTimeout( run, config.debounceMs );
		}

		function start() {
			run();

			// Panel to SPA - zmiana dnia przebudowuje karty bez przeladowania strony.
			if ( global.MutationObserver && document.body ) {
				new global.MutationObserver( schedule ).observe( document.body, {
					childList: true,
					subtree: true,
				} );
			}

			document.addEventListener( 'kv-wydarzenia:refresh', run );
		}

		return { run: run, start: start, config: config };
	}

	var api = {
		create: create,
		normalizeSlug: normalizeSlug,
		isValidDate: isValidDate,
		findSelectedDate: findSelectedDate,
		readMealSlug: readMealSlug,
		buildUrl: buildUrl,
		DEFAULTS: DEFAULTS,
	};

	// W przegladarce startujemy sami; pod Node oddajemy same funkcje do testow.
	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = api;
	} else {
		global.kvPanelEvents = api;

		var boot = function () {
			create( global.kvPanelEventsConfig ).start();
		};

		if ( 'loading' === document.readyState ) {
			document.addEventListener( 'DOMContentLoaded', boot );
		} else {
			boot();
		}
	}
} )( typeof window !== 'undefined' ? window : globalThis );
