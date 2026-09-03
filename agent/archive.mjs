/**
 * Archiwum jadlospisu: kazdy pobrany dzien laduje w pliku CSV, ktory otwiera sie
 * wprost w Numbers, Excelu i Arkuszach Google.
 *
 * Zasada jest ta sama co w kalendarzu: NIC NIE ZNIKA. Kolejne uruchomienia
 * dopisuja nowe dni i aktualizuja zmienione, ale nigdy nie kasuja wierszy -
 * nawet gdy dzien wypadnie z panelu.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const COLUMNS = [
	'data',
	'dieta',
	'posilek',
	'nazwa',
	'opis',
	'kcal',
	'bialko_g',
	'wegle_g',
	'tluszcz_g',
	'skladniki',
	'alergeny',
	'zaktualizowano',
];

/**
 * Rozbija ["479kcal", "B: 46.7g", "W: 27.7g", "T: 20.2g"] na osobne pola.
 *
 * @param {string[]} items Elementy podsumowania z panelu.
 */
export function parseNutrition( items ) {
	const out = { kcal: '', protein: '', carbs: '', fat: '' };

	for ( const raw of items || [] ) {
		const item = String( raw ).replace( /\s+/g, ' ' ).trim();
		const kcal = item.match( /^([\d.,]+)\s*kcal$/i );

		if ( kcal ) {
			out.kcal = kcal[ 1 ].replace( ',', '.' );
			continue;
		}

		const macro = item.match( /^([BWT])\s*:\s*([\d.,]+)\s*g$/i );

		if ( ! macro ) {
			continue;
		}

		const value = macro[ 2 ].replace( ',', '.' );

		if ( 'b' === macro[ 1 ].toLowerCase() ) {
			out.protein = value;
		} else if ( 'w' === macro[ 1 ].toLowerCase() ) {
			out.carbs = value;
		} else {
			out.fat = value;
		}
	}

	return out;
}

/**
 * Dni jadlospisu na plaskie wiersze - jeden wiersz to jeden posilek.
 *
 * @param {Array}  days Dni.
 * @param {string} now  Znacznik czasu aktualizacji.
 */
export function toRows( days, now = new Date().toISOString() ) {
	const rows = [];

	for ( const day of days || [] ) {
		if ( ! day?.date ) {
			continue;
		}

		for ( const meal of day.meals || [] ) {
			const nutrition = parseNutrition( meal.nutrition );

			rows.push( {
				data: day.date,
				// Publiczna strona ma wiele diet; panel klienta tylko jedna - stad puste.
				dieta: day.diet || '',
				posilek: meal.slug || '',
				nazwa: meal.name || '',
				opis: meal.description || '',
				kcal: nutrition.kcal,
				bialko_g: nutrition.protein,
				wegle_g: nutrition.carbs,
				tluszcz_g: nutrition.fat,
				skladniki: meal.details?.[ 'Składniki' ] || '',
				alergeny: meal.details?.[ 'Alergeny' ] || '',
				zaktualizowano: now,
			} );
		}
	}

	return rows;
}

/** Klucz wiersza: jeden posilek danego dnia w danej diecie. */
function rowKey( row ) {
	return `${ row.data }|${ row.dieta ?? '' }|${ row.posilek }`;
}

/**
 * Laczy archiwum z nowymi danymi. Wiersze nieobecne w nowej porcji ZOSTAJA.
 * Zmienione sa nadpisywane, identyczne zachowuja stary znacznik czasu, zeby
 * kolumna "zaktualizowano" mowila, kiedy tresc faktycznie sie zmienila.
 *
 * @param {Array} existing Wiersze z pliku.
 * @param {Array} incoming Wiersze z tego przebiegu.
 */
export function mergeRows( existing, incoming ) {
	const merged = new Map();

	for ( const row of existing || [] ) {
		merged.set( rowKey( row ), row );
	}

	for ( const row of incoming || [] ) {
		const key = rowKey( row );
		const previous = merged.get( key );

		if ( previous && unchanged( previous, row ) ) {
			continue;
		}

		merged.set( key, row );
	}

	return [ ...merged.values() ].sort( ( a, b ) => {
		const byDate = String( a.data ).localeCompare( String( b.data ) );

		if ( 0 !== byDate ) {
			return byDate;
		}

		const byDiet = String( a.dieta ?? '' ).localeCompare( String( b.dieta ?? '' ) );

		return 0 !== byDiet ? byDiet : String( a.posilek ).localeCompare( String( b.posilek ) );
	} );
}

function unchanged( previous, next ) {
	return COLUMNS.filter( ( column ) => 'zaktualizowano' !== column ).every(
		( column ) => String( previous[ column ] ?? '' ) === String( next[ column ] ?? '' )
	);
}

/** Pole CSV: cudzyslowy tylko gdy trzeba, wewnetrzne podwajane. */
function csvField( value ) {
	const text = String( value ?? '' );

	return /[",\n\r]/.test( text ) ? `"${ text.replace( /"/g, '""' ) }"` : text;
}

export function toCsv( rows ) {
	const lines = [ COLUMNS.join( ',' ) ];

	for ( const row of rows ) {
		lines.push( COLUMNS.map( ( column ) => csvField( row[ column ] ) ).join( ',' ) );
	}

	return `${ lines.join( '\n' ) }\n`;
}

/**
 * Parser CSV radzacy sobie z przecinkami i cudzyslowami w opisach posilkow.
 */
export function parseCsv( text ) {
	const rows = [];
	let field = '';
	let record = [];
	let quoted = false;

	const pushField = () => {
		record.push( field );
		field = '';
	};

	const pushRecord = () => {
		pushField();

		if ( record.length > 1 || '' !== record[ 0 ] ) {
			rows.push( record );
		}

		record = [];
	};

	for ( let i = 0; i < text.length; i++ ) {
		const char = text[ i ];

		if ( quoted ) {
			if ( '"' === char ) {
				if ( '"' === text[ i + 1 ] ) {
					field += '"';
					i++;
					continue;
				}

				quoted = false;
				continue;
			}

			field += char;
			continue;
		}

		if ( '"' === char && '' === field ) {
			quoted = true;
			continue;
		}

		if ( ',' === char ) {
			pushField();
			continue;
		}

		if ( '\n' === char ) {
			pushRecord();
			continue;
		}

		if ( '\r' === char ) {
			continue;
		}

		field += char;
	}

	if ( '' !== field || record.length ) {
		pushRecord();
	}

	if ( 0 === rows.length ) {
		return [];
	}

	const header = rows[ 0 ];

	return rows.slice( 1 ).map( ( values ) => {
		const row = {};

		header.forEach( ( column, index ) => {
			row[ column ] = values[ index ] ?? '';
		} );

		return row;
	} );
}

/**
 * Dopisuje dni do archiwum na dysku i oddaje raport.
 *
 * @param {string} path Sciezka do pliku CSV.
 * @param {Array}  days Dni jadlospisu.
 * @param {object} opts { now, json }
 */
export function saveArchive( path, days, opts = {} ) {
	const existing = existsSync( path ) ? parseCsv( readFileSync( path, 'utf8' ) ) : [];
	const incoming = toRows( days, opts.now );
	const merged = mergeRows( existing, incoming );

	writeFileSync( path, toCsv( merged ), 'utf8' );

	if ( opts.json ) {
		writeFileSync( opts.json, JSON.stringify( merged, null, 2 ), 'utf8' );
	}

	return {
		before: existing.length,
		after: merged.length,
		added: merged.length - existing.length,
		path,
	};
}
