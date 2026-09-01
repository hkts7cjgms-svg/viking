#!/usr/bin/env node
/**
 * CLI do zarzadzania wydarzeniami przez REST API wtyczki.
 * Zero zaleznosci - wystarczy Node 18+.
 *
 * Konfiguracja (zmienne srodowiskowe albo plik .env obok tego skryptu):
 *
 *   KV_SITE_URL      https://kuchniavikinga.pl
 *   KV_USER          login uzytkownika WordPressa
 *   KV_APP_PASSWORD  haslo aplikacji (Uzytkownicy -> Profil -> Hasla aplikacji)
 *
 * Przyklady:
 *
 *   node agent/kv-events.mjs meta
 *   node agent/kv-events.mjs list --date 2026-09-15
 *   node agent/kv-events.mjs day 2026-09-15 --meal obiad --diet smart
 *   node agent/kv-events.mjs add --title "Dzień Kuchni Polskiej" \
 *        --from 2026-09-15 --to 2026-09-15 --meals obiad --body "Dziś obiad z pomysłem."
 *   node agent/kv-events.mjs edit 123 --priority 10
 *   node agent/kv-events.mjs rm 123 --force
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname( fileURLToPath( import.meta.url ) );

/** Wczytuje proste pary KLUCZ=wartosc z pliku .env, nie nadpisujac srodowiska. */
function loadDotEnv() {
	for ( const candidate of [ join( HERE, '.env' ), join( HERE, '..', '.env' ) ] ) {
		if ( ! existsSync( candidate ) ) {
			continue;
		}

		for ( const line of readFileSync( candidate, 'utf8' ).split( '\n' ) ) {
			const match = line.match( /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/ );

			if ( ! match || process.env[ match[ 1 ] ] !== undefined ) {
				continue;
			}

			process.env[ match[ 1 ] ] = match[ 2 ].replace( /^["']|["']$/g, '' );
		}
	}
}

loadDotEnv();

const CONFIG = {
	siteUrl: ( process.env.KV_SITE_URL || '' ).replace( /\/+$/, '' ),
	user: process.env.KV_USER || '',
	password: process.env.KV_APP_PASSWORD || '',
};

class ApiError extends Error {
	constructor( status, code, message ) {
		super( message );
		this.status = status;
		this.code = code;
	}
}

function requireConfig( needsAuth ) {
	if ( ! CONFIG.siteUrl ) {
		throw new Error( 'Brak KV_SITE_URL — ustaw adres strony (np. https://kuchniavikinga.pl).' );
	}

	if ( needsAuth && ( ! CONFIG.user || ! CONFIG.password ) ) {
		throw new Error( 'Brak KV_USER lub KV_APP_PASSWORD — zapis wymaga hasła aplikacji WordPressa.' );
	}
}

async function api( method, path, { query = {}, body = null, auth = false } = {} ) {
	requireConfig( auth );

	const url = new URL( `${ CONFIG.siteUrl }/wp-json/kv/v1${ path }` );

	for ( const [ key, value ] of Object.entries( query ) ) {
		if ( value !== undefined && value !== null && value !== '' ) {
			url.searchParams.set( key, String( value ) );
		}
	}

	const headers = { Accept: 'application/json' };

	if ( auth ) {
		// Hasło aplikacji WordPressa idzie przez Basic auth — dlatego adres musi być https.
		const token = Buffer.from( `${ CONFIG.user }:${ CONFIG.password }` ).toString( 'base64' );
		headers.Authorization = `Basic ${ token }`;
	}

	if ( body !== null ) {
		headers[ 'Content-Type' ] = 'application/json';
	}

	const response = await fetch( url, {
		method,
		headers,
		body: body === null ? undefined : JSON.stringify( body ),
	} );

	const text = await response.text();
	let payload = null;

	try {
		payload = text ? JSON.parse( text ) : null;
	} catch {
		throw new ApiError( response.status, 'kv_bad_json', `Odpowiedź nie jest JSON-em: ${ text.slice( 0, 200 ) }` );
	}

	if ( ! response.ok ) {
		const code = payload?.code || 'kv_http_error';
		const message = payload?.message || `HTTP ${ response.status }`;

		throw new ApiError( response.status, code, message );
	}

	return payload;
}

/** Pobiera kanal iCal jako surowy tekst - to jedyny endpoint, ktory nie zwraca JSON-a. */
async function fetchCalendar( query = {} ) {
	requireConfig( false );

	const url = new URL( `${ CONFIG.siteUrl }/wp-json/kv/v1/calendar.ics` );

	for ( const [ key, value ] of Object.entries( query ) ) {
		if ( value !== undefined && value !== null && value !== '' ) {
			url.searchParams.set( key, String( value ) );
		}
	}

	const response = await fetch( url, { headers: { Accept: 'text/calendar' } } );
	const text = await response.text();

	if ( ! response.ok ) {
		throw new ApiError( response.status, 'kv_http_error', `HTTP ${ response.status }` );
	}

	return text;
}

/** Parsuje --klucz wartosc oraz --flaga na obiekt. */
function parseArgs( argv ) {
	const positional = [];
	const flags = {};

	for ( let i = 0; i < argv.length; i++ ) {
		const token = argv[ i ];

		if ( ! token.startsWith( '--' ) ) {
			positional.push( token );
			continue;
		}

		const key = token.slice( 2 );
		const next = argv[ i + 1 ];

		if ( next === undefined || next.startsWith( '--' ) ) {
			flags[ key ] = true;
			continue;
		}

		flags[ key ] = next;
		i++;
	}

	return { positional, flags };
}

/** Zamienia flagi CLI na pola wydarzenia rozumiane przez API. */
function fieldsFromFlags( flags ) {
	const fields = {};
	const list = ( value ) =>
		String( value )
			.split( ',' )
			.map( ( item ) => item.trim() )
			.filter( Boolean );

	if ( flags.title !== undefined ) fields.title = String( flags.title );
	if ( flags.body !== undefined ) fields.body = String( flags.body );
	if ( flags.badge !== undefined ) fields.badge = String( flags.badge );
	if ( flags.from !== undefined ) fields.date_from = String( flags.from );
	if ( flags.to !== undefined ) fields.date_to = String( flags.to );
	if ( flags.meals !== undefined ) fields.meals = list( flags.meals );
	if ( flags.diets !== undefined ) fields.diets = list( flags.diets );
	if ( flags.weekdays !== undefined ) fields.weekdays = list( flags.weekdays ).map( Number );
	if ( flags.placement !== undefined ) fields.placement = String( flags.placement );
	if ( flags.priority !== undefined ) fields.priority = Number( flags.priority );
	if ( flags.status !== undefined ) fields.status = String( flags.status );

	return fields;
}

function printJson( value ) {
	process.stdout.write( `${ JSON.stringify( value, null, 2 ) }\n` );
}

function printTable( events ) {
	if ( ! Array.isArray( events ) || events.length === 0 ) {
		process.stdout.write( 'Brak wydarzeń.\n' );
		return;
	}

	for ( const event of events ) {
		const range =
			event.date_from || event.date_to
				? `${ event.date_from || '…' } → ${ event.date_to || '…' }`
				: 'zawsze';
		const meals = event.meals?.length ? event.meals.join( '/' ) : 'wszystkie posiłki';
		const diets = event.diets?.length ? event.diets.join( '/' ) : 'wszystkie diety';

		process.stdout.write( `#${ event.id }  ${ event.title }\n` );
		process.stdout.write( `        ${ range } · ${ meals } · ${ diets } · priorytet ${ event.priority }\n` );
	}
}

const USAGE = `kv-events — zarządzanie wydarzeniami Kuchni Vikinga

  meta                          słowniki: posiłki, diety, tryb wyświetlania
  list [--date|--from|--to] [--meal] [--diet] [--status] [--search]
  get <id>
  day <RRRR-MM-DD> [--meal] [--diet]     wydarzenia + gotowy HTML na dany dzień
  range <od> <do> [--meal] [--diet] [--all]   kalendarz dzień po dniu (--all = też puste dni)
  add --title "…" [--body|--from|--to|--meals|--diets|--weekdays|--badge|--priority|--placement|--status]
  edit <id> [te same flagi co add]
  rm <id> [--force]

  calendar [--meal] [--diet] [--out plik.ics]   kanał iCal do subskrypcji

  --json  wypisz surową odpowiedź API
`;

async function main() {
	const { positional, flags } = parseArgs( process.argv.slice( 2 ) );
	const command = positional[ 0 ];
	const raw = Boolean( flags.json );

	switch ( command ) {
		case 'meta':
			printJson( await api( 'GET', '/meta' ) );
			break;

		case 'list': {
			const events = await api( 'GET', '/events', {
				query: {
					date: flags.date,
					from: flags.from,
					to: flags.to,
					meal: flags.meal,
					diet: flags.diet,
					status: flags.status,
					search: flags.search,
				},
				auth: Boolean( flags.status ) && flags.status !== 'publish',
			} );

			raw ? printJson( events ) : printTable( events );
			break;
		}

		case 'get': {
			if ( ! positional[ 1 ] ) throw new Error( 'Podaj ID wydarzenia.' );

			printJson( await api( 'GET', `/events/${ Number( positional[ 1 ] ) }` ) );
			break;
		}

		case 'day': {
			const date = positional[ 1 ];

			if ( ! date ) throw new Error( 'Podaj datę w formacie RRRR-MM-DD.' );

			const result = await api( 'GET', `/day/${ date }`, {
				query: { meal: flags.meal, diet: flags.diet },
			} );

			if ( raw ) {
				printJson( result );
				break;
			}

			process.stdout.write( `${ result.date }: ${ result.count } wydarzeń\n` );
			printTable( result.events );
			break;
		}

		case 'range': {
			const from = positional[ 1 ];
			const to = positional[ 2 ];

			if ( ! from || ! to ) throw new Error( 'Podaj zakres: range <od> <do> (RRRR-MM-DD).' );

			const result = await api( 'GET', '/range', {
				query: {
					from,
					to,
					meal: flags.meal,
					diet: flags.diet,
					only_with_events: flags.all ? 'false' : 'true',
				},
			} );

			if ( raw ) {
				printJson( result );
				break;
			}

			if ( result.days.length === 0 ) {
				process.stdout.write( `Brak wydarzeń w zakresie ${ from } → ${ to }.\n` );
				break;
			}

			for ( const day of result.days ) {
				process.stdout.write( `\n${ day.date } (${ day.count })\n` );
				printTable( day.events );
			}
			break;
		}

		case 'calendar': {
			const ics = await fetchCalendar( { meal: flags.meal, diet: flags.diet } );

			if ( typeof flags.out === 'string' ) {
				const { writeFileSync } = await import( 'node:fs' );

				writeFileSync( flags.out, ics, 'utf8' );
				process.stdout.write( `Zapisano ${ flags.out } (${ ics.split( 'BEGIN:VEVENT' ).length - 1 } wydarzeń)\n` );
				break;
			}

			process.stdout.write( ics );
			break;
		}

		case 'add': {
			const fields = fieldsFromFlags( flags );

			if ( ! fields.title ) throw new Error( 'Wydarzenie musi mieć --title.' );

			const created = await api( 'POST', '/events', { body: fields, auth: true } );

			process.stdout.write( `Dodano #${ created.id }: ${ created.title }\n` );

			if ( raw ) printJson( created );
			break;
		}

		case 'edit': {
			const id = Number( positional[ 1 ] );

			if ( ! id ) throw new Error( 'Podaj ID wydarzenia.' );

			const fields = fieldsFromFlags( flags );

			if ( Object.keys( fields ).length === 0 ) throw new Error( 'Nie podano żadnego pola do zmiany.' );

			const updated = await api( 'PATCH', `/events/${ id }`, { body: fields, auth: true } );

			process.stdout.write( `Zapisano #${ updated.id }: ${ updated.title }\n` );

			if ( raw ) printJson( updated );
			break;
		}

		case 'rm': {
			const id = Number( positional[ 1 ] );

			if ( ! id ) throw new Error( 'Podaj ID wydarzenia.' );

			const result = await api( 'DELETE', `/events/${ id }`, {
				query: { force: flags.force ? 'true' : 'false' },
				auth: true,
			} );

			process.stdout.write(
				`${ result.forced ? 'Usunięto trwale' : 'Przeniesiono do kosza' } #${ id }: ${ result.previous.title }\n`
			);
			break;
		}

		default:
			process.stdout.write( USAGE );

			if ( command !== undefined && command !== 'help' ) {
				process.exitCode = 1;
			}
	}
}

main().catch( ( error ) => {
	process.stderr.write( `Błąd: ${ error.message }\n` );
	process.exitCode = 1;
} );
