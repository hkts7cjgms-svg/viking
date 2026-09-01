/**
 * Tryb 'js': dokleja wydarzenia do blokow posilkow bez ruszania szablonow motywu.
 *
 * Szuka elementow pasujacych do selektora z ustawien, czyta z nich date
 * (i opcjonalnie posilek oraz diete), po czym pobiera gotowy HTML z REST API.
 * Zapytania sa grupowane po kluczu data|posilek|dieta, wiec pieciu posilkom
 * jednego dnia odpowiada pieć zapytań, a nie pięćdziesiąt.
 */
( function () {
	'use strict';

	var config = window.kvWydarzenia;

	if ( ! config || ! config.endpoint || ! config.selector ) {
		return;
	}

	var DONE_FLAG = 'kvWydarzeniaDone';

	function readAttr( element, attribute ) {
		if ( ! attribute ) {
			return '';
		}

		var value = element.getAttribute( attribute );

		return value ? value.trim() : '';
	}

	function insert( element, html, position ) {
		if ( ! html ) {
			return;
		}

		var holder = document.createElement( 'div' );
		holder.innerHTML = html;

		while ( holder.firstChild ) {
			if ( 'before' === position ) {
				element.insertBefore( holder.firstChild, element.firstChild );
			} else {
				element.appendChild( holder.firstChild );
			}
		}
	}

	function run() {
		var blocks = document.querySelectorAll( config.selector );

		if ( ! blocks.length ) {
			return;
		}

		var groups = new Map();

		Array.prototype.forEach.call( blocks, function ( element ) {
			if ( element.dataset[ DONE_FLAG ] ) {
				return;
			}

			var date = readAttr( element, config.dateAttr );

			if ( ! /^\d{4}-\d{2}-\d{2}$/.test( date ) ) {
				return;
			}

			element.dataset[ DONE_FLAG ] = '1';

			var meal = readAttr( element, config.mealAttr );
			var diet = readAttr( element, config.dietAttr );
			var key = date + '|' + meal + '|' + diet;

			if ( ! groups.has( key ) ) {
				groups.set( key, { date: date, meal: meal, diet: diet, elements: [] } );
			}

			groups.get( key ).elements.push( element );
		} );

		groups.forEach( function ( group ) {
			var url = new URL( config.endpoint );
			url.searchParams.set( 'date', group.date );

			if ( group.meal ) {
				url.searchParams.set( 'meal', group.meal );
			}

			if ( group.diet ) {
				url.searchParams.set( 'diet', group.diet );
			}

			window
				.fetch( url.toString(), { credentials: 'same-origin' } )
				.then( function ( response ) {
					return response.ok ? response.json() : null;
				} )
				.then( function ( data ) {
					if ( ! data || ( ! data.before && ! data.after ) ) {
						return;
					}

					group.elements.forEach( function ( element ) {
						insert( element, data.before, 'before' );
						insert( element, data.after, 'after' );
					} );
				} )
				.catch( function () {
					/* Cisza - brak wydarzen nie moze psuc jadlospisu. */
				} );
		} );
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', run );
	} else {
		run();
	}

	// Jadlospis czesto przeladowuje sie AJAX-em przy zmianie dnia lub diety.
	document.addEventListener( 'kv-wydarzenia:refresh', run );

	if ( window.MutationObserver ) {
		var observer = new window.MutationObserver( function () {
			window.clearTimeout( run.timer );
			run.timer = window.setTimeout( run, 150 );
		} );

		observer.observe( document.body, { childList: true, subtree: true } );
	}
} )();
