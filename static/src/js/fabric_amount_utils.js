/** @odoo-module **/

/**
 * Parse a numeric or comma-formatted string into a float (0 on empty/invalid).
 */
export function parseAmount(val) {
    if (val === '' || val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const cleaned = String(val).replace(/,/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Format an amount using 3-digit comma grouping (e.g. 11,200 / 112,000 / 1,000,000).
 */
export function formatAmount(val) {
    if (val === '' || val === null || val === undefined) return '0';
    const cleaned = typeof val === 'string' ? val.replace(/,/g, '').trim() : val;
    const num = parseFloat(cleaned);
    if (isNaN(num)) return '0';
    let rounded = Number(num.toFixed(2));
    if (Object.is(rounded, -0)) {
        rounded = 0;
    }
    return rounded.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}

/**
 * Format a numeric value for an editable text input (returns '' for zero/empty).
 */
export function formatAmountState(val) {
    if (val === '' || val === null || val === undefined || val === 0 || val === '0' || val === 0.0) {
        return '';
    }
    const num = parseAmount(val);
    if (num === 0) return '';
    return formatAmount(num);
}

/**
 * Format an in-progress text input value with 3-digit commas while preserving
 * trailing decimal points and decimals (e.g. "11200." -> "11,200.").
 */
export function formatLiveAmountString(rawStr) {
    if (rawStr === '' || rawStr === null || rawStr === undefined) return '';
    let s = String(rawStr).replace(/[^0-9.-]/g, '');
    if (!s) return '';

    const isNegative = s.startsWith('-');
    s = s.replace(/-/g, '');
    const prefix = isNegative ? '-' : '';

    const dotIdx = s.indexOf('.');
    const hasDot = dotIdx !== -1;
    let intPart = hasDot ? s.slice(0, dotIdx) : s;
    let decPart = hasDot ? s.slice(dotIdx + 1).replace(/\./g, '') : '';

    if (decPart.length > 2) {
        decPart = decPart.slice(0, 2);
    }

    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (hasDot) {
        return `${prefix}${formattedInt}.${decPart}`;
    }
    return `${prefix}${formattedInt}`;
}

/**
 * Format an <input> element's value on input while preserving cursor position,
 * then invoke `setter(formatted)` to update reactive component state.
 */
export function applyFormattedInput(ev, setter) {
    const input = ev && ev.target;
    if (!input) return;

    const raw = input.value || '';
    const selStart = input.selectionStart;

    let meaningfulBefore = 0;
    if (typeof selStart === 'number') {
        for (let i = 0; i < selStart; i++) {
            if (/[0-9.-]/.test(raw[i])) {
                meaningfulBefore++;
            }
        }
    }

    const formatted = formatLiveAmountString(raw);
    if (input.value !== formatted) {
        input.value = formatted;
    }
    setter(formatted);

    if (typeof selStart === 'number' && document.activeElement === input) {
        let pos = 0;
        let seen = 0;
        while (pos < formatted.length && seen < meaningfulBefore) {
            if (/[0-9.-]/.test(formatted[pos])) {
                seen++;
            }
            pos++;
        }
        try {
            input.setSelectionRange(pos, pos);
        } catch (_e) {
            // Ignore selection errors on unsupported input states
        }
    }
}
