#!/usr/bin/env node
/**
 * Serwer MCP nad REST API wtyczki - dzieki niemu asystent (np. Claude)
 * dodaje, edytuje i usuwa wydarzenia sam, bez logowania sie do panelu.
 *
 * Zero zaleznosci: goly JSON-RPC 2.0 po stdio, zgodny z MCP.
 *
 * Konfiguracja przez zmienne srodowiskowe: KV_SITE_URL, KV_USER, KV_APP_PASSWORD.
 */

import { createInterface } from 'node:readline';

const CONFIG = {
	siteUrl: ( process.env.KV_SITE_URL || '' ).replace( /\/+$/, '' ),
	user: process.env.KV_USER || '',
	password: process.env.KV_APP_PASSWORD || '',
};

const PROTOCOL_VERSION = '2024-11-05';

async function api( method, path, { query = {}, body = null, auth = false } = {} ) {
	if ( ! CONFIG.siteUrl ) {
		throw new Error( 'Brak KV_SITE_URL w konfiguracji serwera MCP.' );
	}

	if ( auth && ( ! CONFIG.user || ! CONFIG.password ) ) {
		throw new Error( 'Zapis wymaga KV_USER i KV_APP_PASSWORD (hasło aplikacji WordPressa).' );
	}

	const url = new URL( `${ CONFIG.siteUrl }/wp-json/kv/v1${ path }` );

	for ( const [ key, value ] of Object.entries( query ) ) {
		if ( value !== undefined && value !== null && value !== '' ) {
			url.searchParams.set( key, String( value ) );
		}
	}

	const headers = { Accept: 'application/json' };

	if ( auth ) {
		headers.Authorization = `Basic ${ Buffer.from( `${ CONFIG.user }:${ CONFIG.password }` ).toString( 'base64' ) }`;
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
		throw new Error( `Odpowiedź nie jest JSON-em (HTTP ${ response.status }).` );
	}

	if ( ! response.ok ) {
		throw new Error( payload?.message || `HTTP ${ response.status }` );
	}

	return payload;
}

const eventFields = {
	title: { type: 'string', description: 'Tytuł wydarzenia.' },
	body: { type: 'string', description: 'Treść doklejana do opisu posiłku. Dozwolony prosty HTML.' },
	badge: { type: 'string', description: 'Krótka etykieta przed tytułem, np. emoji.' },
	date_from: { type: 'string', description: 'Pierwszy dzień obowiązywania, RRRR-MM-DD. Puste = od zawsze.' },
	date_to: { type: 'string', description: 'Ostatni dzień obowiązywania, RRRR-MM-DD. Puste = bez końca.' },
	weekdays: {
		type: 'array',
		items: { type: 'integer', minimum: 1, maximum: 7 },
		description: 'Dni tygodnia w zakresie dat: 1 = poniedziałek ... 7 = niedziela. Puste = wszystkie.',
	},
	meals: {
		type: 'array',
		items: { type: 'string' },
		description: 'Slugi posiłków, np. ["obiad"]. Puste = każdy posiłek danego dnia.',
	},
	diets: {
		type: 'array',
		items: { type: 'string' },
		description: 'Slugi diet, np. ["smart"]. Puste = wszystkie diety.',
	},
	placement: { type: 'string', enum: [ 'before', 'after' ], description: 'Nad czy pod opisem posiłku.' },
	priority: { type: 'integer', description: 'Wyższa liczba = wyżej, gdy jednego dnia wypada kilka wydarzeń.' },
	status: { type: 'string', enum: [ 'publish', 'draft' ], description: 'publish = widoczne na stronie.' },
};

const TOOLS = [
	{
		name: 'kv_meta',
		description: 'Zwraca słowniki wtyczki: dostępne slugi posiłków i diet, dzisiejszą datę, tryb wyświetlania. Wywołaj to najpierw, żeby poznać poprawne wartości meals i diets.',
		inputSchema: { type: 'object', properties: {} },
		handler: () => api( 'GET', '/meta' ),
	},
	{
		name: 'kv_list_events',
		description: 'Lista wydarzeń. Bez parametrów zwraca wszystkie opublikowane; z "date" tylko te obowiązujące danego dnia.',
		inputSchema: {
			type: 'object',
			properties: {
				date: { type: 'string', description: 'Obowiązujące tego dnia, RRRR-MM-DD.' },
				from: { type: 'string', description: 'Początek zakresu, RRRR-MM-DD.' },
				to: { type: 'string', description: 'Koniec zakresu, RRRR-MM-DD.' },
				meal: { type: 'string', description: 'Slug posiłku.' },
				diet: { type: 'string', description: 'Slug diety.' },
				status: { type: 'string', enum: [ 'publish', 'draft', 'any' ] },
				search: { type: 'string', description: 'Szukany tekst w tytule lub treści.' },
			},
		},
		handler: ( args ) =>
			api( 'GET', '/events', { query: args, auth: Boolean( args.status ) && args.status !== 'publish' } ),
	},
	{
		name: 'kv_get_day',
		description: 'Co pokaże się w opisach posiłków danego dnia — lista wydarzeń plus gotowy HTML. Użyj do podglądu przed i po zmianie.',
		inputSchema: {
			type: 'object',
			properties: {
				date: { type: 'string', description: 'Data RRRR-MM-DD.' },
				meal: { type: 'string', description: 'Slug posiłku.' },
				diet: { type: 'string', description: 'Slug diety.' },
			},
			required: [ 'date' ],
		},
		handler: ( args ) => api( 'GET', `/day/${ args.date }`, { query: { meal: args.meal, diet: args.diet } } ),
	},
	{
		name: 'kv_get_range',
		description: 'Kalendarz wydarzeń w zakresie dni — po jednym wpisie na dzień. Domyślnie pomija dni bez wydarzeń.',
		inputSchema: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Pierwszy dzień zakresu, RRRR-MM-DD.' },
				to: { type: 'string', description: 'Ostatni dzień zakresu, RRRR-MM-DD.' },
				meal: { type: 'string', description: 'Slug posiłku.' },
				diet: { type: 'string', description: 'Slug diety.' },
				only_with_events: { type: 'boolean', description: 'false = pokaż też dni puste.' },
			},
			required: [ 'from', 'to' ],
		},
		handler: ( args ) => api( 'GET', '/range', { query: args } ),
	},
	{
		name: 'kv_add_event',
		description: 'Dodaje wydarzenie. Wymaga tytułu; reszta pól opcjonalna.',
		inputSchema: {
			type: 'object',
			properties: eventFields,
			required: [ 'title' ],
		},
		handler: ( args ) => api( 'POST', '/events', { body: args, auth: true } ),
	},
	{
		name: 'kv_update_event',
		description: 'Zmienia istniejące wydarzenie. Podaj tylko te pola, które mają się zmienić — reszta zostaje bez zmian.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'integer', description: 'ID wydarzenia.' }, ...eventFields },
			required: [ 'id' ],
		},
		handler: ( { id, ...fields } ) => api( 'PATCH', `/events/${ id }`, { body: fields, auth: true } ),
	},
	{
		name: 'kv_delete_event',
		description: 'Usuwa wydarzenie. Domyślnie do kosza; force=true kasuje trwale.',
		inputSchema: {
			type: 'object',
			properties: {
				id: { type: 'integer', description: 'ID wydarzenia.' },
				force: { type: 'boolean', description: 'true = usuń trwale, pomijając kosz.' },
			},
			required: [ 'id' ],
		},
		handler: ( args ) =>
			api( 'DELETE', `/events/${ args.id }`, { query: { force: args.force ? 'true' : 'false' }, auth: true } ),
	},
];

const TOOL_MAP = new Map( TOOLS.map( ( tool ) => [ tool.name, tool ] ) );

function send( message ) {
	process.stdout.write( `${ JSON.stringify( message ) }\n` );
}

function reply( id, result ) {
	send( { jsonrpc: '2.0', id, result } );
}

function replyError( id, code, message ) {
	send( { jsonrpc: '2.0', id, error: { code, message } } );
}

async function handle( request ) {
	const { id, method, params } = request;

	// Powiadomienia (bez id) nie dostaja odpowiedzi.
	const isNotification = id === undefined || id === null;

	switch ( method ) {
		case 'initialize':
			return reply( id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: 'kuchnia-vikinga-wydarzenia', version: '1.0.0' },
			} );

		case 'notifications/initialized':
			return;

		case 'tools/list':
			return reply(
				id,
				{
					tools: TOOLS.map( ( { name, description, inputSchema } ) => ( { name, description, inputSchema } ) ),
				}
			);

		case 'tools/call': {
			const tool = TOOL_MAP.get( params?.name );

			if ( ! tool ) {
				return replyError( id, -32602, `Nieznane narzędzie: ${ params?.name }` );
			}

			try {
				const result = await tool.handler( params.arguments || {} );

				return reply( id, {
					content: [ { type: 'text', text: JSON.stringify( result, null, 2 ) } ],
				} );
			} catch ( error ) {
				// Blad narzedzia wraca jako tresc z isError, nie jako blad protokolu.
				return reply( id, {
					content: [ { type: 'text', text: `Błąd: ${ error.message }` } ],
					isError: true,
				} );
			}
		}

		default:
			if ( ! isNotification ) {
				replyError( id, -32601, `Nieobsługiwana metoda: ${ method }` );
			}
	}
}

const reader = createInterface( { input: process.stdin } );

reader.on( 'line', ( line ) => {
	const trimmed = line.trim();

	if ( '' === trimmed ) {
		return;
	}

	let request;

	try {
		request = JSON.parse( trimmed );
	} catch {
		return replyError( null, -32700, 'Niepoprawny JSON.' );
	}

	handle( request ).catch( ( error ) => replyError( request.id ?? null, -32603, error.message ) );
} );
