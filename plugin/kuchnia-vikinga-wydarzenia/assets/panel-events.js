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
		// Przycisk "Zapisz w Kalendarzu Google" nad listą posiłków.
		saveButton: true,
		dayCardSelector: '#dayDetailsCard',
		dayHeaderSelector: '.card-header',
		mealNutritionSelector: '.meal-nutritions .nutrition-summary__item',
		saveButtonClass: 'kv-panel-save-day',
		saveButtonLabel: 'Zapisz w Kalendarzu Google',
		calendarTitle: 'Jadłospis — Kuchnia Vikinga',
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

	/**
	 * Zbiera to, co widac na karcie dnia: nazwe posilku, opis i wartosci odzywcze.
	 *
	 * Szczegoly z bocznego panelu (otwieranego klinieciem w posilek) tu nie trafiaja -
	 * ich struktura nie jest jeszcze rozpoznana.
	 */
	function collectDay( root, config ) {
		var date = findSelectedDate( root, config );

		if ( ! date ) {
			return null;
		}

		var cards = root.querySelectorAll( config.mealCardSelector );
		var meals = [];

		for ( var i = 0; i < cards.length; i++ ) {
			var card = cards[ i ];
			var nameNode = card.querySelector( config.mealNameSelector );
			var bodyNode = card.querySelector( config.mealBodySelector );

			if ( ! nameNode && ! bodyNode ) {
				continue;
			}

			var nutritionNodes = card.querySelectorAll( config.mealNutritionSelector );
			var nutrition = [];

			for ( var n = 0; n < nutritionNodes.length; n++ ) {
				var value = nutritionNodes[ n ].textContent.trim();

				if ( value ) {
					nutrition.push( value );
				}
			}

			meals.push( {
				slug: nameNode ? normalizeSlug( nameNode.textContent ) : '',
				name: nameNode ? nameNode.textContent.trim() : '',
				// Bez naszych wstawek - do kalendarza ma trafic sam jadlospis.
				description: bodyNode ? textWithoutInjected( bodyNode, config.markerClass ) : '',
				nutrition: nutrition,
			} );
		}

		return { date: date, meals: meals };
	}

	/**
	 * Tekst elementu z pominieciem tresci, ktore sami wczesniej doklejilismy.
	 */
	function textWithoutInjected( node, markerClass ) {
		var text = '';
		var children = node.childNodes;

		for ( var i = 0; i < children.length; i++ ) {
			var child = children[ i ];

			if ( 1 === child.nodeType && child.classList && child.classList.contains( markerClass ) ) {
				continue;
			}

			text += child.textContent || '';
		}

		return text.replace( /\s+/g, ' ' ).trim();
	}

	/**
	 * Opis wpisu w kalendarzu - jeden blok na posilek.
	 */
	function formatDayDetails( day ) {
		var blocks = [];

		for ( var i = 0; i < day.meals.length; i++ ) {
			var meal = day.meals[ i ];
			var lines = [];

			if ( meal.name ) {
				lines.push( meal.name.toUpperCase() );
			}

			if ( meal.description ) {
				lines.push( meal.description );
			}

			if ( meal.nutrition.length ) {
				lines.push( meal.nutrition.join( ' · ' ) );
			}

			if ( lines.length ) {
				blocks.push( lines.join( '\n' ) );
			}
		}

		return blocks.join( '\n\n' );
	}

	function compactDate( date ) {
		return String( date ).replace( /-/g, '' );
	}

	function addDays( date, days ) {
		var parsed = new Date( date + 'T00:00:00Z' );

		parsed.setUTCDate( parsed.getUTCDate() + days );

		return parsed.toISOString().slice( 0, 10 );
	}

	/**
	 * Link "dodaj wydarzenie" Kalendarza Google. Zwykly adres, bez OAuth i bez
	 * dostepu do konta - klikniecie otwiera gotowy formularz do zapisania.
	 *
	 * Wpis jest calodniowy, a zakres dat w tym API jest wylaczny od konca,
	 * stad dzien nastepny jako data konca.
	 */
	function buildGoogleCalendarUrl( day, title ) {
		var url = new URL( 'https://calendar.google.com/calendar/render' );

		url.searchParams.set( 'action', 'TEMPLATE' );
		url.searchParams.set( 'text', title + ' · ' + day.date );
		url.searchParams.set( 'dates', compactDate( day.date ) + '/' + compactDate( addDays( day.date, 1 ) ) );

		var details = formatDayDetails( day );

		if ( details ) {
			url.searchParams.set( 'details', details );
		}

		return url.toString();
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

			if ( config.saveButton ) {
				mountSaveButton( date );
			}
		}

		/**
		 * Przycisk zapisu dnia. Adres przeliczamy przy kazdym przebiegu, bo po
		 * zmianie dnia jadlospis jest juz inny.
		 */
		function mountSaveButton( date ) {
			var card = document.querySelector( config.dayCardSelector );
			var header = card ? card.querySelector( config.dayHeaderSelector ) : null;

			if ( ! header ) {
				return;
			}

			var day = collectDay( document, config );

			if ( ! day || 0 === day.meals.length ) {
				return;
			}

			var link = header.querySelector( '.' + config.saveButtonClass );

			if ( ! link ) {
				link = document.createElement( 'a' );
				link.className = config.saveButtonClass;
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
				link.textContent = config.saveButtonLabel;

				// Style inline - nie mamy jak wgrac arkusza do cudzej aplikacji.
				// Kolor bierzemy ze zmiennej panelu, wiec przycisk trzyma sie motywu.
				link.style.cssText = [
					'display:inline-block',
					'margin-left:auto',
					'padding:6px 12px',
					'border-radius:6px',
					'border:1px solid var(--color-primary-500, #fac119)',
					'background:var(--color-primary-100, #fffaf0)',
					'color:inherit',
					'font-size:13px',
					'line-height:1.3',
					'text-decoration:none',
					'white-space:nowrap',
					'cursor:pointer',
				].join( ';' );

				header.appendChild( link );
			}

			link.href = buildGoogleCalendarUrl( day, config.calendarTitle );
			link.dataset.kvDay = date;
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
		collectDay: collectDay,
		formatDayDetails: formatDayDetails,
		buildGoogleCalendarUrl: buildGoogleCalendarUrl,
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
