/**
 * Atrapa panelu klienta do testow logowania i odczytu - serwuje formularz
 * logowania i pulpit z kalendarzem o strukturze zgodnej z prawdziwym panelem.
 */
import { createServer } from 'node:http';

const USER = 'test@kuchniavikinga.pl';
const PASSWORD = 'dobre-haslo';
const COOKIE = 'kv_session=zalogowany';

const MENU = {
	'2026-09-02': [
		[ 4204325, 'Śniadanie', 'Kanapka z chlebem wiejskim, pieczonym schabem i serem', 479 ],
		[ 4204326, 'Obiad', 'Pierogi z ziemniakami i twarogiem, okrasa z boczkiem', 589 ],
		[ 4204327, 'Kolacja', 'Tacos z szarpaną wieprzowiną z chili', 533 ],
	],
	'2026-09-04': [ [ 4204330, 'Obiad', 'Gulasz wieprzowy z kaszą gryczaną', 612 ] ],
};

const DISABLED = [ '2026-09-01', '2026-09-03' ];
const DATES = [ '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04' ];

const DETAILS = {
	4204326: 'Skład|mąka pszenna, ziemniaki, twaróg, boczek, kapusta kiszona::Alergeny|gluten, mleko',
};

function loginPage( failed, bannerMode ) {
	return `<!doctype html><html lang="pl-PL"><body>
	<!-- Baner zgod jak Cookiebot: doczytuje sie z opoznieniem i zaslania formularz. -->
	<script>
		setTimeout(function () {
			var underlay = document.createElement('div');
			underlay.id = 'CybotCookiebotDialogBodyUnderlay';
			underlay.setAttribute('style', 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2147483640');

			var dialog = document.createElement('div');
			dialog.id = 'CybotCookiebotDialog';
			dialog.setAttribute('style', 'position:fixed;inset:0;z-index:2147483641;background:#fff;padding:40px');
			dialog.innerHTML = ${ JSON.stringify( bannerMode ) } === 'stubborn'
				? '<p>Ta strona używa plików cookie.</p><span role="link">Ustawienia</span>'
				: '<p>Ta strona używa plików cookie.</p>' +
					'<button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll" type="button">Zezwól na wszystkie</button>';

			document.body.appendChild(underlay);
			document.body.appendChild(dialog);
			document.body.style.overflow = 'hidden';

			dialog.querySelector('button').addEventListener('click', function () {
				underlay.remove();
				dialog.remove();
				document.body.style.overflow = '';
			});
		}, 200);
	</script>
	<div id="app"></div>
	<script>
		// Prawdziwy panel to React - formularz pojawia sie dopiero po starcie
		// aplikacji, wiec baner zgod zdazy sie wyswietlic przed nim.
		setTimeout(function () {
			document.getElementById('app').innerHTML = ${ JSON.stringify(
				`<form class="_login-header_11a5k_84">${ failed ? '<div role="alert">Nieprawidłowy email lub hasło</div>' : '' }<input id="username" name="username" type="text" placeholder="Podaj adres email"><input id="password" name="password" type="password" placeholder="Podaj hasło"><button class="button login-action-button" disabled type="submit"><span class="button-label">Zaloguj</span></button></form>`
			) };
			start();
		}, 900);
	</script>
	<script>
		function start() {
		// Tak jak w prawdziwym panelu: przycisk odblokowuje sie po wypelnieniu pol.
		var u = document.getElementById('username');
		var p = document.getElementById('password');
		var b = document.querySelector('button[type="submit"]');
		function refresh() { b.disabled = !(u.value && p.value); }
		u.addEventListener('input', refresh);
		p.addEventListener('input', refresh);
		document.querySelector('form').addEventListener('submit', function (event) {
			event.preventDefault();
			fetch('/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: u.value, password: p.value }),
			}).then(function (response) {
				if (response.ok) { window.location.href = '/'; }
				else { window.location.href = '/logowanie?blad=1'; }
			});
		});
		}
	</script>
</body></html>`;
}

function dashboardPage() {
	const dayTile = ( date ) => `
		<div data-date="${ date }">
			<div class="relative inline-block group">
				<li class="day${ DISABLED.includes( date ) ? ' is-disabled' : '' }${ '2026-09-02' === date ? ' is-selected is-active' : '' }">
					<div data-date="${ date }" id="calendar-day-${ date }" role="button" tabindex="0">
						<div class="day-header"><div class="h300 day-number">${ Number( date.slice( 8 ) ) }</div></div>
					</div>
				</li>
			</div>
		</div>`;

	return `<!doctype html><html lang="pl-PL"><body>
	<div class="calendar-slider-items">${ DATES.map( dayTile ).join( '' ) }</div>
	<div id="dayDetailsCard"><div class="card-header"><h3 id="day-details-date"></h3></div>
		<div class="card-body"><ul class="dashboard-meals-list"></ul></div>
	</div>
	<div id="sideBar"></div>
	<script>
		var MENU = ${ JSON.stringify( MENU ) };
		var DETAILS = ${ JSON.stringify( DETAILS ) };

		function render( date ) {
			document.querySelectorAll( '.calendar-slider-items li.day' ).forEach( function ( li ) {
				li.classList.remove( 'is-selected' );
			} );
			document.querySelector( '[data-date="' + date + '"] li.day' ).classList.add( 'is-selected' );

			var list = document.querySelector( '.dashboard-meals-list' );
			list.innerHTML = '';

			( MENU[ date ] || [] ).forEach( function ( meal ) {
				var li = document.createElement( 'li' );
				li.className = 'enhanced-meal-card';
				li.id = 'mealCard-' + meal[ 0 ];
				li.innerHTML =
					'<div class="meal-header"><div class="name">' + meal[ 1 ] + ' </div></div>' +
					'<div class="meal-content" role="button"><span>' + meal[ 2 ] + '</span></div>' +
					'<div class="meal-nutritions"><div class="nutrition-summary">' +
					'<div class="nutrition-summary__item">' + meal[ 3 ] + 'kcal</div></div></div>';
				li.querySelector( '.meal-content' ).addEventListener( 'click', function () {
					var raw = DETAILS[ meal[ 0 ] ];
					var sidebar = document.getElementById( 'sideBar' );
					if ( ! raw ) { sidebar.innerHTML = '<div>' + meal[ 2 ] + '</div>'; return; }
					sidebar.innerHTML = raw.split( '::' ).map( function ( part ) {
						var pieces = part.split( '|' );
						return '<h3 class="h300">' + pieces[ 0 ] + '</h3><div>' + pieces[ 1 ] + '</div>';
					} ).join( '' );
				} );
				list.appendChild( li );
			} );
		}

		document.addEventListener( 'keydown', function ( event ) {
			if ( 'Escape' === event.key ) { document.getElementById( 'sideBar' ).innerHTML = ''; }
		} );

		document.querySelectorAll( '.calendar-slider-items li.day:not(.is-disabled)' ).forEach( function ( li ) {
			li.addEventListener( 'click', function () {
				// Opoznienie jak w SPA - przelaczenie dnia nie jest natychmiastowe.
				var date = li.closest( '[data-date]' ).getAttribute( 'data-date' );
				setTimeout( function () { render( date ); }, 120 );
			} );
		} );

		render( '2026-09-02' );
	</script>
</body></html>`;
}

export function startFakePanel( options = {} ) {
	const state = { logins: 0 };

	const server = createServer( ( req, res ) => {
		const url = new URL( req.url, 'http://localhost' );
		const authed = ( req.headers.cookie || '' ).includes( COOKIE );

		if ( '/api/login' === url.pathname && 'POST' === req.method ) {
			let raw = '';

			req.on( 'data', ( chunk ) => ( raw += chunk ) );
			req.on( 'end', () => {
				const body = JSON.parse( raw || '{}' );

				if ( body.username === USER && body.password === PASSWORD ) {
					state.logins++;
					res.writeHead( 200, { 'Set-Cookie': `${ COOKIE }; Path=/`, 'Content-Type': 'application/json' } );

					return res.end( '{"ok":true}' );
				}

				res.writeHead( 401, { 'Content-Type': 'application/json' } );
				res.end( '{"ok":false}' );
			} );

			return;
		}

		if ( '/logowanie' === url.pathname ) {
			res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );

			return res.end( loginPage( '1' === url.searchParams.get( 'blad' ), options.bannerMode || 'accept' ) );
		}

		if ( '/' === url.pathname ) {
			if ( ! authed ) {
				res.writeHead( 302, { Location: '/logowanie' } );

				return res.end();
			}

			res.writeHead( 200, { 'Content-Type': 'text/html; charset=utf-8' } );

			return res.end( dashboardPage() );
		}

		res.writeHead( 404 );
		res.end();
	} );

	return new Promise( ( resolve ) => {
		server.listen( 0, '127.0.0.1', () =>
			resolve( {
				server,
				state,
				url: `http://127.0.0.1:${ server.address().port }`,
				credentials: { user: USER, password: PASSWORD },
			} )
		);
	} );
}
