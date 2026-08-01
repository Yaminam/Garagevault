/**
 * Indian statutory identifiers.
 *
 * A GSTIN carries a checksum, so it can be verified rather than merely
 * pattern-matched. That matters here: a transposed digit in a GST number is
 * invisible to a regex and turns up months later as a rejected input credit.
 */

const CODES = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN state codes, per the GST council list. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (old)', '29': 'Karnataka',
  '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

export type GstinCheck =
  | { valid: true; state: string; stateCode: string; pan: string }
  | { valid: false; reason: string };

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/**
 * Validate a GSTIN, structure and checksum.
 *
 * Format is `SS PANPANPAN E Z C`: two-digit state, the holder's ten-character
 * PAN, an entity number, a literal Z, then a check character.
 */
export function checkGstin(raw: string): GstinCheck {
  const gstin = raw.replace(/\s/g, '').toUpperCase();

  if (gstin.length !== 15) {
    return { valid: false, reason: `A GSTIN is 15 characters, this is ${gstin.length}.` };
  }
  if (!GSTIN_SHAPE.test(gstin)) {
    return { valid: false, reason: 'Wrong shape for a GSTIN. Expected 22AAAAA0000A1Z5.' };
  }

  const stateCode = gstin.slice(0, 2);
  const state = GST_STATES[stateCode];
  if (!state) {
    return { valid: false, reason: `${stateCode} is not a GST state code.` };
  }

  // Alternating weights of 1 and 2 across the first fourteen characters, with
  // the digits of each product summed rather than the product itself.
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CODES.indexOf(gstin[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = CODES[(36 - (sum % 36)) % 36];

  if (expected !== gstin[14]) {
    return {
      valid: false,
      reason: `Checksum does not match. Expected the last character to be ${expected}.`,
    };
  }

  return { valid: true, state, stateCode, pan: gstin.slice(2, 12) };
}

/** PAN is five letters, four digits, one letter. The fourth letter is the holder type. */
const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const PAN_HOLDER: Record<string, string> = {
  P: 'Individual', C: 'Company', H: 'Hindu undivided family', F: 'Firm',
  A: 'Association of persons', T: 'Trust', B: 'Body of individuals',
  L: 'Local authority', J: 'Artificial juridical person', G: 'Government',
};

export type PanCheck =
  | { valid: true; holder: string }
  | { valid: false; reason: string };

export function checkPan(raw: string): PanCheck {
  const pan = raw.replace(/\s/g, '').toUpperCase();
  if (!PAN_SHAPE.test(pan)) {
    return { valid: false, reason: 'Wrong shape for a PAN. Expected AAAAA0000A.' };
  }
  const holder = PAN_HOLDER[pan[3]];
  if (!holder) {
    return { valid: false, reason: `${pan[3]} is not a valid holder type in position four.` };
  }
  return { valid: true, holder };
}

/** CIN is 21 characters. Structure only; there is no published checksum. */
export function checkCin(raw: string): { valid: boolean; reason?: string } {
  const cin = raw.replace(/\s/g, '').toUpperCase();
  if (cin.length !== 21) {
    return { valid: false, reason: `A CIN is 21 characters, this is ${cin.length}.` };
  }
  if (!/^[LUu][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(cin)) {
    return { valid: false, reason: 'Wrong shape for a CIN. Expected U72900KA2020PTC123456.' };
  }
  return { valid: true };
}

/* ------------------------------------------------------------- helpers ---- */

export const DEPARTMENTS = [
  'Engineering', 'Design', 'Content', 'Marketing', 'Sales', 'Operations',
  'Finance', 'People', 'Leadership', 'Support', 'Legal',
];

export const EMPLOYMENT_TYPES = ['Full time', 'Part time', 'Contract', 'Intern', 'Freelance'];
