/**
 * Reed–Solomon coding over GF(2^8) with the QR primitive polynomial
 * x^8 + x^4 + x^3 + x^2 + 1 (0x11D), per ISO/IEC 18004 clause 7.5.
 *
 * Both directions are implemented. Encoding is what a generator needs;
 * decoding is what lets this app verify its own output by recovering the
 * payload from the artwork it is about to export.
 */

const PRIMITIVE = 0x11d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE;
  }
  // Duplicate the table so that exponent addition never needs a modulo.
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

export function gfMul(a        , b        )         {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a        , b        )         {
  if (b === 0) throw new Error('division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP[LOG[a] + 255 - LOG[b]];
}

export function gfInv(a        )         {
  if (a === 0) throw new Error('no inverse of zero in GF(256)');
  return EXP[255 - LOG[a]];
}

export function gfPow(a        , n        )         {
  if (a === 0) return n === 0 ? 1 : 0;
  return EXP[(((LOG[a] * n) % 255) + 255) % 255];
}

/* ------------------------------------------------------------------ */
/* Polynomials, stored most-significant coefficient first.             */
/* ------------------------------------------------------------------ */

function polyMul(a          , b          )           {
  const out = new Array        (a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return out;
}

function polyAdd(a                   , b                   )           {
  const out = new Array        (Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < a.length; i++) out[i + out.length - a.length] = a[i];
  for (let i = 0; i < b.length; i++) out[i + out.length - b.length] ^= b[i];
  return out;
}

function polyScale(p                   , x        )           {
  return p.map((c) => gfMul(c, x));
}

function polyEval(p                   , x        )         {
  let y = 0;
  for (let i = 0; i < p.length; i++) y = gfMul(y, x) ^ p[i];
  return y;
}

/** Synthetic division; returns the remainder only. */
function polyRemainder(dividend                   , divisorDegree        )           {
  // Dividing by x^divisorDegree is just a truncation.
  return dividend.slice(dividend.length - divisorDegree);
}

function polyTrimLeadingZeros(p                   )           {
  let i = 0;
  while (i < p.length - 1 && p[i] === 0) i++;
  return p.slice(i);
}

const generatorCache = new Map                  ();

/** Generator polynomial (x - a^0)(x - a^1)...(x - a^(degree-1)). */
export function generatorPoly(degree        )           {
  const cached = generatorCache.get(degree);
  if (cached) return cached;
  let g = [1];
  for (let i = 0; i < degree; i++) g = polyMul(g, [1, EXP[i]]);
  generatorCache.set(degree, g);
  return g;
}

/**
 * Returns the `ecLen` error-correction codewords for `data`.
 */
export function rsEncode(data                   , ecLen        )           {
  const gen = generatorPoly(ecLen);
  const remainder = new Array        (ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) {
        remainder[i] ^= gfMul(gen[i + 1], factor);
      }
    }
  }
  return remainder;
}

                              
                                                                
                      
                                             
                          
  

/**
 * Corrects up to floor(ecLen / 2) symbol errors in place.
 *
 * Syndromes -> Berlekamp–Massey -> Chien search -> Forney. Returns null when
 * the received word is not correctable, which is exactly the signal the
 * verifier needs to say "this artwork will not scan".
 */
export function rsDecode(received                   , ecLen        )                        {
  const n = received.length;

  // Syndromes, with a leading zero so that indices line up with the
  // Berlekamp–Massey recurrence below.
  const syndromes = new Array        (ecLen + 1).fill(0);
  let hasError = false;
  for (let i = 0; i < ecLen; i++) {
    const s = polyEval(received, gfPow(2, i));
    syndromes[i + 1] = s;
    if (s !== 0) hasError = true;
  }
  if (!hasError) return { codewords: received.slice(), errorsCorrected: 0 };

  // --- Berlekamp–Massey: find the error locator polynomial. ---
  let errorLocator           = [1];
  let oldLocator           = [1];
  const syndromeShift = syndromes.length - ecLen;
  for (let i = 0; i < ecLen; i++) {
    const k = i + syndromeShift;
    let delta = syndromes[k];
    for (let j = 1; j < errorLocator.length; j++) {
      delta ^= gfMul(errorLocator[errorLocator.length - 1 - j], syndromes[k - j]);
    }
    oldLocator = oldLocator.concat([0]);
    if (delta !== 0) {
      if (oldLocator.length > errorLocator.length) {
        const newLocator = polyScale(oldLocator, delta);
        oldLocator = polyScale(errorLocator, gfInv(delta));
        errorLocator = newLocator;
      }
      errorLocator = polyAdd(errorLocator, polyScale(oldLocator, delta));
    }
  }
  errorLocator = polyTrimLeadingZeros(errorLocator);
  const errorCount = errorLocator.length - 1;
  if (errorCount === 0 || errorCount * 2 > ecLen) return null;

  // --- Chien search: the roots of the locator are the inverses of the error
  // positions, so evaluate at alpha^-i. ---
  const errorPositions           = [];
  for (let i = 0; i < n; i++) {
    if (polyEval(errorLocator, gfPow(2, -i)) === 0) {
      errorPositions.push(n - 1 - i);
    }
  }
  if (errorPositions.length !== errorCount) return null;

  // --- Forney: compute each error magnitude. ---
  // Rebuild the locator from the found positions (errata form), then derive
  // the evaluator as (S(x) * Lambda(x)) mod x^(count+1).
  const coefPositions = errorPositions.map((p) => n - 1 - p);
  let errataLocator           = [1];
  for (const coefPos of coefPositions) {
    errataLocator = polyMul(errataLocator, polyAdd([1], [gfPow(2, coefPos), 0]));
  }
  const reversedSyndromes = syndromes.slice().reverse();
  const evaluator = polyRemainder(
    polyMul(reversedSyndromes, errataLocator),
    errataLocator.length,
  ).reverse();

  const x = coefPositions.map((coefPos) => gfPow(2, coefPos));
  const codewords = received.slice();
  for (let i = 0; i < x.length; i++) {
    const xiInv = gfInv(x[i]);
    // Denominator: the formal derivative of the locator at xi, written as the
    // product form so that the GF(2^m) derivative special-casing is avoided.
    let locatorPrime = 1;
    for (let j = 0; j < x.length; j++) {
      if (j !== i) locatorPrime = gfMul(locatorPrime, 1 ^ gfMul(xiInv, x[j]));
    }
    if (locatorPrime === 0) return null;
    const y = gfMul(x[i], polyEval(evaluator.slice().reverse(), xiInv));
    codewords[errorPositions[i]] ^= gfDiv(y, locatorPrime);
  }

  // A miscorrection must never be reported as a success.
  for (let i = 0; i < ecLen; i++) {
    if (polyEval(codewords, gfPow(2, i)) !== 0) return null;
  }
  return { codewords, errorsCorrected: errorPositions.length };
}
