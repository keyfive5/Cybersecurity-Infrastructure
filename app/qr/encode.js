/**
 * QR Code encoder, ISO/IEC 18004.
 *
 * Covers all 40 versions, all four error-correction levels, numeric /
 * alphanumeric / byte modes with ECI, cost-optimal mode segmentation, and
 * all eight mask patterns scored by the penalty rules in clause 7.8.3.
 */

import {
  ALPHANUMERIC_CHARSET,
  EC_BLOCKS,
  EC_CODEWORDS_PER_BLOCK,
  EC_FORMAT_BITS,
  EC_LEVELS,
  EC_ORDINAL,
  ECI_UTF8,
  MASK_FUNCTIONS,
  MAX_VERSION,
  MIN_VERSION,
  MODE_BITS,
  PENALTY_N1,
  PENALTY_N2,
  PENALTY_N3,
  PENALTY_N4,
  alignmentPatternPositions,
  charCountBits,
  dataCodewords,
  sizeForVersion,
  totalCodewords,
} from './spec.js';
                                               
import { rsEncode } from './rs.js';

                       
             
                                                             
                   
                                                                    
                 
  

                             
                    
                                                                            
                      
                      
                                                                           
                
     
                                                                          
                                                                          
     
                    
     
                                                                           
                                            
     
                                    
  

                      
                  
                   
               
               
                                                                    
                      
                                                                 
                        
                      
                                                                 
                       
                            
                                                                 
                               
                  
  

/* ------------------------------------------------------------------ */
/* Text analysis                                                       */
/* ------------------------------------------------------------------ */

export function toCodePoints(text        )           {
  const out           = [];
  for (const ch of text) out.push(ch.codePointAt(0) );
  return out;
}

/** UTF-8 bytes for a single code point. Avoids depending on TextEncoder. */
export function utf8Bytes(codePoint        )           {
  if (codePoint < 0x80) return [codePoint];
  if (codePoint < 0x800) {
    return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
  }
  if (codePoint < 0x10000) {
    return [
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f),
    ];
  }
  return [
    0xf0 | (codePoint >> 18),
    0x80 | ((codePoint >> 12) & 0x3f),
    0x80 | ((codePoint >> 6) & 0x3f),
    0x80 | (codePoint & 0x3f),
  ];
}

export function utf8Encode(text        )           {
  const out           = [];
  for (const cp of toCodePoints(text)) out.push(...utf8Bytes(cp));
  return out;
}

function isNumericChar(cp        )          {
  return cp >= 0x30 && cp <= 0x39;
}

function isAlphanumericChar(cp        )          {
  return cp < 0x80 && ALPHANUMERIC_CHARSET.indexOf(String.fromCharCode(cp)) !== -1;
}

/**
 * Cost-optimal mode assignment via dynamic programming over the three modes.
 * Costs are tracked in sixths of a bit so that the fractional per-character
 * costs of numeric (10/3) and alphanumeric (11/2) modes stay exact.
 */
function computeCharacterModes(codePoints          , version        )         {
  const modeTypes         = ['byte', 'alphanumeric', 'numeric'];
  const headCosts = modeTypes.map((m) => (4 + charCountBits(m, version)) * 6);

  const charModes                    = [];
  let prevCosts = headCosts.slice();

  for (const cp of codePoints) {
    const curModes                  = [null, null, null];
    const curCosts = [Infinity, Infinity, Infinity];

    curCosts[0] = prevCosts[0] + utf8Bytes(cp).length * 8 * 6;
    curModes[0] = 'byte';
    if (isAlphanumericChar(cp)) {
      curCosts[1] = prevCosts[1] + 33;
      curModes[1] = 'alphanumeric';
    }
    if (isNumericChar(cp)) {
      curCosts[2] = prevCosts[2] + 20;
      curModes[2] = 'numeric';
    }

    // Consider starting a fresh run in mode j, continuing from mode k.
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) {
        const newCost = Math.ceil(curCosts[k] / 6) * 6 + headCosts[j];
        if (curModes[k] !== null && (curModes[j] === null || newCost < curCosts[j])) {
          curCosts[j] = newCost;
          curModes[j] = modeTypes[k];
        }
      }
    }
    charModes.push(curModes);
    prevCosts = curCosts;
  }

  // Cheapest terminal mode, then trace the choices backwards.
  let curMode       = 'byte';
  let minCost = Infinity;
  for (let i = 0; i < 3; i++) {
    if (prevCosts[i] < minCost) {
      minCost = prevCosts[i];
      curMode = modeTypes[i];
    }
  }
  const result         = new Array(codePoints.length);
  for (let i = codePoints.length - 1; i >= 0; i--) {
    const j = modeTypes.indexOf(curMode);
    curMode = charModes[i][j] ;
    result[i] = curMode;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Segment construction                                                 */
/* ------------------------------------------------------------------ */

function pushBits(bits          , value        , length        )       {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

export function makeNumericSegment(digits        )          {
  const bits           = [];
  for (let i = 0; i < digits.length; ) {
    const n = Math.min(3, digits.length - i);
    pushBits(bits, parseInt(digits.substring(i, i + n), 10), n * 3 + 1);
    i += n;
  }
  return { mode: 'numeric', numChars: digits.length, bits };
}

export function makeAlphanumericSegment(text        )          {
  const bits           = [];
  let i = 0;
  for (; i + 2 <= text.length; i += 2) {
    const v =
      ALPHANUMERIC_CHARSET.indexOf(text[i]) * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
    pushBits(bits, v, 11);
  }
  if (i < text.length) pushBits(bits, ALPHANUMERIC_CHARSET.indexOf(text[i]), 6);
  return { mode: 'alphanumeric', numChars: text.length, bits };
}

export function makeByteSegment(bytes          )          {
  const bits           = [];
  for (const b of bytes) pushBits(bits, b, 8);
  return { mode: 'byte', numChars: bytes.length, bits };
}

export function makeEciSegment(assignment        )          {
  const bits           = [];
  if (assignment < 0) throw new Error('invalid ECI assignment');
  if (assignment < 1 << 7) pushBits(bits, assignment, 8);
  else if (assignment < 1 << 14) {
    pushBits(bits, 2, 2);
    pushBits(bits, assignment, 14);
  } else if (assignment < 1000000) {
    pushBits(bits, 6, 3);
    pushBits(bits, assignment, 21);
  } else throw new Error('ECI assignment out of range');
  return { mode: 'eci', numChars: 0, bits };
}

/** Builds the optimal segment list for `text` at a given version. */
export function makeSegments(text        , version        , eciMode                             )            {
  const codePoints = toCodePoints(text);
  const segments            = [];

  const needsUtf8 = codePoints.some((cp) => cp > 0xff);
  if (eciMode === 'always' || (eciMode === 'auto' && needsUtf8)) {
    segments.push(makeEciSegment(ECI_UTF8));
  }
  if (codePoints.length === 0) return segments;

  const modes = computeCharacterModes(codePoints, version);
  let runStart = 0;
  for (let i = 1; i <= codePoints.length; i++) {
    if (i === codePoints.length || modes[i] !== modes[runStart]) {
      const run = codePoints.slice(runStart, i);
      const mode = modes[runStart];
      if (mode === 'numeric') {
        segments.push(makeNumericSegment(run.map((cp) => String.fromCodePoint(cp)).join('')));
      } else if (mode === 'alphanumeric') {
        segments.push(
          makeAlphanumericSegment(run.map((cp) => String.fromCodePoint(cp)).join('')),
        );
      } else {
        const bytes           = [];
        for (const cp of run) bytes.push(...utf8Bytes(cp));
        segments.push(makeByteSegment(bytes));
      }
      runStart = i;
    }
  }
  return segments;
}

export function segmentBitLength(segments           , version        )         {
  let total = 0;
  for (const seg of segments) {
    total += 4 + charCountBits(seg.mode, version) + seg.bits.length;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Codeword assembly                                                    */
/* ------------------------------------------------------------------ */

function segmentsToCodewords(segments           , version        , ec         )           {
  const capacityBits = dataCodewords(version, ec) * 8;
  const bits           = [];
  for (const seg of segments) {
    pushBits(bits, MODE_BITS[seg.mode], 4);
    if (seg.mode !== 'eci') pushBits(bits, seg.numChars, charCountBits(seg.mode, version));
    for (const b of seg.bits) bits.push(b);
  }
  if (bits.length > capacityBits) throw new Error('data does not fit');

  // Terminator, then pad to a byte boundary, then alternating pad codewords.
  pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
  pushBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
    pushBits(bits, pad, 8);
  }

  const codewords           = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return codewords;
}

/** Splits into blocks, appends error correction, and interleaves (clause 7.6). */
export function addEccAndInterleave(data          , version        , ec         )           {
  const o = EC_ORDINAL[ec];
  const numBlocks = EC_BLOCKS[o][version];
  const blockEccLen = EC_CODEWORDS_PER_BLOCK[o][version];
  const rawCodewords = totalCodewords(version);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks             = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsEncode(dat, blockEccLen);
    if (i < numShortBlocks) dat.push(0); // placeholder keeps rows rectangular
    blocks.push(dat.concat(ecc));
  }

  const result           = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Matrix construction                                                  */
/* ------------------------------------------------------------------ */

             
               
                      
                        
  

function makeGrid(size        )       {
  return {
    size,
    modules: new Uint8Array(size * size),
    functions: new Uint8Array(size * size),
  };
}

function setFunctionModule(g      , x        , y        , dark         )       {
  g.modules[y * g.size + x] = dark ? 1 : 0;
  g.functions[y * g.size + x] = 1;
}

function drawFinderPattern(g      , cx        , cy        )       {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < g.size && y >= 0 && y < g.size) {
        setFunctionModule(g, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignmentPattern(g      , cx        , cy        )       {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunctionModule(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormatBits(g      , ec         , mask        )       {
  const data = (EC_FORMAT_BITS[ec] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i        ) => ((bits >>> i) & 1) !== 0;

  for (let i = 0; i <= 5; i++) setFunctionModule(g, 8, i, bit(i));
  setFunctionModule(g, 8, 7, bit(6));
  setFunctionModule(g, 8, 8, bit(7));
  setFunctionModule(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunctionModule(g, 14 - i, 8, bit(i));

  for (let i = 0; i < 8; i++) setFunctionModule(g, g.size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunctionModule(g, 8, g.size - 15 + i, bit(i));
  setFunctionModule(g, 8, g.size - 8, true); // the dark module
}

function drawVersionBits(g      , version        )       {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) !== 0;
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(g, a, b, bit);
    setFunctionModule(g, b, a, bit);
  }
}

function drawFunctionPatterns(g      , version        , ec         )       {
  // Timing patterns
  for (let i = 0; i < g.size; i++) {
    setFunctionModule(g, 6, i, i % 2 === 0);
    setFunctionModule(g, i, 6, i % 2 === 0);
  }
  // Finder patterns, drawn after timing so their separators win.
  drawFinderPattern(g, 3, 3);
  drawFinderPattern(g, g.size - 4, 3);
  drawFinderPattern(g, 3, g.size - 4);

  const positions = alignmentPatternPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const skipCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!skipCorner) drawAlignmentPattern(g, positions[i], positions[j]);
    }
  }

  drawFormatBits(g, ec, 0); // placeholder; rewritten once the mask is chosen
  drawVersionBits(g, version);
}

function drawCodewords(g      , data          )       {
  let i = 0;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < g.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? g.size - 1 - vert : vert;
        const idx = y * g.size + x;
        if (!g.functions[idx] && i < data.length * 8) {
          g.modules[idx] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
}

function applyMask(g      , mask        )       {
  const fn = MASK_FUNCTIONS[mask];
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      const idx = y * g.size + x;
      if (!g.functions[idx] && fn(y, x)) g.modules[idx] ^= 1;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mask penalty scoring (clause 7.8.3.1)                                */
/* ------------------------------------------------------------------ */

function finderPenaltyAddHistory(g      , runLength        , history          )       {
  if (history[0] === 0) runLength += g.size; // the light border before the symbol
  history.pop();
  history.unshift(runLength);
}

function finderPenaltyCountPatterns(history          )         {
  const n = history[1];
  const core =
    n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
  return (
    (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) +
    (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0)
  );
}

function finderPenaltyTerminate(
  g      ,
  runColor        ,
  runLength        ,
  history          ,
)         {
  if (runColor) {
    finderPenaltyAddHistory(g, runLength, history);
    runLength = 0;
  }
  runLength += g.size; // the light border after the symbol
  finderPenaltyAddHistory(g, runLength, history);
  return finderPenaltyCountPatterns(history);
}

export function penaltyScore(g      )         {
  let result = 0;
  const at = (x        , y        ) => g.modules[y * g.size + x];

  // N1 (runs) and N3 (finder-like patterns), scanned by row then by column.
  for (let y = 0; y < g.size; y++) {
    let runColor = 0;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let x = 0; x < g.size; x++) {
      if (at(x, y) === runColor) {
        runLength++;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result++;
      } else {
        finderPenaltyAddHistory(g, runLength, history);
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
        runColor = at(x, y);
        runLength = 1;
      }
    }
    result += finderPenaltyTerminate(g, runColor, runLength, history) * PENALTY_N3;
  }
  for (let x = 0; x < g.size; x++) {
    let runColor = 0;
    let runLength = 0;
    const history = [0, 0, 0, 0, 0, 0, 0];
    for (let y = 0; y < g.size; y++) {
      if (at(x, y) === runColor) {
        runLength++;
        if (runLength === 5) result += PENALTY_N1;
        else if (runLength > 5) result++;
      } else {
        finderPenaltyAddHistory(g, runLength, history);
        if (!runColor) result += finderPenaltyCountPatterns(history) * PENALTY_N3;
        runColor = at(x, y);
        runLength = 1;
      }
    }
    result += finderPenaltyTerminate(g, runColor, runLength, history) * PENALTY_N3;
  }

  // N2: same-coloured 2x2 blocks.
  for (let y = 0; y < g.size - 1; y++) {
    for (let x = 0; x < g.size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) {
        result += PENALTY_N2;
      }
    }
  }

  // N4: deviation of the dark-module proportion from 50%.
  let dark = 0;
  for (let i = 0; i < g.modules.length; i++) dark += g.modules[i];
  const total = g.size * g.size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;

  return result;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                   */
/* ------------------------------------------------------------------ */

export function encodeText(text        , options                = {})         {
  const requestedEc = options.ecLevel ?? 'M';
  const minVersion = Math.max(MIN_VERSION, options.minVersion ?? MIN_VERSION);
  const maxVersion = Math.min(MAX_VERSION, options.maxVersion ?? MAX_VERSION);
  const boostEc = options.boostEc ?? true;
  const eciMode = options.eci ?? 'auto';
  if (minVersion > maxVersion) throw new Error('invalid version range');

  // Smallest version that holds the payload at the requested EC level.
  let version = minVersion;
  let segments            = makeSegments(text, version, eciMode);
  let usedBits = segmentBitLength(segments, version);
  for (;;) {
    const capacity = dataCodewords(version, requestedEc) * 8;
    if (usedBits <= capacity) break;
    if (version >= maxVersion) {
      throw new Error(
        `Content is too long: needs ${Math.ceil(usedBits / 8)} bytes, ` +
          `version ${maxVersion}-${requestedEc} holds ${Math.floor(capacity / 8)}.`,
      );
    }
    version++;
    // Character-count widths change at versions 10 and 27, so re-segment.
    if (version === 10 || version === 27) segments = makeSegments(text, version, eciMode);
    usedBits = segmentBitLength(segments, version);
  }

  // Spend any leftover capacity on stronger error correction.
  let ecLevel = requestedEc;
  if (boostEc) {
    for (const candidate of EC_LEVELS) {
      if (
        EC_ORDINAL[candidate] > EC_ORDINAL[ecLevel] &&
        usedBits <= dataCodewords(version, candidate) * 8
      ) {
        ecLevel = candidate;
      }
    }
  }

  const dataPart = segmentsToCodewords(segments, version, ecLevel);
  const allCodewords = addEccAndInterleave(dataPart, version, ecLevel);

  const size = sizeForVersion(version);
  const base = makeGrid(size);
  drawFunctionPatterns(base, version, ecLevel);
  drawCodewords(base, allCodewords);

  let bestMask = options.mask ?? -1;
  let bestPenalty = Infinity;
  if (bestMask < 0) {
    for (let m = 0; m < 8; m++) {
      const trial       = {
        size,
        modules: base.modules.slice(),
        functions: base.functions,
      };
      applyMask(trial, m);
      drawFormatBits(trial, ecLevel, m);
      const p = penaltyScore(trial);
      if (p < bestPenalty) {
        bestPenalty = p;
        bestMask = m;
      }
    }
  }

  applyMask(base, bestMask);
  drawFormatBits(base, ecLevel, bestMask);
  if (!Number.isFinite(bestPenalty)) bestPenalty = penaltyScore(base);

  const o = EC_ORDINAL[ecLevel];
  return {
    version,
    ecLevel,
    mask: bestMask,
    size,
    modules: base.modules,
    functions: base.functions,
    segments,
    dataBitsUsed: usedBits,
    dataBitsAvailable: dataCodewords(version, ecLevel) * 8,
    correctableCodewords:
      Math.floor(EC_CODEWORDS_PER_BLOCK[o][version] / 2) * EC_BLOCKS[o][version],
    penalty: bestPenalty,
  };
}

/**
 * Map of which modules belong to function patterns for a given version.
 * The decoder needs the same map to know which modules carry payload.
 */
export function functionModuleMap(version        )             {
  const g = makeGrid(sizeForVersion(version));
  drawFunctionPatterns(g, version, 'L');
  return g.functions;
}

/** Convenience accessor: is the module at (row, col) dark? */
export function isDark(qr                                       , row        , col        )          {
  if (row < 0 || col < 0 || row >= qr.size || col >= qr.size) return false;
  return qr.modules[row * qr.size + col] === 1;
}
