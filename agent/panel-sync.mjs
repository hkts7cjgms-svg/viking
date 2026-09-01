/**
 * Logowanie do panelu klienta i odczyt jadlospisu - przez przegladarke sterowana
 * Playwrightem, bo panel to aplikacja React bez publicznego API.
 *
 * Dane dostepowe wylacznie ze zmiennych srodowiskowych (agent/.env, poza repozytorium):
 *
 *   KV_PANEL_URL       https://panel.kuchniavikinga.pl
 *   KV_PANEL_USER      adres e-mail konta
 *   KV_PANEL_PASSWORD  hasło
 *
 * Sesja jest zapisywana na dysk i uzywana ponownie, wiec przy codziennym
 * uruchomieniu formularz logowania wypelnia sie tylko wtedy, gdy sesja wygasla.
 *
 * Gdy poznamy adresy API panelu, ten plik da sie zastapic zwyklymi zapytaniami
 * HTTP - reszta lancucha zostaje bez zmian.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { extractDates, extractDay, extractSidebarDetails } from './panel-scrape.mjs';

const SELECTORS = {
	user: '#username',
	password: '#password',
	submit: 'button[type="submit"]',
	// Pulpit poznajemy po nawigacji, nie po kalendarzu - kalendarz pojawia sie
	// pozniej, a przy braku aktywnego zamowienia moze nie pojawic sie wcale.
	dashboard: '.navigation, #pageHeader, .app-content, .calendar-slider-items',
	mealContent: '.meal-content',
	mealCard: 'ul.dashboard-meals-list > li.enhanced-meal-card',
	calendar: '.calendar-slider-items',
	sidebar: '#sideBar',
	loginForm: '#username',
};

/**
 * Banery zgod zaslaniaja przycisk logowania. Doczytuja sie z zewnetrznego CDN,
 * wiec pojawiaja sie PO zaladowaniu strony - czekamy na nie, zamiast sprawdzac raz.
 */
const COOKIE_BUTTONS = [
	'#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
	'#CybotCookiebotDialogBodyButtonAccept',
	'#CybotCookiebotDialogBodyButtonAcceptAll',
	'#CybotCookiebotDialogBodyLevelButtonAccept',
	'#onetrust-accept-btn-handler',
	'.cookie-accept-all',
];

/** Kontenery banerow, ktore usuwamy z DOM, gdy klikniecie zawiedzie. */
const COOKIE_CONTAINERS = [
	'#CybotCookiebotDialog',
	'#CybotCookiebotDialogBodyUnderlay',
	'#CookiebotWidget',
	'#CookiebotWidgetUnderlay',
	'#onetrust-consent-sdk',
	'[id^="CybotCookiebotDialog"]',
];

export class PanelLoginError extends Error {}

/**
 * @param {object} options { panelUrl, user, password, headless, timeout, sessionPath, log }
 */
export async function withPanel( options, callback ) {
	const { chromium } = await import( 'playwright' );
	const log = options.log || ( () => {} );
	const timeout = options.timeout || 30000;
	const panelUrl = options.panelUrl.replace( /\/+$/, '' );

	const browser = await chromium.launch( {
		headless: false !== options.headless,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
	} );

	try {
		const contextOptions = { locale: 'pl-PL' };

		// Ciasteczka z poprzedniego uruchomienia - jesli sesja zyje, logowanie odpada.
		if ( options.sessionPath && existsSync( options.sessionPath ) ) {
			contextOptions.storageState = options.sessionPath;
		}

		const context = await browser.newContext( contextOptions );
		const page = await context.newPage();

		page.setDefaultTimeout( timeout );

		await page.goto( `${ panelUrl }/`, { waitUntil: 'domcontentloaded' } );
		await dismissCookieBanner( page, { timeout: 1500 } );

		if ( await isLoggedIn( page, timeout ) ) {
			log( 'Sesja z poprzedniego uruchomienia nadal ważna — logowanie pominięte.' );
			await waitForCalendar( page, Math.min( timeout, 20000 ), log );
		} else {
			await login( page, { panelUrl, user: options.user, password: options.password, timeout, log } );
		}

		if ( options.sessionPath ) {
			mkdirSync( dirname( options.sessionPath ), { recursive: true } );
			await context.storageState( { path: options.sessionPath } );
		}

		return await callback( page, log );
	} finally {
		await browser.close();
	}
}

/**
 * Czy widzimy juz pulpit z kalendarzem, czy jeszcze formularz logowania.
 */
async function isLoggedIn( page, timeout ) {
	try {
		await page.waitForSelector( `${ SELECTORS.dashboard }, ${ SELECTORS.loginForm }`, {
			timeout: Math.min( timeout, 15000 ),
		} );
	} catch {
		return false;
	}

	// Formularz logowania na ekranie przewaza - pulpit moze byc pod spodem.
	if ( 0 < ( await page.locator( SELECTORS.loginForm ).count() ) ) {
		return false;
	}

	return 0 < ( await page.locator( SELECTORS.dashboard ).count() );
}

/**
 * Kalendarz doczytuje sie po pulpicie. Jego brak NIE jest bledem logowania -
 * moze po prostu nie byc aktywnego zamowienia. Mowimy o tym i idziemy dalej.
 */
async function waitForCalendar( page, timeout, log ) {
	try {
		await page.waitForSelector( SELECTORS.calendar, { timeout } );

		return true;
	} catch {
		log(
			'Zalogowano, ale panel nie pokazał kalendarza. Najczęstsza przyczyna: ' +
				'brak aktywnego zamówienia na tym koncie. Uruchom `npm run diagnose` — ' +
				'zrobi zrzut ekranu i wypisze, co panel faktycznie wyświetla.'
		);

		return false;
	}
}

/**
 * Zamyka baner zgod. Trzy podejscia po kolei, bo kazdy dostawca robi to inaczej:
 * przycisk po identyfikatorze, przycisk po tresci, a na koniec usuniecie
 * nakladki z DOM. Ostatnie jest bezpieczne - to warstwa na wierzchu, nie aplikacja.
 *
 * @param {object} page Strona Playwrighta.
 * @param {object} opts { timeout } - ile czekac na pojawienie sie baneru.
 */
async function dismissCookieBanner( page, opts = {} ) {
	const timeout = opts.timeout ?? 4000;
	const accept = page.locator( COOKIE_BUTTONS.join( ', ' ) ).first();

	try {
		await accept.waitFor( { state: 'visible', timeout } );
		await accept.click( { timeout: 5000 } );
		await page.waitForTimeout( 300 );

		return 'kliknięty';
	} catch {
		// Baneru nie ma, ma inny przycisk albo klikniecie nie doszlo - probujemy dalej.
	}

	const byText = page
		.getByRole( 'button', { name: /zezwól|akceptuj|zgadzam|zgoda|accept|allow/i } )
		.first();

	try {
		if ( 0 < ( await byText.count() ) ) {
			await byText.click( { timeout: 3000 } );
			await page.waitForTimeout( 300 );

			return 'kliknięty';
		}
	} catch {
		// Trudno - zostaje usuniecie z DOM.
	}

	const removed = await page.evaluate( ( selectors ) => {
		var count = 0;

		for ( var i = 0; i < selectors.length; i++ ) {
			var nodes = document.querySelectorAll( selectors[ i ] );

			for ( var n = 0; n < nodes.length; n++ ) {
				nodes[ n ].remove();
				count++;
			}
		}

		// Banery blokuja przewijanie - przywracamy je razem z usunieciem nakladki.
		if ( count ) {
			document.body.style.overflow = '';
			document.documentElement.style.overflow = '';
		}

		return count;
	}, COOKIE_CONTAINERS );

	return removed ? 'usunięty z DOM' : 'brak';
}

async function login( page, { panelUrl, user, password, timeout, log } ) {
	if ( ! user || ! password ) {
		throw new PanelLoginError( 'Brak KV_PANEL_USER lub KV_PANEL_PASSWORD w agent/.env.' );
	}

	log( 'Sesja wygasła — loguję się do panelu…' );

	await page.goto( `${ panelUrl }/logowanie`, { waitUntil: 'domcontentloaded' } );
	await page.waitForSelector( SELECTORS.user, { timeout } );

	// Dopiero teraz, gdy formularz stoi: baner doczytuje sie z opoznieniem i
	// potrafi wejsc na wierzch juz po zaladowaniu strony.
	const banner = await dismissCookieBanner( page );

	if ( 'brak' !== banner ) {
		log( `Baner zgód: ${ banner }.` );
	}

	await page.fill( SELECTORS.user, user );
	await page.fill( SELECTORS.password, password );

	// Przycisk jest wylaczony, dopoki formularz nie uzna danych za kompletne.
	const submit = page.locator( SELECTORS.submit ).first();

	try {
		await submit.waitFor( { state: 'visible', timeout } );
		await page.waitForFunction(
			( selector ) => {
				var button = document.querySelector( selector );

				return Boolean( button ) && ! button.disabled;
			},
			SELECTORS.submit,
			{ timeout: 10000 }
		);
	} catch {
		throw new PanelLoginError(
			'Przycisk logowania pozostał nieaktywny — panel nie przyjął danych z formularza. ' +
				'Uruchom z KV_HEADLESS=0, żeby zobaczyć, co się dzieje.'
		);
	}

	await submit.click();

	try {
		await page.waitForSelector( SELECTORS.dashboard, { timeout } );
	} catch {
		throw new PanelLoginError( await loginFailureReason( page ) );
	}

	log( 'Zalogowano.' );
	await waitForCalendar( page, Math.min( timeout, 20000 ), log );
}

/**
 * Po nieudanym logowaniu staramy sie powiedziec, co poszlo nie tak, zamiast
 * zrzucac surowy blad oczekiwania na element.
 */
async function loginFailureReason( page ) {
	const message = await page
		.locator( '.Toastify__toast, [role="alert"], .error, .form-error' )
		.first()
		.textContent( { timeout: 2000 } )
		.catch( () => null );

	if ( message && message.trim() ) {
		return `Panel odrzucił logowanie: ${ message.trim() }`;
	}

	if ( 0 < ( await page.locator( SELECTORS.loginForm ).count() ) ) {
		return 'Logowanie nie powiodło się — sprawdź KV_PANEL_USER i KV_PANEL_PASSWORD w agent/.env.';
	}

	return 'Panel nie pokazał ani kalendarza, ani pulpitu. Uruchom `npm run diagnose`, ' +
		'żeby zobaczyć zrzut ekranu i treść strony.';
}

/**
 * Przechodzi po dniach kalendarza i zbiera jadlospis.
 *
 * @param {object} page Strona Playwrighta.
 * @param {object} opts { from, to, details, log }
 */
export async function collectDays( page, opts = {} ) {
	const log = opts.log || ( () => {} );
	const calendar = await page.evaluate( extractDates );
	const all = calendar.days || [];

	if ( 0 === all.length ) {
		log( 'Kalendarz jest pusty — panel nie pokazał żadnego dnia. Czy zamówienie jest aktywne?' );

		return [];
	}

	const inRange = all.filter( ( day ) => {
		if ( opts.from && day.date < opts.from ) {
			return false;
		}

		return ! ( opts.to && day.date > opts.to );
	} );

	// Dzien "ma co pokazac", gdy niesie etykietę (Zobacz / Edytuj) albo jest aktywny.
	// Klasa is-disabled NIE dyskwalifikuje - w tym panelu znaczy tylko tyle, że
	// zamówienia na ten dzień nie da się już zmienić.
	let wanted = inRange.filter( ( day ) => '' !== day.label || day.isActive );

	if ( 0 === wanted.length && inRange.length ) {
		// Panel mógł zmienić wygląd - lepiej spróbować wszystkich niż nic nie pobrać.
		log( 'Żaden dzień nie ma etykiety — próbuję otworzyć wszystkie dni z zakresu.' );
		wanted = inRange;
	}

	log(
		`Kalendarz: ${ all.length } dni, w zakresie ${ inRange.length }, ` +
			`z jadłospisem do sprawdzenia ${ wanted.length }.`
	);

	if ( 0 === wanted.length ) {
		const first = all[ 0 ]?.date;
		const last = all[ all.length - 1 ]?.date;

		log( `Panel pokazuje dni ${ first } … ${ last } — poza zakresem ${ opts.from } … ${ opts.to }.` );
		log( 'Podpowiedź: rozszerz zakres, np. --from ' + first + ' --to ' + last );
	}

	const days = [];

	for ( const { date } of wanted ) {
		if ( ! ( await openDay( page, date ) ) ) {
			log( `  ${ date }: nie udało się otworzyć, pomijam.` );
			continue;
		}

		const day = await page.evaluate( extractDay );

		if ( day.date !== date ) {
			log( `  ${ date }: panel pokazał ${ day.date }, pomijam.` );
			continue;
		}

		if ( 0 === day.meals.length ) {
			log( `  ${ date }: brak posiłków (dzień bez dostawy).` );
			continue;
		}

		if ( opts.details ) {
			await addMealDetails( page, day, log );
		}

		log( `  ${ date }: ${ day.meals.length } posiłków.` );
		days.push( day );
	}

	return days;
}

/**
 * Klika w dzien i czeka, az karta dnia faktycznie go pokaze.
 */
async function openDay( page, date ) {
	const tile = page.locator( `[data-date="${ date }"] li.day` ).first();

	if ( 0 === ( await tile.count() ) ) {
		return false;
	}

	// Klikamy kazdy dzien, ktory kalendarz w ogole pokazuje. O tym, czy dzien
	// da sie otworzyc, rozstrzyga sprawdzenie ponizej - nie klasy CSS, bo
	// is-disabled w tym panelu wystepuje takze na dniach z pelnym jadlospisem.
	try {
		await tile.click( { timeout: 5000 } );
	} catch {
		return false;
	}

	try {
		await page.waitForFunction(
			( expected ) => {
				var holders = document.querySelectorAll( '.calendar-slider-items [data-date]' );

				for ( var i = 0; i < holders.length; i++ ) {
					if ( holders[ i ].querySelector( 'li.day.is-selected' ) ) {
						return holders[ i ].getAttribute( 'data-date' ) === expected;
					}
				}

				return false;
			},
			date,
			{ timeout: 4000 }
		);
	} catch {
		return false;
	}

	return true;
}

/**
 * Otwiera boczny panel kazdego posilku i zbiera z niego szczegoly.
 *
 * ROBIMY TU WYLACZNIE DWIE RZECZY: klikamy w opis dania i zamykamy panel
 * klawiszem Escape. Nic wewnatrz panelu nie jest klikane - w tej aplikacji
 * sa akcje zmieniajace zamowienie i pomylka kosztowalaby realne pieniadze.
 */
async function addMealDetails( page, day, log ) {
	for ( let index = 0; index < day.meals.length; index++ ) {
		const content = page.locator( `${ SELECTORS.mealCard } ${ SELECTORS.mealContent }` ).nth( index );

		if ( 0 === ( await content.count() ) ) {
			continue;
		}

		try {
			await content.click();

			await page.waitForFunction(
				( selector ) => {
					var node = document.querySelector( selector );

					return Boolean( node ) && node.textContent.trim().length > 0;
				},
				SELECTORS.sidebar,
				{ timeout: 5000 }
			);

			day.meals[ index ].details = await page.evaluate( extractSidebarDetails );
		} catch {
			log( `    ${ day.date } / ${ day.meals[ index ].slug }: nie udało się odczytać szczegółów.` );
		} finally {
			await page.keyboard.press( 'Escape' );
			await page.waitForTimeout( 250 );
		}
	}
}
