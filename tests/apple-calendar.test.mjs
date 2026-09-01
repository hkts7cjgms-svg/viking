/**
 * Test budowania wpisów dla Kalendarza Apple. Uruchomienie: node tests/apple-calendar.test.mjs
 *
 * Sam zapis do Calendar.app wymaga macOS - tutaj sprawdzamy to, co liczy Node.
 */
import { buildEntries, isSupported, syncToAppleCalendar, DEFAULT_CALENDAR } from '../agent/apple-calendar.mjs';

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

const day = ( date, meals ) => ( {
	date,
	meals: meals.map( ( [ name, description, kcal ] ) => ( {
		slug: name.toLowerCase(),
		name,
		description,
		nutrition: [ `${ kcal }kcal` ],
		details: {},
	} ) ),
} );

const wednesday = day( '2026-09-02', [
	[ 'Śniadanie', 'Kanapka z chlebem wiejskim', 479 ],
	[ 'Obiad', 'Pierogi z ziemniakami', 589 ],
] );

// --- budowa wpisow -------------------------------------------------------
{
	const entries = buildEntries( [ wednesday ], { title: 'Jadłospis' } );

	same( 1, entries.length, 'jeden dzień to jeden wpis' );
	same( '2026-09-02', entries[ 0 ].date, 'wpis niesie datę' );
	same( 'Jadłospis · 2026-09-02', entries[ 0 ].summary, 'tytuł wpisu zawiera datę' );
	ok( entries[ 0 ].description.includes( 'ŚNIADANIE' ), 'opis zawiera nagłówek posiłku' );
	ok( entries[ 0 ].description.includes( 'Pierogi z ziemniakami' ), 'opis zawiera drugi posiłek' );
	ok( /^[0-9a-f]{16}$/.test( entries[ 0 ].hash ), 'wpis ma skrót treści' );
}

// --- skrot rozpoznaje zmiane, a nie samo ponowne uruchomienie ------------
{
	const first = buildEntries( [ wednesday ], { title: 'Jadłospis' } )[ 0 ];
	const again = buildEntries( [ wednesday ], { title: 'Jadłospis' } )[ 0 ];

	same( first.hash, again.hash, 'ta sama treść daje ten sam skrót' );

	const changed = buildEntries(
		[ day( '2026-09-02', [ [ 'Śniadanie', 'Owsianka z owocami', 420 ] ] ) ],
		{ title: 'Jadłospis' }
	)[ 0 ];

	ok( first.hash !== changed.hash, 'zmiana jadłospisu zmienia skrót' );
}

// --- dni bez posilkow ----------------------------------------------------
same( 0, buildEntries( [ { date: '2026-09-05', meals: [] } ] ).length, 'dzień bez posiłków jest pomijany' );
same( 0, buildEntries( [] ).length, 'pusta lista dni daje brak wpisów' );
same( 0, buildEntries( undefined ).length, 'brak danych nie wywraca funkcji' );

// --- domyslna nazwa kalendarza ------------------------------------------
same( 'Jadłospis', DEFAULT_CALENDAR, 'domyślny kalendarz nazywa się Jadłospis' );

// --- poza macOS ----------------------------------------------------------
if ( ! isSupported() ) {
	let message = '';

	try {
		await syncToAppleCalendar( [ wednesday ] );
	} catch ( error ) {
		message = error.message;
	}

	ok( message.includes( 'macOS' ), 'poza macOS pada zrozumiały komunikat, nie wyjątek osascript' );
} else {
	passed++;
}

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
