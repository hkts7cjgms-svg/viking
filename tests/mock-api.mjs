/**
 * Atrapa REST API wtyczki - sluzy do testu CLI bez stawiania WordPressa.
 */
import { createServer } from 'node:http';

const events = new Map();
let nextId = 100;

function json( res, status, payload ) {
	const body = JSON.stringify( payload );
	res.writeHead( status, { 'Content-Type': 'application/json' } );
	res.end( body );
}

function normalize( id, fields ) {
	return {
		id,
		status: fields.status || 'publish',
		title: fields.title || '',
		body: fields.body || '',
		badge: fields.badge || '',
		date_from: fields.date_from || null,
		date_to: fields.date_to || null,
		weekdays: fields.weekdays || [],
		meals: fields.meals || [],
		diets: fields.diets || [],
		placement: fields.placement || 'after',
		priority: fields.priority ?? 0,
	};
}

export function startMockApi() {
	const server = createServer( ( req, res ) => {
		const url = new URL( req.url, 'http://localhost' );
		const path = url.pathname.replace( '/wp-json/kv/v1', '' );
		const authed = ( req.headers.authorization || '' ).startsWith( 'Basic ' );

		let raw = '';
		req.on( 'data', ( chunk ) => ( raw += chunk ) );
		req.on( 'end', () => {
			const payload = raw ? JSON.parse( raw ) : {};

			if ( path === '/meta' ) {
				return json( res, 200, { version: '1.0.0', meals: [ { slug: 'obiad', label: 'Obiad' } ], diets: [ 'smart' ] } );
			}

			if ( path === '/events' && req.method === 'GET' ) {
				return json( res, 200, [ ...events.values() ] );
			}

			if ( path === '/events' && req.method === 'POST' ) {
				if ( ! authed ) return json( res, 401, { code: 'kv_forbidden', message: 'Brak autoryzacji.' } );

				const event = normalize( nextId++, payload );
				events.set( event.id, event );

				return json( res, 201, event );
			}

			const match = path.match( /^\/events\/(\d+)$/ );

			if ( match ) {
				const id = Number( match[ 1 ] );
				const existing = events.get( id );

				if ( ! existing ) return json( res, 404, { code: 'kv_not_found', message: 'Nie znaleziono wydarzenia.' } );

				if ( req.method === 'DELETE' ) {
					events.delete( id );

					return json( res, 200, { deleted: true, forced: url.searchParams.get( 'force' ) === 'true', previous: existing } );
				}

				if ( req.method === 'GET' ) return json( res, 200, existing );

				const updated = { ...existing, ...payload };
				events.set( id, updated );

				return json( res, 200, updated );
			}

			if ( path === '/range' ) {
				const from = url.searchParams.get( 'from' );
				const to = url.searchParams.get( 'to' );
				const onlyUsed = url.searchParams.get( 'only_with_events' ) !== 'false';
				const days = [];

				for ( let d = new Date( `${ from }T00:00:00Z` ); d <= new Date( `${ to }T00:00:00Z` ); d.setUTCDate( d.getUTCDate() + 1 ) ) {
					const date = d.toISOString().slice( 0, 10 );
					const matched = [ ...events.values() ].filter(
						( event ) => ( ! event.date_from || event.date_from <= date ) && ( ! event.date_to || event.date_to >= date )
					);

					if ( onlyUsed && matched.length === 0 ) continue;

					days.push( { date, count: matched.length, events: matched } );
				}

				return json( res, 200, { from, to, days } );
			}

			const day = path.match( /^\/day\/(\d{4}-\d{2}-\d{2})$/ );

			if ( day ) {
				const matched = [ ...events.values() ].filter(
					( event ) => ! event.date_from || event.date_from <= day[ 1 ]
				);

				return json( res, 200, { date: day[ 1 ], count: matched.length, events: matched, html: '<div class="kv-wydarzenia"></div>' } );
			}

			return json( res, 404, { code: 'kv_no_route', message: 'Brak trasy.' } );
		} );
	} );

	return new Promise( ( resolve ) => {
		server.listen( 0, '127.0.0.1', () => resolve( { server, port: server.address().port } ) );
	} );
}
