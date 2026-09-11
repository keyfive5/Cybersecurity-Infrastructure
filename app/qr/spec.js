/**
 * ISO/IEC 18004 constants and derived helpers.
 *
 * Everything in this file is pure data or pure math — no React, no RN.
 * It runs unmodified under `node --experimental-strip-types`.
 */

                                            

export const EC_LEVELS            = ['L', 'M', 'Q', 'H'];

/** Index into the per-level tables below. */
export const EC_ORDINAL                          = { L: 0, M: 1, Q: 2, H: 3 };

/** The 2-bit value written into the format information area. */
export const EC_FORMAT_BITS                          = { L: 1, M: 0, Q: 3, H: 2 };

/** Nominal recovery capacity, used for UI copy only. */
export const EC_RECOVERY                          = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/**
 * Error-correction codewords per block, indexed [ecOrdinal][version].
 * Index 0 of each row is unused padding so that versions read 1..40 directly.
 * Table 13-22 of ISO/IEC 18004.
 */
export const EC_CODEWORDS_PER_BLOCK             = [
  // L
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // M
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Q
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // H
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

if (EC_CODEWORDS_PER_BLOCK.some((row) => row.length !== MAX_VERSION + 1)) {
  throw new Error('EC_CODEWORDS_PER_BLOCK is malformed');
}

/** Number of error-correction blocks, indexed [ecOrdinal][version]. */
export const EC_BLOCKS             = [
  // L
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // M
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // Q
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // H
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

if (EC_BLOCKS.some((row) => row.length !== MAX_VERSION + 1)) {
  throw new Error('EC_BLOCKS is malformed');
}

/** Symbol width/height in modules for a given version. */
export function sizeForVersion(version        )         {
  return version * 4 + 17;
}

/**
 * Total number of modules available for data + error correction, i.e. the
 * whole symbol minus function patterns and format/version information.
 * Derived rather than tabulated so it cannot drift out of sync.
 */
export function rawDataModules(version        )         {
  const size = sizeForVersion(version);
  let result = size * size;
  result -= 8 * 8 * 3; // three finder patterns plus their separators
  result -= 15 * 2 + 1; // format information and the dark module
  result -= (size - 16) * 2; // timing patterns, excluding the finder overlap

  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    // Alignment patterns, minus the parts overlapping timing patterns.
    result -= (numAlign - 1) * (numAlign - 1) * 25;
    result -= (numAlign - 2) * 2 * 20;
    if (version >= 7) result -= 6 * 3 * 2; // version information
  }
  return result;
}

/** Number of 8-bit codewords the symbol carries in total. */
export function totalCodewords(version        )         {
  return Math.floor(rawDataModules(version) / 8);
}

/** Number of codewords available for the payload after error correction. */
export function dataCodewords(version        , ec         )         {
  const o = EC_ORDINAL[ec];
  return totalCodewords(version) - EC_CODEWORDS_PER_BLOCK[o][version] * EC_BLOCKS[o][version];
}

/** Payload capacity in bits. */
export function dataCapacityBits(version        , ec         )         {
  return dataCodewords(version, ec) * 8;
}

/**
 * Centre coordinates of the alignment patterns, computed per the algorithm in
 * clause 6.3.5 rather than from a lookup table.
 */
export function alignmentPatternPositions(version        )           {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  // Integer division here is deliberate — it is what produces the spacings
  // tabulated in Annex E. Version 32 is the one value the formula misses.
  const step =
    version === 32
      ? 26
      : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const result           = [];
  for (let pos = sizeForVersion(version) - 7; result.length < numAlign - 1; pos -= step) {
    result.unshift(pos);
  }
  result.unshift(6);
  return result;
}

                                                               

export const MODE_BITS                       = {
  numeric: 0x1,
  alphanumeric: 0x2,
  byte: 0x4,
  eci: 0x7,
};

/**
 * Character-count indicator width, by mode and version group
 * (1–9, 10–26, 27–40).
 */
export function charCountBits(mode      , version        )         {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  switch (mode) {
    case 'numeric':
      return [10, 12, 14][group];
    case 'alphanumeric':
      return [9, 11, 13][group];
    case 'byte':
      return [8, 16, 16][group];
    case 'eci':
      return 0;
  }
}

/** The 45-character alphanumeric set, in code order. */
export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function alphanumericValue(ch        )         {
  return ALPHANUMERIC_CHARSET.indexOf(ch);
}

/** ECI assignment number for UTF-8. */
export const ECI_UTF8 = 26;

/** Mask pattern predicates, indexed by mask number 0–7 (clause 7.8.2). */
export const MASK_FUNCTIONS                                            = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Penalty weights N1–N4 from clause 7.8.3.1. */
export const PENALTY_N1 = 3;
export const PENALTY_N2 = 3;
export const PENALTY_N3 = 40;
export const PENALTY_N4 = 10;
