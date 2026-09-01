<?php
/**
 * Budowanie kanalu iCal (RFC 5545) z wydarzen.
 *
 * Bez zaleznosci od WordPressa - dzieki temu testuje sie to zwyklym PHP CLI
 * (patrz tests/IcsBuilderTest.php).
 *
 * @package KuchniaVikinga\Wydarzenia
 */

namespace KuchniaVikinga\Wydarzenia;

if ( ! defined( 'ABSPATH' ) && PHP_SAPI !== 'cli' ) {
	exit;
}

final class IcsBuilder {

	private const CRLF = "\r\n";

	/** Maksymalna dlugosc linii wg RFC 5545 to 75 oktetow (bez CRLF). */
	private const LINE_OCTETS = 75;

	/** Dni tygodnia ISO na skroty iCal. */
	private const BYDAY = array(
		1 => 'MO',
		2 => 'TU',
		3 => 'WE',
		4 => 'TH',
		5 => 'FR',
		6 => 'SA',
		7 => 'SU',
	);

	/**
	 * @param array[]              $events  Znormalizowane wydarzenia.
	 * @param array<string, mixed> $options name, host, dtstamp, prodid.
	 */
	public static function build( array $events, array $options = array() ): string {
		$name    = (string) ( $options['name'] ?? 'Wydarzenia' );
		$host    = self::sanitize_host( (string) ( $options['host'] ?? 'localhost' ) );
		$dtstamp = (string) ( $options['dtstamp'] ?? gmdate( 'Ymd\THis\Z' ) );
		$prodid  = (string) ( $options['prodid'] ?? '-//Kuchnia Vikinga//Wydarzenia//PL' );

		$lines = array(
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:' . self::escape( $prodid ),
			'CALSCALE:GREGORIAN',
			'METHOD:PUBLISH',
			'X-WR-CALNAME:' . self::escape( $name ),
			'X-WR-TIMEZONE:Europe/Warsaw',
		);

		foreach ( $events as $event ) {
			$vevent = self::vevent( $event, $host, $dtstamp );

			if ( array() !== $vevent ) {
				$lines = array_merge( $lines, $vevent );
			}
		}

		$lines[] = 'END:VCALENDAR';

		$folded = array_map( array( self::class, 'fold' ), $lines );

		return implode( self::CRLF, $folded ) . self::CRLF;
	}

	/**
	 * Pojedyncze VEVENT. Pusta tablica = wydarzenia nie da sie osadzic w czasie.
	 *
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 *
	 * @return string[]
	 */
	private static function vevent( array $event, string $host, string $dtstamp ): array {
		$from = EventMatcher::normalize_date( $event['date_from'] ?? null );
		$to   = EventMatcher::normalize_date( $event['date_to'] ?? null );

		// Wydarzenie "zawsze" nie ma sensu jako wpis w kalendarzu.
		$start = $from ?? $to;

		if ( null === $start ) {
			return array();
		}

		$weekdays = EventMatcher::normalize_int_list( $event['weekdays'] ?? array() );

		if ( array() !== $weekdays ) {
			$start = self::first_matching_day( $start, $to, $weekdays );

			// Zakres krotszy niz odstep miedzy wybranymi dniami - nic nie wypada.
			if ( null === $start ) {
				return array();
			}
		}

		$lines = array(
			'BEGIN:VEVENT',
			'UID:' . self::escape( sprintf( 'kv-wydarzenie-%d@%s', (int) ( $event['id'] ?? 0 ), $host ) ),
			'DTSTAMP:' . $dtstamp,
			'SUMMARY:' . self::escape( self::summary( $event ) ),
			'DTSTART;VALUE=DATE:' . self::compact( $start ),
			'TRANSP:TRANSPARENT',
		);

		if ( array() !== $weekdays ) {
			// Powtarzalne: jeden dzien co tydzien w wybrane dni.
			$lines[] = 'DTEND;VALUE=DATE:' . self::compact( self::add_days( $start, 1 ) );
			$lines[] = 'RRULE:' . self::rrule( $weekdays, $to );
		} else {
			// Ciagle: DTEND w iCal jest wylaczne, wiec doba wiecej niz data konca.
			$end     = null === $to ? $start : $to;
			$lines[] = 'DTEND;VALUE=DATE:' . self::compact( self::add_days( $end, 1 ) );
		}

		$description = self::description( $event );

		if ( '' !== $description ) {
			$lines[] = 'DESCRIPTION:' . self::escape( $description );
		}

		$meals = EventMatcher::normalize_slug_list( $event['meals'] ?? array() );

		if ( array() !== $meals ) {
			$lines[] = 'CATEGORIES:' . self::escape( implode( ',', $meals ) );
		}

		$lines[] = 'END:VEVENT';

		return $lines;
	}

	/**
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 */
	private static function summary( array $event ): string {
		$badge = trim( (string) ( $event['badge'] ?? '' ) );
		$title = trim( (string) ( $event['title'] ?? '' ) );

		if ( '' === $title ) {
			$title = 'Wydarzenie';
		}

		return '' === $badge ? $title : $badge . ' ' . $title;
	}

	/**
	 * Opis: tresc wydarzenia plus informacja, czego dotyczy.
	 *
	 * @param array<string, mixed> $event Znormalizowane wydarzenie.
	 */
	private static function description( array $event ): string {
		$parts = array();
		$body  = self::to_plain_text( (string) ( $event['body'] ?? '' ) );

		if ( '' !== $body ) {
			$parts[] = $body;
		}

		$meals = EventMatcher::normalize_slug_list( $event['meals'] ?? array() );
		$diets = EventMatcher::normalize_slug_list( $event['diets'] ?? array() );

		$parts[] = 'Posiłki: ' . ( array() === $meals ? 'wszystkie' : implode( ', ', $meals ) );
		$parts[] = 'Diety: ' . ( array() === $diets ? 'wszystkie' : implode( ', ', $diets ) );

		return implode( "\n\n", $parts );
	}

	/**
	 * HTML z edytora na czysty tekst - w kalendarzu i tak nie ma znacznikow.
	 */
	public static function to_plain_text( string $html ): string {
		$text = preg_replace( '#<(br|/p|/div|/li)[^>]*>#i', "\n", $html ) ?? $html;
		$text = strip_tags( $text );
		$text = html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = preg_replace( '/[ \t]+/', ' ', $text ) ?? $text;
		$text = preg_replace( '/\n{3,}/', "\n\n", $text ) ?? $text;

		return trim( $text );
	}

	/**
	 * @param int[] $weekdays Dni tygodnia ISO.
	 */
	private static function rrule( array $weekdays, ?string $to ): string {
		$byday = array_map( static fn( int $day ): string => self::BYDAY[ $day ], $weekdays );
		$rule  = 'FREQ=WEEKLY;BYDAY=' . implode( ',', $byday );

		if ( null !== $to ) {
			$rule .= ';UNTIL=' . self::compact( $to );
		}

		return $rule;
	}

	/**
	 * Pierwszy dzien od $start (wlacznie), ktory wypada w jednym z $weekdays.
	 *
	 * @param int[] $weekdays Dni tygodnia ISO.
	 */
	private static function first_matching_day( string $start, ?string $to, array $weekdays ): ?string {
		$date = $start;

		// Najdalej tydzien - dalej i tak by sie powtorzylo.
		for ( $i = 0; $i < 7; $i++ ) {
			if ( null !== $to && $date > $to ) {
				return null;
			}

			if ( in_array( EventMatcher::weekday( $date ), $weekdays, true ) ) {
				return $date;
			}

			$date = self::add_days( $date, 1 );
		}

		return null;
	}

	public static function add_days( string $date, int $days ): string {
		return ( new \DateTimeImmutable( $date . ' 00:00:00', new \DateTimeZone( 'UTC' ) ) )
			->modify( sprintf( '%+d days', $days ) )
			->format( 'Y-m-d' );
	}

	/** '2026-09-15' => '20260915' */
	private static function compact( string $date ): string {
		return str_replace( '-', '', $date );
	}

	/**
	 * Escapowanie wartosci wg RFC 5545: backslash, srednik, przecinek, nowa linia.
	 */
	public static function escape( string $value ): string {
		$value = str_replace( "\r\n", "\n", $value );

		return str_replace(
			array( '\\', ';', ',', "\n" ),
			array( '\\\\', '\;', '\\,', '\\n' ),
			$value
		);
	}

	/**
	 * Zawijanie linii do 75 oktetow. Lamiemy na granicy znaku, nie bajtu -
	 * inaczej polskie znaki rozsypalyby sie na pol.
	 */
	public static function fold( string $line ): string {
		if ( strlen( $line ) <= self::LINE_OCTETS ) {
			return $line;
		}

		$out     = '';
		$current = '';
		$limit   = self::LINE_OCTETS;
		$chars   = preg_split( '//u', $line, -1, PREG_SPLIT_NO_EMPTY ) ?: array();

		foreach ( $chars as $char ) {
			if ( strlen( $current ) + strlen( $char ) > $limit ) {
				$out    .= $current . self::CRLF . ' ';
				$current = '';
				// Kolejne linie maja wiodaca spacje, wiec miejsca na tresc jest o jeden mniej.
				$limit = self::LINE_OCTETS - 1;
			}

			$current .= $char;
		}

		return $out . $current;
	}

	private static function sanitize_host( string $host ): string {
		$host = preg_replace( '/[^a-zA-Z0-9.\-]/', '', $host ) ?? '';

		return '' === $host ? 'localhost' : strtolower( $host );
	}
}
