#!/usr/bin/env node
/**
 * Diagnostyka: loguje sie do panelu i wypisuje, co widzi - bez zapisywania
 * czegokolwiek. Do uruchomienia, gdy synchronizacja nic nie zbiera.
 *
 *   node agent/diagnose.mjs
 *
 * Robi tez zrzut ekranu panelu do pliku panel.png.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDates, extractDay } from './panel-scrape.mjs';
import { withPanel } from './panel-sync.mjs';

const HERE = dirname( fileURLToPath( import.meta.url ) );

for ( const candidate of [ join( HERE, '.env' ), join( HERE, '..', '.env' ) ] ) {
	if ( ! existsSync( candidate ) ) {
		continue;
	}

	for ( const line of readFileSync( candidate, 'utf8' ).split( '\n' ) ) {
		const match = line.match( /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/ );

		if ( match && process.env[ match[ 1 ] ] === undefined ) {
			process.env[ match[ 1 ] ] = match[ 2 ].replace( /^["\']|["\']$/g, '' );
		}
	}
}

const log = ( message ) => process.stdout.write( `${ message }\n` );

await withPanel(
	{
		panelUrl: process.env.KV_PANEL_URL,
		user: process.env.KV_PANEL_USER,
		password: process.env.KV_PANEL_PASSWORD,
		headless: '0' !== process.env.KV_HEADLESS,
		sessionPath: join( HERE, '.session.json' ),
		log,
	},
	async ( page ) => {
		const calendar = await page.evaluate( extractDates );

		log( `\nDzisiaj wg komputera: ${ new Date().toISOString().slice( 0, 10 ) }` );
		log( `Dni w kalendarzu: ${ calendar.days.length }` );
		log( `Dzień otwarty teraz: ${ calendar.selected || '(żaden)' }\n` );

		log( 'data         etykieta   aktywny  wyłączony' );
		log( '───────────────────────────────────────────' );

		for ( const day of calendar.days ) {
			log(
				`${ day.date }   ${ ( day.label || '—' ).padEnd( 9 ) }  ` +
					`${ day.isActive ? 'tak' : 'nie' }      ${ day.isDisabled ? 'tak' : 'nie' }`
			);
		}

		const withMenu = calendar.days.filter( ( day ) => '' !== day.label || day.isActive );

		log( `\nDni z jadłospisem do pobrania: ${ withMenu.length }` );

		const current = await page.evaluate( extractDay );

		log( `Posiłki na otwartym dniu (${ current.date }): ${ current.meals.length }` );

		for ( const meal of current.meals ) {
			log( `  ${ meal.name }: ${ meal.description.slice( 0, 60 ) }` );
		}

		const shot = join( process.cwd(), 'panel.png' );

		await page.screenshot( { path: shot, fullPage: true } );
		log( `\nZrzut ekranu: ${ shot }` );
	}
).catch( ( error ) => {
	process.stderr.write( `Błąd: ${ error.message }\n` );
	process.exitCode = 1;
} );
