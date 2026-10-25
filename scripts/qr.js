"use strict";

/* ============ QR-код без библиотек ============ */
// Байтовый режим, коррекция L или M, версии 1–10 (до ~200 символов) — хватает на ссылки-приглашения.
// qrMatrix(text) → массив строк-массивов из 0/1; qrSvg(text, opts) → SVG-строка.
const QR_ECC = { // [байт коррекции на блок, число блоков] по версиям 1..10
  L: { cw: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], bl: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], bits: 1 },
  M: { cw: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26], bl: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5], bits: 0 },
};

function qrRawModules(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36; }
  return r;
}
function qrAlign(v) {
  if (v === 1) return [];
  const a = Math.floor(v / 7) + 2, size = v * 4 + 17, step = Math.ceil((v * 4 + 4) / (a * 2 - 2)) * 2, res = [6];
  for (let p = size - 7; res.length < a; p -= step) res.splice(1, 0, p);
  return res;
}
// Арифметика в GF(256), многочлен 0x11D
function qrMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
function qrGen(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++) { for (let j = 0; j < deg; j++) { r[j] = qrMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; } root = qrMul(root, 2); }
  return r;
}
function qrRem(data, gen) {
  const r = new Array(gen.length).fill(0);
  for (const b of data) { const f = b ^ r.shift(); r.push(0); gen.forEach((c, i) => { r[i] ^= qrMul(c, f); }); }
  return r;
}

function qrMatrix(text, level = "M") {
  const bytes = [...new TextEncoder().encode(text)];
  let ecc = QR_ECC[level], ver = 0;
  for (let v = 1; v <= 10; v++) {
    const cap = Math.floor(qrRawModules(v) / 8) - ecc.cw[v - 1] * ecc.bl[v - 1];
    if (bytes.length + (v < 10 ? 2 : 3) <= cap) { ver = v; break; }
  }
  if (!ver) { level = "L"; ecc = QR_ECC.L; for (let v = 1; v <= 10; v++) { const cap = Math.floor(qrRawModules(v) / 8) - ecc.cw[v - 1] * ecc.bl[v - 1]; if (bytes.length + (v < 10 ? 2 : 3) <= cap) { ver = v; break; } } }
  if (!ver) throw new Error("QR: текст слишком длинный");
  const size = ver * 4 + 17, total = Math.floor(qrRawModules(ver) / 8), nb = ecc.bl[ver - 1], eb = ecc.cw[ver - 1], dataCw = total - eb * nb;

  // биты данных
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataCw * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  for (let pad = 0xec; data.length < dataCw; pad ^= 0xec ^ 0x11) data.push(pad);

  // блоки + коррекция + перемежение
  const gen = qrGen(eb), shortLen = Math.floor(total / nb) - eb, nLong = total % nb, blocks = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen + (i < nb - nLong ? 0 : 1), d = data.slice(k, k + len); k += len;
    blocks.push({ d, e: qrRem(d, gen) });
  }
  const out = [];
  for (let i = 0; i <= shortLen; i++) blocks.forEach(b => { if (i < b.d.length) out.push(b.d[i]); });
  for (let i = 0; i < eb; i++) blocks.forEach(b => out.push(b.e[i]));

  // модули
  const mod = Array.from({ length: size }, () => new Array(size).fill(0)), fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { mod[y][x] = d ? 1 : 0; fn[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const al = qrAlign(ver);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const d = (ecc.bits << 3) | mask; let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412, g = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i));
    set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, g(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7) {
    let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const v = (ver << 12) | r;
    for (let i = 0; i < 18; i++) { const b = ((v >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, b); set(c, a, b); }
  }

  // размещение данных зигзагом
  const cells = [];
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!fn[y][x]) { const bit = bi < out.length * 8 ? ((out[bi >>> 3] >>> (7 - (bi & 7))) & 1) : 0; bi++; mod[y][x] = bit; cells.push([x, y]); }
    }
  }
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
  // выбираем маску с минимальным штрафом (правила 1 и 3 упрощённо — этого хватает для уверенного чтения)
  const penalty = m => {
    let p = 0;
    for (let k = 0; k < 2; k++) for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const c = k ? m[b][a] : m[a][b], pr = k ? m[b - 1][a] : m[a][b - 1];
        if (c === pr) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
    return p;
  };
  let best = 0, bestP = Infinity, final = null;
  for (let k = 0; k < 8; k++) {
    const m = mod.map(r => r.slice());
    cells.forEach(([x, y]) => { if (masks[k](x, y)) m[y][x] ^= 1; });
    const p = penalty(m);
    if (p < bestP) { bestP = p; best = k; final = m; }
  }
  mod.forEach((r, y) => r.forEach((_, x) => { mod[y][x] = final[y][x]; }));
  drawFormat(best);
  return mod;
}

function qrSvg(text, o = {}) {
  const m = qrMatrix(text, o.level || "M"), n = m.length, q = o.quiet === undefined ? 3 : o.quiet;
  let d = "";
  m.forEach((row, y) => { for (let x = 0; x < n; x++) if (row[x]) d += `M${x + q} ${y + q}h1v1h-1z`; });
  const s = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR-код приглашения"><rect width="${s}" height="${s}" fill="${o.bg || "#fff"}"/><path d="${d}" fill="${o.fg || "#0b0d12"}"/></svg>`;
}
