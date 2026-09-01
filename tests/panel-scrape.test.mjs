/**
 * Test odczytu jadlospisu ze struktury panelu. Uruchomienie: node tests/panel-scrape.test.mjs
 */
import { createRequire } from 'node:module';

import { extractDates, extractDay } from '../agent/panel-scrape.mjs';
import { panelHtml } from './panel-fixture.mjs';

const require = createRequire( import.meta.url );

let JSDOM;

try {
	( { JSDOM } = require( 'jsdom' ) );
} catch {
	process.stdout.write( 'POMINIETE - brak jsdom. Zainstaluj: npm install\n' );
	process.exit( 0 );
}

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

/** Funkcje scrapera czytaja globalny document - tak samo jak w przegladarce. */
function withDom( html, callback ) {
	const dom = new JSDOM( html );

	global.document = dom.window.document;

	try {
		return callback( dom );
	} finally {
		delete global.document;
	}
}

// --- lista dni -----------------------------------------------------------
withDom( panelHtml(), () => {
	const result = extractDates();

	same( 3, result.dates.length, 'kalendarz oddaje wszystkie dni' );
	same( '2026-09-01', result.dates[ 0 ], 'dni są w kolejności z kalendarza' );
	same( '2026-09-02', result.selected, 'rozpoznany jest dzień zaznaczony' );
} );

withDom( panelHtml( { selectedDate: '2026-09-15' } ), () => {
	same( '2026-09-15', extractDates().selected, 'zmiana zaznaczenia jest widoczna' );
} );

withDom( '<!doctype html><html><body></body></html>', () => {
	const result = extractDates();

	same( 0, result.dates.length, 'pusta strona daje pustą listę' );
	same( null, result.selected, 'pusta strona nie ma zaznaczonego dnia' );
} );

// --- jadlospis dnia ------------------------------------------------------
withDom( panelHtml(), () => {
	const day = extractDay();

	same( '2026-09-02', day.date, 'dzień odczytany z kalendarza' );
	same( 3, day.meals.length, 'zebrane wszystkie posiłki' );

	same( '4204325', day.meals[ 0 ].id, 'identyfikator posiłku bez przedrostka' );
	same( 'sniadanie', day.meals[ 0 ].slug, 'slug śniadania' );
	same( 'Śniadanie', day.meals[ 0 ].name, 'nazwa bez nadmiarowych spacji' );
	same(
		'Kanapka z chlebem wiejskim, pieczonym schabem i serem',
		day.meals[ 0 ].description,
		'opis posiłku odczytany w całości'
	);
	same( '479kcal · B: 46.7g', day.meals[ 0 ].nutrition.join( ' · ' ), 'wartości odżywcze odczytane' );

	same( 'obiad', day.meals[ 1 ].slug, 'slug obiadu' );
	same( 'kolacja', day.meals[ 2 ].slug, 'slug kolacji' );
	ok( day.meals[ 2 ].description.includes( 'szarpaną wieprzowiną' ), 'polskie znaki w opisie przetrwały' );

	ok( day.summary.includes( '3 posiłki' ), 'podsumowanie dnia jest zbierane' );
} );

withDom( panelHtml( { selectedDate: '2026-09-15' } ), () => {
	same( '2026-09-15', extractDay().date, 'jadłospis dotyczy zaznaczonego dnia' );
} );

// Panel bez otwartego dnia - scraper ma oddac null, a nie sie wywrocic.
withDom(
	'<!doctype html><html><body><div class="calendar-slider-items"><div data-date="2026-09-02"><li class="day"></li></div></div></body></html>',
	() => {
		const day = extractDay();

		same( null, day.date, 'bez zaznaczonego dnia data jest pusta' );
		same( 0, day.meals.length, 'bez karty dnia nie ma posiłków' );
	}
);

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
