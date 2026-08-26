const CONTROL_KEYS = new Set([
    'Backspace',
    'Delete',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Tab',
    'Home',
    'End',
    'Enter',
    'Escape',
]);

const hasShortcutModifier = (event) => event.ctrlKey || event.metaKey || event.altKey;

const MONEY_INPUT_PATTERN = /^\d+(?:\.\d{1,2})?$/;
export const MAX_SAFE_MONEY_CENTAVOS = Number.MAX_SAFE_INTEGER;

const getMoneyCentavosBigInt = (value) => {
    const source = String(value ?? '');
    if (!MONEY_INPUT_PATTERN.test(source)) return null;

    const [wholePart, decimalPart = ''] = source.split('.');
    const centavos = BigInt(`${wholePart}${decimalPart.padEnd(2, '0')}`);
    return centavos;
};

export const isMoneyInputTooLarge = (value) => {
    const centavos = getMoneyCentavosBigInt(value);
    return centavos !== null && centavos > BigInt(MAX_SAFE_MONEY_CENTAVOS);
};

export const parseMoneyToCentavos = (value) => {
    const centavos = getMoneyCentavosBigInt(value);
    if (centavos === null || centavos > BigInt(MAX_SAFE_MONEY_CENTAVOS)) return null;
    return Number(centavos);
};

export const moneyFromCentavos = (centavos) => {
    if (!Number.isSafeInteger(centavos) || centavos < 0) return null;
    return centavos / 100;
};

const buildEditedValue = (input, insertedText) => {
    const currentValue = String(input?.value ?? '');
    const selectionStart = Number.isInteger(input?.selectionStart) ? input.selectionStart : currentValue.length;
    const selectionEnd = Number.isInteger(input?.selectionEnd) ? input.selectionEnd : selectionStart;
    return `${currentValue.slice(0, selectionStart)}${insertedText}${currentValue.slice(selectionEnd)}`;
};

export const sanitizeWholeNumberInput = (value) => String(value ?? '').replace(/\D/g, '');

export const sanitizeMoneyInput = (value, maxDecimalPlaces = 2) => {
    const source = String(value ?? '');
    let result = '';
    let hasDecimalPoint = false;
    let decimalPlaces = 0;

    for (const character of source) {
        if (/\d/.test(character)) {
            if (!hasDecimalPoint || decimalPlaces < maxDecimalPlaces) {
                result += character;
                if (hasDecimalPoint) decimalPlaces += 1;
            }
            continue;
        }

        if (character === '.' && !hasDecimalPoint) {
            result += character;
            hasDecimalPoint = true;
        }
    }

    return result;
};

export const isWholeNumberInput = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
    const source = String(value ?? '');
    if (!/^\d+$/.test(source)) return false;

    const parsed = Number(source);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max;
};

export const isMoneyInput = (value, { min = 0, max = Number.MAX_VALUE, maxDecimalPlaces = 2 } = {}) => {
    const source = String(value ?? '');
    const expression = new RegExp(`^\\d+(?:\\.\\d{1,${maxDecimalPlaces}})?$`);
    if (!expression.test(source)) return false;

    const centavos = parseMoneyToCentavos(source);
    if (centavos === null) return false;

    const minCentavos = Math.ceil(Number(min) * 100);
    const maxCentavos = Number.isFinite(Number(max))
        ? Math.min(MAX_SAFE_MONEY_CENTAVOS, Math.floor(Number(max) * 100))
        : MAX_SAFE_MONEY_CENTAVOS;
    return centavos >= minCentavos && centavos <= maxCentavos;
};

export const preventInvalidWholeNumberKeyDown = (event) => {
    if (CONTROL_KEYS.has(event.key) || hasShortcutModifier(event)) return;
    if (!/^\d$/.test(event.key)) event.preventDefault();
};

export const preventInvalidMoneyKeyDown = (event, maxDecimalPlaces = 2) => {
    if (CONTROL_KEYS.has(event.key) || hasShortcutModifier(event)) return;
    if (!/^[\d.]$/.test(event.key)) {
        event.preventDefault();
        return;
    }

    const nextValue = buildEditedValue(event.currentTarget, event.key);
    const expression = new RegExp(`^\\d*(?:\\.\\d{0,${maxDecimalPlaces}})?$`);
    if (!expression.test(nextValue)) event.preventDefault();
};

export const preventInvalidWholeNumberPaste = (event) => {
    const pastedText = event.clipboardData?.getData('text') ?? '';
    if (!/^\d+$/.test(pastedText) || !/^\d*$/.test(buildEditedValue(event.currentTarget, pastedText))) {
        event.preventDefault();
    }
};

export const preventInvalidMoneyPaste = (event, maxDecimalPlaces = 2) => {
    const pastedText = event.clipboardData?.getData('text') ?? '';
    const expression = new RegExp(`^\\d*(?:\\.\\d{0,${maxDecimalPlaces}})?$`);
    if (!pastedText || !expression.test(pastedText) || !expression.test(buildEditedValue(event.currentTarget, pastedText))) {
        event.preventDefault();
    }
};

export const formatMoneyInput = (value) => {
    const source = String(value ?? '');
    const normalizableSource = /^\d+\.$/.test(source) ? source.slice(0, -1) : source;
    if (!isMoneyInput(normalizableSource)) return source;

    const [wholePart, decimalPart = ''] = normalizableSource.split('.');
    const normalizedWholePart = wholePart.replace(/^0+(?=\d)/, '') || '0';
    return `${normalizedWholePart}.${decimalPart.padEnd(2, '0')}`;
};
