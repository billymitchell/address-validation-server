// Deliberately retain numbers, unit identifiers, accents, and meaningful punctuation.
function text(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

const STREET_WORDS = new Map([
  ['street', 'st'], ['avenue', 'ave'], ['boulevard', 'blvd'], ['road', 'rd'],
  ['drive', 'dr'], ['lane', 'ln'], ['parkway', 'pkwy'], ['court', 'ct'],
  ['terrace', 'ter'], ['highway', 'hwy'], ['circle', 'cir'], ['place', 'pl'],
  ['apartment', 'apt'], ['suite', 'ste'],
]);

export function streetText(lines, regionCode) {
  let value = text((lines || []).join(' ')).replace(/[,]/g, ' ').replace(/\s+/g, ' ');
  // Avoid interpreting English words as abbreviations in other languages.
  if (regionCode === 'US') {
    value = value.split(' ').map((word) => {
      const plain = word.replace(/\.$/, '');
      return STREET_WORDS.get(plain) || (Array.from(STREET_WORDS.values()).includes(plain) ? plain : word);
    }).join(' ');
  }
  return value;
}

const US_STATES = new Map('Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY'.split('|').map((pair) => pair.toLowerCase().split(':')));

function state(value, regionCode) {
  const normalized = text(value);
  return regionCode === 'US' ? US_STATES.get(normalized) || normalized : normalized;
}

function postal(value, regionCode) {
  const normalized = text(value).replace(/[\s-]/g, '');
  // ZIP+4 enrichment is formatting for this checkout, which uses five-digit US ZIPs.
  return regionCode === 'US' && /^\d{5}(\d{4})?$/.test(normalized) ? normalized.slice(0, 5) : normalized;
}

export function fieldsChanged(original, suggested) {
  return ['locality', 'administrativeArea', 'postalCode'].some((field) => {
    if (!suggested[field]) return false; // An omitted component is not evidence of a correction.
    if (field === 'postalCode') return postal(original[field], original.regionCode) !== postal(suggested[field], original.regionCode);
    if (field === 'administrativeArea') return state(original[field], original.regionCode) !== state(suggested[field], original.regionCode);
    return text(original[field]) !== text(suggested[field]);
  });
}

export function streetsChanged(original, lines) {
  return lines.length > 0 && streetText(original.addressLines, original.regionCode) !== streetText(lines, original.regionCode);
}

// Mailing-only lines must not be compared with the submitted street address.
// Only discard a line if every word is accounted for by separate output fields.
export function internationalStreetLines(lines, components, organization) {
  const parts = [components.locality, components.administrativeArea, components.postalCode, organization]
    .map(text).filter(Boolean).sort((a, b) => b.length - a.length);
  return lines.filter((line) => {
    let remaining = text(line).replace(/,/g, ' ').replace(/\s+/g, ' ');
    while (remaining) {
      const part = parts.find((item) => remaining === item || remaining.startsWith(item + ' '));
      if (!part) return true;
      remaining = remaining.slice(part.length).trim();
    }
    return false;
  });
}

export function meaningfulChange(value) {
  if (Array.isArray(value)) return value.some(meaningfulChange);
  if (value && typeof value === 'object') return Object.values(value).some(meaningfulChange);
  if (typeof value !== 'string') return false;
  return !['', 'none', 'identical', 'verified', 'no change', 'unchanged', 'abbreviation', 'case'].includes(text(value));
}
