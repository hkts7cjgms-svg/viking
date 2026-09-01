/**
 * Testy odczytu szczegolow posilku i etykiety miesiaca - na fragmentach
 * prawdziwego HTML-a panelu, bez przegladarki.
 *
 * Uruchomienie: node tests/panel-details.test.mjs
 */
import { createRequire } from 'node:module';

import { extractSidebarDetails, extractMonthLabel } from '../agent/panel-scrape.mjs';

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

/** Funkcje czytaja globalny document - tak samo jak w przegladarce. */
function withDom( html, callback ) {
	global.document = new JSDOM( `<!doctype html><html><body>${ html }</body></html>` ).window.document;

	try {
		return callback();
	} finally {
		delete global.document;
	}
}

// --- okno szczegolow posilku (fragment 1:1 z panelu) --------------------
const MEAL_MODAL = `<div class="mac-scrollbar p-6 overflow-y-auto max-h-[90vh] bg-white rounded-lg">
	<div class="absolute top-4 right-[18px]" role="button"><i class="fal fa-times"></i></div>
	<div class="mb-6">
		<div class="_cold_1xxbd_53"><i class="fa fa-snowflake"></i>Na zimno</div>
		<div class="!body-l text-gray-500 mb-1">Śniadanie</div>
		<p class="!h200">Kanapka z chlebem wiejskim, pieczonym schabem i serem</p>
	</div>
	<div class="mb-4">
		<div class="!body-l text-gray-500 mb-1">Wartości odżywcze</div>
		<p class="font-medium text-[28px]">479 kcal / 2005 kJ</p>
	</div>
	<ul class="list-none p-0 m-0">
		<li class="flex flex-row"><span class="body-m w-1/2">Białko</span><span class="body-m w-1/2">46.7g</span></li>
		<li class="flex flex-row"><span class="body-m w-1/2">Tłuszcz</span><span class="body-m w-1/2">20.2g</span></li>
		<li class="flex flex-row"><span class="body-m w-1/2">Węglowodany</span><span class="body-m w-1/2">27.7g</span></li>
		<li class="flex flex-row"><span class="body-m w-1/2">Sól</span><span class="body-m w-1/2">1.6g</span></li>
	</ul>
	<div class="details-ingredients">
		<div class="!body-m mb-1">Składniki</div>
		<p class="!body-s"><span class="inline">Schab wieprzowy, </span><span class="inline font-medium">TWARÓG PÓŁTŁUSTY (MLEKO), </span><span class="inline">Pomidor, </span><span class="inline font-medium">CHLEB WIEJSKI (ZBOŻA ZAWIERAJĄCE GLUTEN), </span><span class="inline">Szczypiorek (świeży)</span></p>
	</div>
</div>`;

withDom( MEAL_MODAL, () => {
	const details = extractSidebarDetails();

	same( 'Na zimno', details[ 'Podanie' ], 'sposób podania odczytany' );
	same( '479 kcal / 2005 kJ', details[ 'Energia' ], 'energia odczytana' );
	same( '46.7g', details[ 'Białko' ], 'białko z tabeli wartości odżywczych' );
	same( '20.2g', details[ 'Tłuszcz' ], 'tłuszcz z tabeli' );
	same( '1.6g', details[ 'Sól' ], 'sól z tabeli' );

	same(
		'Schab wieprzowy, TWARÓG PÓŁTŁUSTY (MLEKO), Pomidor, CHLEB WIEJSKI (ZBOŻA ZAWIERAJĄCE GLUTEN), Szczypiorek (świeży)',
		details[ 'Składniki' ],
		'pełna lista składników bez końcowego przecinka'
	);

	// Panel wyróżnia alergeny grubszą czcionką - stąd je bierzemy.
	same(
		'TWARÓG PÓŁTŁUSTY (MLEKO), CHLEB WIEJSKI (ZBOŻA ZAWIERAJĄCE GLUTEN)',
		details[ 'Alergeny' ],
		'alergeny wyłuskane z wyróżnionych składników'
	);

	ok( ! ( 'Szczegóły' in details ), 'przy rozpoznanej strukturze nie ma surowego zrzutu' );
} );

// --- okno o nieznanej strukturze ----------------------------------------
withDom( '<div id="sideBar">Jakiś nierozpoznany opis dania</div>', () => {
	same(
		'Jakiś nierozpoznany opis dania',
		extractSidebarDetails()[ 'Szczegóły' ],
		'nieznana struktura daje surowy tekst zamiast pustki'
	);
} );

withDom( '<div>nic tu nie ma</div>', () => {
	same( 0, Object.keys( extractSidebarDetails() ).length, 'brak okna nie wywraca odczytu' );
} );

// --- etykieta miesiaca ---------------------------------------------------
withDom( '<h3 id="calendar-current-month">Wrzesień 2026</h3>', () => {
	same( 'Wrzesień 2026', extractMonthLabel(), 'etykieta miesiąca odczytana' );
} );

withDom( '<div></div>', () => {
	same( '', extractMonthLabel(), 'brak etykiety miesiąca nie wywraca odczytu' );
} );

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
