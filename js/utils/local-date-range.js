/**
 * Convert date-input values into ISO boundaries for the browser's local calendar.
 * The end boundary is exclusive and is computed with local calendar arithmetic,
 * so daylight-saving transitions do not truncate or extend the selected day.
 */
function parseLocalDate(value, fieldName) {
    if (!value) return null;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) {
        throw new TypeError('La fecha ' + fieldName + ' no tiene un formato válido.');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(0);
    date.setHours(0, 0, 0, 0);
    date.setFullYear(year, month - 1, day);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        throw new RangeError('La fecha ' + fieldName + ' no existe.');
    }

    return date;
}

export function getLocalDateRange(fromValue = '', throughValue = '') {
    const start = parseLocalDate(fromValue, 'inicial');
    const endExclusive = parseLocalDate(throughValue, 'final');

    if (endExclusive) {
        // Use local calendar arithmetic instead of adding 24 hours: a DST day
        // can have 23 or 25 hours, but the next local midnight is still correct.
        endExclusive.setDate(endExclusive.getDate() + 1);
    }

    return {
        start: start ? start.toISOString() : null,
        endExclusive: endExclusive ? endExclusive.toISOString() : null
    };
}
