/**
 * Test zapisu do Arkuszy Google. Uruchomienie: node tests/sheets.test.mjs
 *
 * Zadne zapytanie nie wychodzi na siec - fetch jest podmieniony na atrape,
 * ktora zapamietuje, co klient wyslal.
 */

import { createSheetsClient, saveToSheet, rowsFromValues, valuesFromRows, SHEETS_SCOPE } from '../agent/sheets.mjs';
import { createTokenSource } from '../agent/google-calendar.mjs';
import { COLUMNS } from '../agent/archive.mjs';

let passed = 0;
const failures = [];

function ok( condition, label ) {
	condition ? passed++ : failures.push( label );
}

function same( expected, actual, label ) {
	if ( expected === actual ) {
		passed++;
		return;
	}

	failures.push( `${ label }\n    oczekiwano: ${ JSON.stringify( expected ) }\n    otrzymano:  ${ JSON.stringify( actual ) }` );
}

/** Atrapa Arkuszy: trzyma jedna zakladke w pamieci i notuje zapytania. */
function fakeSheets( { values = [], tabs = [ 'Jadłospis' ] } = {} ) {
	const calls = [];
	let stored = values;

	const reply = ( body ) => ( {
		ok: true,
		status: 200,
		json: async () => body,
	} );

	async function fetchImpl( url, options = {} ) {
		// Zapytanie o token idzie formularzem, reszta JSON-em.
		const body = options.body && options.body.startsWith( '{' ) ? JSON.parse( options.body ) : null;

		calls.push( { url, method: options.method || 'GET', body } );

		if ( url.includes( 'oauth2' ) || url.includes( 'token' ) ) {
			return reply( { access_token: 'token-testowy', expires_in: 3600 } );
		}

		if ( url.includes( '/values/' ) && 'PUT' === options.method ) {
			stored = JSON.parse( options.body ).values;

			return reply( { updatedRows: stored.length } );
		}

		if ( url.includes( '/values/' ) ) {
			return reply( { values: stored } );
		}

		if ( url.includes( ':batchUpdate' ) ) {
			tabs.push( JSON.parse( options.body ).requests[ 0 ].addSheet.properties.title );

			return reply( {} );
		}

		if ( 'POST' === options.method ) {
			return reply( { spreadsheetId: 'nowy-arkusz-123' } );
		}

		return reply( { sheets: tabs.map( ( title ) => ( { properties: { title } } ) ) } );
	}

	return {
		calls,
		get stored() {
			return stored;
		},
		client: createSheetsClient( {
			clientId: 'id',
			clientSecret: 'sekret',
			refreshToken: 'odswiezacz',
			fetch: fetchImpl,
		} ),
	};
}

const day = ( date, diet, meals ) => ( {
	date,
	diet,
	meals: meals.map( ( [ slug, name, description ] ) => ( {
		slug,
		name,
		description,
		nutrition: [ '479kcal' ],
		details: {},
	} ) ),
} );

const wednesday = day( '2026-09-02', 'Smart 1500', [
	[ 'sniadanie', 'Śniadanie', 'Kanapka z serem' ],
	[ 'obiad', 'Obiad', 'Pierogi' ],
] );

// --- wiersze w obie strony ----------------------------------------------
{
	const values = valuesFromRows( [ { data: '2026-09-02', dieta: 'Smart', posilek: 'obiad', opis: 'Pierogi' } ] );

	same( COLUMNS.join( ',' ), values[ 0 ].join( ',' ), 'pierwszy wiersz to nagłówek z kolumnami archiwum' );
	same( '2026-09-02', values[ 1 ][ 0 ], 'data trafia do pierwszej kolumny' );
	same( 'Smart', values[ 1 ][ 1 ], 'dieta trafia do drugiej kolumny' );

	const rows = rowsFromValues( values );

	same( 1, rows.length, 'nagłówek nie jest wierszem danych' );
	same( 'Pierogi', rows[ 0 ].opis, 'opis wraca w całości' );
	same( '', rows[ 0 ].kcal, 'brakująca komórka to pusty tekst, nie undefined' );
	same( 0, rowsFromValues( [] ).length, 'pusty arkusz daje pustą listę' );
}

// --- pierwszy zapis ------------------------------------------------------
{
	const fake = fakeSheets( { values: [] } );
	const report = await saveToSheet( fake.client, [ wednesday ], {
		spreadsheetId: 'arkusz-1',
		now: '2026-09-01T08:00:00Z',
	} );

	same( 0, report.before, 'na początku arkusz jest pusty' );
	same( 2, report.after, 'oba posiłki zapisane' );
	same( 2, report.added, 'oba policzone jako dopisane' );
	ok( report.url.includes( 'arkusz-1' ), 'raport niesie adres arkusza' );
	same( COLUMNS.length, fake.stored[ 0 ].length, 'w arkuszu wylądował pełny nagłówek' );
	same( 'Smart 1500', fake.stored[ 1 ][ 1 ], 'nazwa diety zapisana przy posiłku' );

	const put = fake.calls.filter( ( call ) => 'PUT' === call.method );

	same( 1, put.length, 'zapis idzie jednym zapytaniem, nie po wierszu' );
	ok( put[ 0 ].url.includes( 'valueInputOption=RAW' ), 'wartości idą surowo, bez interpretacji przez Arkusze' );
}

// --- nic nie znika -------------------------------------------------------
{
	const fake = fakeSheets( {
		values: [
			COLUMNS,
			[ '2026-07-01', '', 'obiad', 'Obiad', 'Notatka ręczna', '', '', '', '', '', '', '2026-07-01T00:00:00Z' ],
		],
	} );

	const report = await saveToSheet( fake.client, [ wednesday ], {
		spreadsheetId: 'arkusz-1',
		now: '2026-09-01T08:00:00Z',
	} );

	same( 1, report.before, 'stary wiersz policzony' );
	same( 3, report.after, 'stary wiersz został, doszły dwa nowe' );
	ok(
		fake.stored.some( ( row ) => 'Notatka ręczna' === row[ 4 ] ),
		'ręcznie dopisany wiersz przetrwał synchronizację'
	);
}

// --- ten sam jadlospis drugi raz ----------------------------------------
{
	const fake = fakeSheets( { values: [] } );

	await saveToSheet( fake.client, [ wednesday ], { spreadsheetId: 'arkusz-1', now: '2026-09-01T08:00:00Z' } );

	const report = await saveToSheet( fake.client, [ wednesday ], {
		spreadsheetId: 'arkusz-1',
		now: '2026-09-05T08:00:00Z',
	} );

	same( 2, report.after, 'powtórka nie mnoży wierszy' );
	same( 0, report.added, 'nic nowego nie doszło' );
	same( '2026-09-01T08:00:00Z', fake.stored[ 1 ][ 11 ], 'niezmieniony posiłek zachowuje stary znacznik czasu' );
}

// --- proba na sucho ------------------------------------------------------
{
	const fake = fakeSheets( { values: [] } );
	const report = await saveToSheet( fake.client, [ wednesday ], { spreadsheetId: 'arkusz-1', dryRun: true } );

	same( 2, report.after, 'raport mówi, co by się stało' );
	same( 0, fake.calls.filter( ( call ) => 'PUT' === call.method ).length, 'na sucho nic nie zapisujemy' );
}

// --- brakujaca zakladka i brakujacy numer arkusza ------------------------
{
	const fake = fakeSheets( { values: [], tabs: [ 'Arkusz1' ] } );

	await saveToSheet( fake.client, [ wednesday ], { spreadsheetId: 'arkusz-1', sheetName: 'Jadłospis' } );

	ok(
		fake.calls.some( ( call ) => call.url.includes( ':batchUpdate' ) ),
		'brakująca zakładka zakłada się sama'
	);
}

{
	let message = '';

	try {
		await saveToSheet( fakeSheets().client, [ wednesday ], {} );
	} catch ( error ) {
		message = error.message;
	}

	ok( message.includes( 'GOOGLE_SHEET_ID' ), 'bez numeru arkusza dostajemy zrozumiały błąd' );
}

// --- zakladanie nowego arkusza ------------------------------------------
{
	const fake = fakeSheets();
	const id = await fake.client.create( 'Kuchnia Vikinga — jadłospis', 'Jadłospis' );

	same( 'nowy-arkusz-123', id, 'zakładanie arkusza oddaje jego numer' );
}

// --- token: jedno pobranie na serie zapytan ------------------------------
{
	let tokens = 0;

	const token = createTokenSource(
		{
			clientId: 'id',
			clientSecret: 'sekret',
			refreshToken: 'odswiezacz',
			fetch: async () => {
				tokens++;

				return { ok: true, status: 200, json: async () => ( { access_token: `t${ tokens }`, expires_in: 3600 } ) };
			},
		},
		SHEETS_SCOPE
	);

	same( 't1', await token(), 'pierwsze wywołanie pobiera token' );
	same( 't1', await token(), 'kolejne korzystają z zapamiętanego' );
	same( 1, tokens, 'jedno zapytanie o token na całą serię' );
}

{
	let message = '';

	try {
		await createTokenSource( { fetch: async () => ( {} ) } )();
	} catch ( error ) {
		message = error.message;
	}

	ok( message.includes( 'uwierzytelniaj' ), 'bez danych logowania dostajemy zrozumiały błąd' );
}

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
