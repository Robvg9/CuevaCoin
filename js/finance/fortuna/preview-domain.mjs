export const FORTUNA_CURRENCIES = Object.freeze(['CUP', 'USD', 'EUR']);
export const MAX_MINOR_UNITS = 9223372036854775807n;

export function normalizeContactDraft({ name, phone = '', notes = '' }) {
  const displayName = String(name ?? '').trim();
  const normalizedPhone = String(phone ?? '').trim();
  const normalizedNotes = String(notes ?? '').trim();

  if (!displayName || displayName.length > 120) {
    throw new Error('El nombre es obligatorio y admite hasta 120 caracteres.');
  }
  if (normalizedPhone.length > 40) {
    throw new Error('El teléfono admite hasta 40 caracteres.');
  }
  if (normalizedNotes.length > 1000) {
    throw new Error('Las notas admiten hasta 1000 caracteres.');
  }

  return { displayName, phone: normalizedPhone, notes: normalizedNotes };
}

export function parseMoneyToMinor(value) {
  const input = String(value ?? '').trim();
  // Accept comma OR dot as decimal separator. Thousands separators are rejected.
  if (!/^(?:0|[1-9][0-9]*)(?:[.,][0-9]{1,2})?$/.test(input)) {
    throw new Error('Usa un importe positivo con hasta dos decimales y sin separador de miles.');
  }

  const [whole, fraction = ''] = input.split(/[.,]/);
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));

  if (minor <= 0n) throw new Error('El importe debe ser mayor que cero.');
  if (minor > MAX_MINOR_UNITS) throw new Error('El importe supera el máximo admitido.');

  return minor.toString();
}

export function formatMinorAmount(value) {
  const input = String(value ?? '');
  if (!/^(?:0|[1-9][0-9]*)$/.test(input)) throw new Error('Unidades menores inválidas.');
  const minor = BigInt(input);
  const whole = (minor / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return whole + ',' + (minor % 100n).toString().padStart(2, '0');
}

export function validateObligationDraft({ direction, currency, amount, description }) {
  if (direction !== 'receivable' && direction !== 'payable') {
    throw new Error('Selecciona si te deben o si tú debes.');
  }
  if (!FORTUNA_CURRENCIES.includes(currency)) {
    throw new Error('Solo se admiten CUP, USD y EUR.');
  }
  const amountMinor = parseMoneyToMinor(amount);
  const cleanDescription = String(description ?? '').trim();
  if (!cleanDescription || cleanDescription.length > 500) {
    throw new Error('El concepto es obligatorio y admite hasta 500 caracteres.');
  }
  return { direction, currency, amountMinor, description: cleanDescription };
}

export function summarizeObligations(obligations = []) {
  const totals = new Map();

  for (const item of obligations) {
    const currency = String(item.currency ?? '');
    const direction = String(item.direction ?? '');
    const amount = String(item.amountMinor ?? '');

    if (!FORTUNA_CURRENCIES.includes(currency)) throw new Error('Moneda no admitida.');
    if (direction !== 'receivable' && direction !== 'payable') throw new Error('Dirección inválida.');
    if (!/^[1-9][0-9]*$/.test(amount)) throw new Error('Importe interno inválido.');

    const current = totals.get(currency) ?? { receivable: 0n, payable: 0n };
    current[direction] += BigInt(amount);
    totals.set(currency, current);
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, current]) => ({
      currency,
      receivableMinor: current.receivable.toString(),
      payableMinor: current.payable.toString(),
      mixed: current.receivable > 0n && current.payable > 0n
    }));
}
