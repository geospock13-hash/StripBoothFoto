/* Generador de códigos QR (modo byte, corrección de errores nivel M).
   Basado en el algoritmo público de la norma ISO/IEC 18004. Sin dependencias. */
(function (global) {
  const ECC = [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28];
  const BLK = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];
  const raw = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
  const dataCw = v => Math.floor(raw(v) / 8) - ECC[v] * BLK[v];
  const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const divisor = d => { const r = new Array(d).fill(0); r[d - 1] = 1; let root = 1;
    for (let i = 0; i < d; i++) { for (let j = 0; j < d; j++) { r[j] = mul(r[j], root); if (j + 1 < d) r[j] ^= r[j + 1]; } root = mul(root, 2); } return r; };
  const remainder = (data, div) => { const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; };
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];

  function penalty(M, n) {
    let p = 0, dark = 0;
    for (let a = 0; a < 2; a++) for (let i = 0; i < n; i++) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const c = a ? M[j][i] : M[i][j], prev = a ? M[j - 1][i] : M[i][j - 1];
        if (c === prev) run++; else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
      const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3;
    }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) dark++;
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
    return p;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 1;
    for (; v <= 40; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCw(v) * 8) break;
    if (v > 40) throw new Error('Texto demasiado largo para un QR');
    const bits = [], app = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    app(4, 4); app(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => app(b, 8));
    const cap = dataCw(v) * 8;
    app(0, Math.min(4, cap - bits.length)); app(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) app(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    const nb = BLK[v], el = ECC[v], rc = Math.floor(raw(v) / 8), ns = nb - rc % nb, sl = Math.floor(rc / nb), div = divisor(el);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const d = data.slice(k, k + sl - el + (i < ns ? 0 : 1)); k += d.length;
      const e = remainder(d, div); if (i < ns) d.push(0); blocks.push(d.concat(e));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== sl - el || j >= ns) cw.push(b[i]); });

    const n = v * 4 + 17;
    const M = Array.from({ length: n }, () => Array(n).fill(false));
    const F = Array.from({ length: n }, () => Array(n).fill(false));
    const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < n && yy >= 0 && yy < n) set(xx, yy, d !== 2 && d !== 4); } };
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    if (v > 1) {
      const cnt = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (cnt * 2 - 2)) * 2, pos = [6];
      for (let p = n - 7; pos.length < cnt; p -= step) pos.splice(1, 0, p);
      pos.forEach((a, i) => pos.forEach((b, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === cnt - 1) || (i === cnt - 1 && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const fmt = mask => {
      const d = (0 << 3) | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) set(8, i, g(i));
      set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) set(n - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) set(8, n - 15 + i, g(i));
      set(8, n - 8, true);
    };
    fmt(0);
    if (v >= 7) {
      let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) !== 0, a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
    }
    let idx = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert;
        if (!F[y][x] && idx < cw.length * 8) { M[y][x] = ((cw[idx >>> 3] >>> (7 - (idx & 7))) & 1) !== 0; idx++; }
      }
    }
    const apply = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { apply(m); fmt(m); const p = penalty(M, n); if (p < bestP) { bestP = p; best = m; } apply(m); }
    apply(best); fmt(best);
    return { size: n, modules: M };
  }

  /* Dibuja el QR en un canvas nuevo con zona de silencio de 4 módulos. */
  function toCanvas(text, px, dark, light) {
    const q = encode(text), border = 4, total = q.size + border * 2;
    const scale = Math.max(1, Math.floor((px || 320) / total));
    const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!c) return q;
    c.width = c.height = total * scale;
    const x = c.getContext('2d');
    x.fillStyle = light || '#ffffff'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = dark || '#000000';
    for (let y = 0; y < q.size; y++) for (let xx = 0; xx < q.size; xx++)
      if (q.modules[y][xx]) x.fillRect((xx + border) * scale, (y + border) * scale, scale, scale);
    return c;
  }

  global.QR = { encode, toCanvas };
  if (typeof module !== 'undefined') module.exports = global.QR;
})(typeof window !== 'undefined' ? window : globalThis);
