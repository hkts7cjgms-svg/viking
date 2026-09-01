/**
 * Zamiana zebranego jadlospisu na wpisy Kalendarza Google i plan synchronizacji.
 *
 * Czysta logika, bez sieci - dzieki temu da sie ja przetestowac bez konta Google
 * (patrz tests/calendar-sync.test.mjs).
 */

import { createHash } from 'node:crypto';

import { SOURCE_TAG } from './google-calendar.mjs';

/**
 * Opis wpisu: jeden blok na posilek.
 *
 * @param {{meals: Array}} day Dzien jadlospisu.
 */
export function formatDescription( day ) {
	const blocks = [];

	for ( const meal of day.meals || [] ) {
		const lines = [];

		if ( meal.name ) {
			lines.push( meal.name.toUpperCase() );
		}

		if ( meal.description ) {
			lines.push( meal.description );
		}

		if ( meal.nutrition?.length ) {
			lines.push( meal.nutrition.join( ' · ' ) );
		}

		// Szczegoly z bocznego panelu, jesli udalo sie je zebrac.
		for ( const [ label, value ] of Object.entries( meal.details || {} ) ) {
			if ( value ) {
				lines.push( `${ label }: ${ value }` );
			}
		}

		if ( lines.length ) {
			blocks.push( lines.join( '\n' ) );
		}
	}

	if ( day.summary ) {
		blocks.push( day.summary );
	}

	return blocks.join( '\n\n' );
}

export function addDays( date, days ) {
	const parsed = new Date( `${ date }T00:00:00Z` );

	parsed.setUTCDate( parsed.getUTCDate() + days );

	return parsed.toISOString().slice( 0, 10 );
}

/**
 * Skrot tresci - po nim poznajemy, czy wpis wymaga aktualizacji.
 * Bez tego kazdy przebieg nadpisywalby wszystkie wpisy bez potrzeby.
 */
export function contentHash( summary, description ) {
	return createHash( 'sha256' ).update( `${ summary }\n${ description }` ).digest( 'hex' ).slice( 0, 16 );
}

/**
 * Dzien jadlospisu jako zasob wydarzenia Kalendarza Google.
 *
 * @param {{date: string, meals: Array}} day     Dzien.
 * @param {{title?: string}}             options Opcje.
 */
export function buildEvent( day, options = {} ) {
	const title = options.title || 'Jadłospis';
	const summary = `${ title } · ${ day.date }`;
	const description = formatDescription( day );

	return {
		summary,
		description,
		start: { date: day.date },
		// Zakres calodniowy w API Google jest wylaczny od konca.
		end: { date: addDays( day.date, 1 ) },
		transparency: 'transparent',
		reminders: { useDefault: false },
		extendedProperties: {
			private: {
				kvSource: SOURCE_TAG,
				kvDay: day.date,
				kvHash: contentHash( summary, description ),
			},
		},
	};
}

/**
 * Plan synchronizacji: co dodac, co poprawic, co usunac, co zostawic.
 *
 * Usuwamy tylko wpisy oznaczone jako nasze i tylko w obrebie synchronizowanego
 * zakresu dat - reszta kalendarza pozostaje nietknieta.
 *
 * @param {Array}  days     Dni jadlospisu.
 * @param {Array}  existing Wpisy juz obecne w kalendarzu.
 * @param {object} options  Opcje (title).
 */
export function planSync( days, existing, options = {} ) {
	const plan = { insert: [], patch: [], remove: [], unchanged: [] };
	const byDay = new Map();

	for ( const item of existing || [] ) {
		const key = item.extendedProperties?.private?.kvDay;

		if ( ! key ) {
			continue;
		}

		// Duplikat na ten sam dzien - jeden zostaje, reszta do usuniecia.
		if ( byDay.has( key ) ) {
			plan.remove.push( item );
			continue;
		}

		byDay.set( key, item );
	}

	for ( const day of days || [] ) {
		if ( ! day?.date || ! ( day.meals || [] ).length ) {
			continue;
		}

		const event = buildEvent( day, options );
		const current = byDay.get( day.date );

		if ( ! current ) {
			plan.insert.push( event );
			continue;
		}

		byDay.delete( day.date );

		if ( current.extendedProperties?.private?.kvHash === event.extendedProperties.private.kvHash ) {
			plan.unchanged.push( { id: current.id, event } );
			continue;
		}

		plan.patch.push( { id: current.id, event } );
	}

	// Zostaly wpisy na dni, ktorych juz nie ma w jadlospisie.
	for ( const orphan of byDay.values() ) {
		plan.remove.push( orphan );
	}

	return plan;
}

/**
 * Wykonuje plan na kliencie kalendarza.
 *
 * @param {object} client Klient z google-calendar.mjs.
 * @param {object} plan   Wynik planSync().
 * @param {object} opts   { dryRun, onProgress }
 */
export async function applySync( client, plan, opts = {} ) {
	const report = { inserted: 0, patched: 0, removed: 0, unchanged: plan.unchanged.length };
	const notify = opts.onProgress || ( () => {} );

	for ( const event of plan.insert ) {
		if ( ! opts.dryRun ) {
			await client.insert( event );
		}

		report.inserted++;
		notify( 'insert', event.extendedProperties.private.kvDay );
	}

	for ( const { id, event } of plan.patch ) {
		if ( ! opts.dryRun ) {
			await client.patch( id, event );
		}

		report.patched++;
		notify( 'patch', event.extendedProperties.private.kvDay );
	}

	for ( const event of plan.remove ) {
		if ( ! opts.dryRun ) {
			await client.remove( event.id );
		}

		report.removed++;
		notify( 'remove', event.extendedProperties?.private?.kvDay || event.id );
	}

	return report;
}
