/**
 * Klient Kalendarza Google - tyle, ile potrzeba do synchronizacji jadlospisu.
 * Bez zaleznosci: OAuth i REST po zwyklym fetch, podpis JWT przez wbudowane crypto.
 *
 * Dwa sposoby uwierzytelnienia:
 *
 * 1. Refresh token (konto zwykle, np. gmail.com)
 *    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * 2. Konto uslugowe (Workspace albo kalendarz udostepniony temu kontu)
 *    GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 */

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Znacznik, po ktorym rozpoznajemy wpisy nalezace do tej synchronizacji. */
export const SOURCE_TAG = 'kuchnia-vikinga';

export class GoogleCalendarError extends Error {
	constructor( status, message ) {
		super( message );
		this.status = status;
	}
}

function base64url( input ) {
	return Buffer.from( input ).toString( 'base64' ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
}

/**
 * Podpisany JWT dla konta uslugowego. Google wymienia go na token dostepu.
 */
function signServiceAccountJwt( { email, privateKey, subject, scope = SCOPE } ) {
	const now = Math.floor( Date.now() / 1000 );
	const header = base64url( JSON.stringify( { alg: 'RS256', typ: 'JWT' } ) );
	const claims = {
		iss: email,
		scope,
		aud: TOKEN_URL,
		iat: now,
		exp: now + 3600,
	};

	// Delegacja w Workspace: token wystawiany "w imieniu" wskazanego uzytkownika.
	if ( subject ) {
		claims.sub = subject;
	}

	const payload = base64url( JSON.stringify( claims ) );
	const signer = createSign( 'RSA-SHA256' );

	signer.update( `${ header }.${ payload }` );

	// Klucz z .env ma \n zapisane dosłownie - trzeba je odtworzyć.
	const signature = signer.sign( privateKey.replace( /\\n/g, '\n' ) );

	return `${ header }.${ payload }.${ base64url( signature ) }`;
}

/**
 * Zrodlo tokenu dostepu - wspolne dla Kalendarza i Arkuszy.
 *
 * @param {object} config Dane uwierzytelniajace.
 * @param {string} scope  Zakres uprawnien; domyslnie wydarzenia kalendarza.
 *
 * @returns {() => Promise<string>} Funkcja oddajaca wazny token.
 */
export function createTokenSource( config, scope = SCOPE ) {
	let token = null;
	let expiresAt = 0;
	const fetchImpl = config.fetch || globalThis.fetch;

	return async function accessToken() {
		if ( token && Date.now() < expiresAt ) {
			return token;
		}

		let body;

		if ( config.refreshToken ) {
			body = new URLSearchParams( {
				grant_type: 'refresh_token',
				client_id: config.clientId,
				client_secret: config.clientSecret,
				refresh_token: config.refreshToken,
			} );
		} else if ( config.serviceAccountEmail ) {
			body = new URLSearchParams( {
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion: signServiceAccountJwt( {
					email: config.serviceAccountEmail,
					privateKey: config.privateKey,
					subject: config.subject,
					scope,
				} ),
			} );
		} else {
			throw new GoogleCalendarError( 0, 'Brak danych uwierzytelniających do konta Google.' );
		}

		const response = await fetchImpl( TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString(),
		} );

		const data = await response.json();

		if ( ! response.ok ) {
			throw new GoogleCalendarError(
				response.status,
				`Nie udało się pobrać tokenu: ${ data.error_description || data.error || response.status }`
			);
		}

		token = data.access_token;
		// Margines, zeby token nie wygasl w trakcie serii zapytan.
		expiresAt = Date.now() + ( data.expires_in - 60 ) * 1000;

		return token;
	};
}

export function createClient( config ) {
	const calendarId = config.calendarId || 'primary';
	const accessToken = createTokenSource( config );
	const fetchImpl = config.fetch || globalThis.fetch;

	async function authorized( path, options = {} ) {
		const url = new URL( `${ API }${ path }` );

		for ( const [ key, value ] of Object.entries( options.query || {} ) ) {
			if ( value !== undefined && value !== null && value !== '' ) {
				url.searchParams.set( key, String( value ) );
			}
		}

		const response = await fetchImpl( url.toString(), {
			method: options.method || 'GET',
			headers: {
				Authorization: `Bearer ${ await accessToken() }`,
				'Content-Type': 'application/json',
			},
			body: options.body ? JSON.stringify( options.body ) : undefined,
		} );

		if ( 204 === response.status ) {
			return null;
		}

		const data = await response.json();

		if ( ! response.ok ) {
			throw new GoogleCalendarError(
				response.status,
				`Kalendarz Google: ${ data.error?.message || response.status }`
			);
		}

		return data;
	}

	return {
		/** Wpisy tej synchronizacji w podanym zakresie dat. */
		async listManaged( from, to ) {
			const items = [];
			let pageToken;

			do {
				const page = await authorized( `/calendars/${ encodeURIComponent( calendarId ) }/events`, {
					query: {
						privateExtendedProperty: `kvSource=${ SOURCE_TAG }`,
						timeMin: `${ from }T00:00:00Z`,
						timeMax: `${ to }T23:59:59Z`,
						maxResults: 250,
						singleEvents: true,
						pageToken,
					},
				} );

				items.push( ...( page.items || [] ) );
				pageToken = page.nextPageToken;
			} while ( pageToken );

			return items;
		},

		insert( event ) {
			return authorized( `/calendars/${ encodeURIComponent( calendarId ) }/events`, {
				method: 'POST',
				body: event,
			} );
		},

		patch( eventId, event ) {
			return authorized(
				`/calendars/${ encodeURIComponent( calendarId ) }/events/${ encodeURIComponent( eventId ) }`,
				{ method: 'PATCH', body: event }
			);
		},

		remove( eventId ) {
			return authorized(
				`/calendars/${ encodeURIComponent( calendarId ) }/events/${ encodeURIComponent( eventId ) }`,
				{ method: 'DELETE' }
			);
		},
	};
}
