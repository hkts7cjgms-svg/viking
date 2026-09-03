/**
 * Zapis jadlospisu do Arkuszy Google.
 *
 * Zasada ta sama co w archiwum CSV i w kalendarzu: NIC NIE ZNIKA. Kolejne
 * uruchomienia dopisuja nowe wiersze i aktualizuja zmienione, ale nigdy nie
 * kasuja tego, co juz w arkuszu jest - takze wierszy dopisanych recznie.
 */

import { createTokenSource } from './google-calendar.mjs';
import { COLUMNS, toRows, mergeRows } from './archive.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class SheetsError extends Error {}

/**
 * @param {object} config Dane uwierzytelniajace + fetch do podmiany w testach.
 */
export function createSheetsClient( config ) {
	const token = createTokenSource( config, SHEETS_SCOPE );
	const fetchImpl = config.fetch || globalThis.fetch;

	async function call( path, { method = 'GET', body = null, query = {} } = {} ) {
		const url = new URL( `${ config.apiBase || API }${ path }` );

		for ( const [ key, value ] of Object.entries( query ) ) {
			if ( value !== undefined && value !== null && '' !== value ) {
				url.searchParams.set( key, String( value ) );
			}
		}

		const response = await fetchImpl( url.toString(), {
			method,
			headers: {
				Authorization: `Bearer ${ await token() }`,
				'Content-Type': 'application/json',
			},
			body: body ? JSON.stringify( body ) : undefined,
		} );

		const data = await response.json().catch( () => null );

		if ( ! response.ok ) {
			throw new SheetsError( `Arkusze Google: ${ data?.error?.message || response.status }` );
		}

		return data;
	}

	return {
		/** Tworzy nowy arkusz i oddaje jego identyfikator. */
		async create( title, sheetName ) {
			const created = await call( '', {
				method: 'POST',
				body: {
					properties: { title },
					sheets: [ { properties: { title: sheetName } } ],
				},
			} );

			return created.spreadsheetId;
		},

		/** Nazwy zakladek w arkuszu. */
		async tabs( spreadsheetId ) {
			const meta = await call( `/${ spreadsheetId }`, { query: { fields: 'sheets.properties.title' } } );

			return ( meta.sheets || [] ).map( ( sheet ) => sheet.properties.title );
		},

		/** Zaklada zakladke, jesli jeszcze jej nie ma. */
		async ensureTab( spreadsheetId, sheetName ) {
			if ( ( await this.tabs( spreadsheetId ) ).includes( sheetName ) ) {
				return false;
			}

			await call( `/${ spreadsheetId }:batchUpdate`, {
				method: 'POST',
				body: { requests: [ { addSheet: { properties: { title: sheetName } } } ] },
			} );

			return true;
		},

		/** Wszystkie wartosci z zakladki, razem z wierszem naglowka. */
		async read( spreadsheetId, sheetName ) {
			const data = await call( `/${ spreadsheetId }/values/${ encodeURIComponent( sheetName ) }`, {
				query: { majorDimension: 'ROWS' },
			} );

			return data.values || [];
		},

		/** Nadpisuje zakladke podanymi wierszami. */
		async write( spreadsheetId, sheetName, values ) {
			return call( `/${ spreadsheetId }/values/${ encodeURIComponent( `${ sheetName }!A1` ) }`, {
				method: 'PUT',
				query: { valueInputOption: 'RAW' },
				body: { values },
			} );
		},
	};
}

/**
 * Zamienia surowe wiersze arkusza na obiekty, po naglowku z pierwszego wiersza.
 *
 * @param {string[][]} values Wartosci z arkusza.
 *
 * @returns {object[]}
 */
export function rowsFromValues( values ) {
	if ( ! Array.isArray( values ) || 0 === values.length ) {
		return [];
	}

	const header = values[ 0 ];

	return values.slice( 1 ).map( ( row ) => {
		const object = {};

		header.forEach( ( column, index ) => {
			object[ column ] = row[ index ] ?? '';
		} );

		return object;
	} );
}

/**
 * Zamienia obiekty na wiersze arkusza, z naglowkiem na gorze.
 *
 * @param {object[]} rows Wiersze.
 *
 * @returns {string[][]}
 */
export function valuesFromRows( rows ) {
	return [ COLUMNS, ...rows.map( ( row ) => COLUMNS.map( ( column ) => String( row[ column ] ?? '' ) ) ) ];
}

/**
 * Dopisuje dni jadlospisu do arkusza.
 *
 * @param {object} client Klient z createSheetsClient().
 * @param {Array}  days   Dni jadlospisu.
 * @param {object} opts   { spreadsheetId, sheetName, now, dryRun }
 */
export async function saveToSheet( client, days, opts = {} ) {
	const sheetName = opts.sheetName || 'Jadłospis';
	const spreadsheetId = opts.spreadsheetId;

	if ( ! spreadsheetId ) {
		throw new SheetsError( 'Brak GOOGLE_SHEET_ID — podaj identyfikator arkusza albo utwórz go poleceniem `npm run sheet:create`.' );
	}

	await client.ensureTab( spreadsheetId, sheetName );

	const existing = rowsFromValues( await client.read( spreadsheetId, sheetName ) );
	const merged = mergeRows( existing, toRows( days, opts.now ) );

	if ( ! opts.dryRun ) {
		await client.write( spreadsheetId, sheetName, valuesFromRows( merged ) );
	}

	return {
		before: existing.length,
		after: merged.length,
		added: merged.length - existing.length,
		url: `https://docs.google.com/spreadsheets/d/${ spreadsheetId }`,
	};
}
