/**
 * Most miedzy Node a Kalendarzem Apple. Buduje wpisy, oddaje je skryptowi JXA
 * i czyta raport.
 *
 * Dziala wylacznie na macOS - Calendar.app nie istnieje nigdzie indziej.
 */

import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { formatDescription, contentHash } from './calendar-sync.mjs';

const run = promisify( execFile );
const HERE = dirname( fileURLToPath( import.meta.url ) );

export const DEFAULT_CALENDAR = 'Jadłospis';

export function isSupported() {
	return 'darwin' === process.platform;
}

/**
 * Dni jadlospisu na wpisy gotowe dla Kalendarza Apple.
 *
 * @param {Array}  days    Dni.
 * @param {object} options { title }
 */
export function buildEntries( days, options = {} ) {
	const title = options.title || 'Jadłospis';
	const entries = [];

	for ( const day of days || [] ) {
		if ( ! day?.date || ! ( day.meals || [] ).length ) {
			continue;
		}

		const summary = `${ title } · ${ day.date }`;
		const description = formatDescription( day );

		entries.push( {
			date: day.date,
			summary,
			description,
			hash: contentHash( summary, description ),
		} );
	}

	return entries;
}

/**
 * Zapisuje dni w Kalendarzu Apple.
 *
 * @param {Array}  days Dni jadlospisu.
 * @param {object} opts { calendarName, title, dryRun, timeout }
 */
export async function syncToAppleCalendar( days, opts = {} ) {
	if ( ! isSupported() ) {
		throw new Error( 'Kalendarz Apple działa tylko na macOS — uruchom to na MacBooku.' );
	}

	const entries = buildEntries( days, opts );

	if ( 0 === entries.length ) {
		return { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };
	}

	const dir = mkdtempSync( join( tmpdir(), 'kv-apple-' ) );
	const payload = join( dir, 'entries.json' );

	writeFileSync(
		payload,
		JSON.stringify( {
			calendarName: opts.calendarName || DEFAULT_CALENDAR,
			dryRun: Boolean( opts.dryRun ),
			entries,
		} ),
		'utf8'
	);

	try {
		const { stdout } = await run(
			'osascript',
			[ '-l', 'JavaScript', join( HERE, 'apple-calendar.jxa.js' ), payload ],
			{ timeout: opts.timeout || 120000, maxBuffer: 8 * 1024 * 1024 }
		);

		return JSON.parse( stdout.trim() );
	} catch ( error ) {
		// Pierwsze uruchomienie prosi o zgode na sterowanie Kalendarzem.
		if ( /not authori[sz]ed|1743|osascript is not allowed/i.test( error.stderr || error.message ) ) {
			throw new Error(
				'macOS nie pozwolił sterować Kalendarzem. Ustawienia systemowe → Prywatność i ochrona → ' +
					'Automatyzacja → zaznacz Kalendarz przy aplikacji Terminal, potem uruchom ponownie.'
			);
		}

		throw new Error( `Kalendarz Apple: ${ ( error.stderr || error.message ).trim() }` );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
}
