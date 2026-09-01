#!/usr/bin/env node
/**
 * Diagnostyka panelu: loguje sie i wypisuje, co widzi. Nic nie zapisuje.
 *
 *   npm run diagnose
 *
 * Ma dzialac WLASNIE wtedy, gdy synchronizacja zawodzi, wiec kazdy krok jest
 * osobno zabezpieczony, a zrzut ekranu powstaje nawet po bledzie.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDates, extractDay, extractSidebarDetails } from './panel-scrape.mjs';

const HERE = dirname( fileURLToPath( import.meta.url ) );

for ( const candidate of [ join( HERE, '.env' ), join( HERE, '..', '.env' ) ] ) {
	if ( ! existsSync( candidate ) ) {
		continue;
	}

	for ( const line of readFileSync( candidate, 'utf8' ).split( '\n' ) ) {
		const match = line.match( /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/ );

		if ( match && process.env[ match[ 1 ] ] === undefined ) {
			process.env[ match[ 1 ] ] = match[ 2 ].replace( /^["']|["']$/g, '' );
		}
	}
}

const log = ( message = '' ) => process.stdout.write( `${ message }\n` );

const MARKERS = {
	'formularz logowania': '#username',
	'nawigacja panelu': '.navigation',
	'nagłówek strony': '#pageHeader',
	'kalendarz': '.calendar-slider-items',
	'karta dnia': '#dayDetailsCard',
	'lista posiłków': 'ul.dashboard-meals-list',
	'baner zgód': '#CybotCookiebotDialog',
};

const panelUrl = ( process.env.KV_PANEL_URL || '' ).replace( /\/+$/, '' );

if ( ! panelUrl || ! process.env.KV_PANEL_USER || ! process.env.KV_PANEL_PASSWORD ) {
	process.stderr.write( 'Brakuje KV_PANEL_URL, KV_PANEL_USER lub KV_PANEL_PASSWORD w agent/.env.\n' );
	process.exit( 1 );
}

const { withPanel } = await import( './panel-sync.mjs' );
const shot = join( process.cwd(), 'panel.png' );

async function report( page ) {
	log();
	log( `Adres strony:  ${ page.url() }` );
	log( `Tytuł:         ${ await page.title().catch( () => '?' ) }` );
	log( `Dzisiaj:       ${ new Date().toISOString().slice( 0, 10 ) }` );
	log();
	log( 'Co jest na stronie:' );

	for ( const [ name, selector ] of Object.entries( MARKERS ) ) {
		const count = await page.locator( selector ).count().catch( () => 0 );

		log( `  ${ count ? '✓' : '·' } ${ name.padEnd( 20 ) } ${ count || '' }` );
	}

	const calendar = await page.evaluate( extractDates ).catch( () => null );

	if ( calendar && calendar.days.length ) {
		log();
		log( `Kalendarz: ${ calendar.days.length } dni, otwarty ${ calendar.selected || '(żaden)' }` );
		log();
		log( 'data         etykieta    aktywny  wyłączony' );
		log( '────────────────────────────────────────────' );

		for ( const day of calendar.days ) {
			log(
				`${ day.date }   ${ ( day.label || '—' ).padEnd( 10 ) }  ` +
					`${ day.isActive ? 'tak' : 'nie' }      ${ day.isDisabled ? 'tak' : 'nie' }`
			);
		}

		const withMenu = calendar.days.filter( ( day ) => '' !== day.label || day.isActive );

		log();
		log( `Dni z jadłospisem do pobrania: ${ withMenu.length }` );

		if ( withMenu.length ) {
			log( `Podpowiedź: node agent/sync-to-calendar.mjs --from ${ withMenu[ 0 ].date } --to ${ withMenu[ withMenu.length - 1 ].date }` );
		}
	} else {
		log();
		log( 'Kalendarza nie ma na stronie. Oto co panel wyświetla:' );
		log( '───────────────────────────────────────────────────────' );

		const text = await page
			.locator( '.app-content, #app, body' )
			.first()
			.innerText()
			.catch( () => '' );

		log( text.replace( /\n{3,}/g, '\n\n' ).trim().slice( 0, 1200 ) || '(strona jest pusta)' );
		log( '───────────────────────────────────────────────────────' );
	}

	const current = await page.evaluate( extractDay ).catch( () => null );

	if ( current && current.meals.length ) {
		log();
		log( `Posiłki na otwartym dniu (${ current.date }):` );

		for ( const meal of current.meals ) {
			log( `  ${ meal.name }: ${ meal.description.slice( 0, 70 ) }` );
		}
	}

	// Proba otwarcia okna szczegolow pierwszego posilku - to najczestsze miejsce,
	// w ktorym odczyt sie zatrzymuje, a bez faktow mozna tylko zgadywac.
	const firstMeal = page.locator( 'ul.dashboard-meals-list > li.enhanced-meal-card' ).first();

	if ( 0 < ( await firstMeal.count().catch( () => 0 ) ) ) {
		log();
		log( 'Okno szczegółów posiłku (klikam w pierwsze danie):' );

		for ( const handle of [ '.meal-content', '.meal-nutritions', '.meal-header' ] ) {
			const target = firstMeal.locator( handle ).first();

			if ( 0 === ( await target.count().catch( () => 0 ) ) ) {
				log( `  · ${ handle.padEnd( 18 ) } brak takiego elementu` );
				continue;
			}

			await target.click( { timeout: 3000 } ).catch( () => {} );
			await page.waitForTimeout( 1500 );

			const found = await page.evaluate( () => ( {
				ingredients: Boolean( document.querySelector( '.details-ingredients' ) ),
				sidebar: ( ( document.querySelector( '#sideBar' ) || {} ).textContent || '' ).trim().length,
				dialogs: document.querySelectorAll( '[class*="max-h-"], [role="dialog"]' ).length,
			} ) );

			log(
				`  ${ found.ingredients ? '✓' : '·' } ${ handle.padEnd( 18 ) } ` +
					`składniki: ${ found.ingredients ? 'tak' : 'nie' }, ` +
					`#sideBar: ${ found.sidebar } znaków, okien: ${ found.dialogs }`
			);

			if ( found.ingredients ) {
				const details = await page.evaluate( extractSidebarDetails ).catch( () => ( {} ) );

				for ( const [ key, value ] of Object.entries( details ) ) {
					log( `      ${ key }: ${ String( value ).slice( 0, 80 ) }` );
				}

				break;
			}

			await page.keyboard.press( 'Escape' ).catch( () => {} );
			await page.waitForTimeout( 400 );
		}
	}

}

try {
	await withPanel(
		{
			panelUrl,
			user: process.env.KV_PANEL_USER,
			password: process.env.KV_PANEL_PASSWORD,
			headless: '0' !== process.env.KV_HEADLESS,
			sessionPath: join( HERE, '.session.json' ),
			log,
		},
		async ( page ) => {
			try {
				await report( page );
			} finally {
				// Zrzut robimy zawsze - to najczesciej najbardziej wymowny dowod.
				await page.screenshot( { path: shot, fullPage: true } ).catch( () => {} );
				log();
				log( `Zrzut ekranu: ${ shot }` );
			}
		}
	);
} catch ( error ) {
	process.stderr.write( `\nBłąd: ${ error.message }\n` );
	process.stderr.write( `Jeśli powstał zrzut ekranu, znajdziesz go w ${ shot }\n` );
	process.exitCode = 1;
}
