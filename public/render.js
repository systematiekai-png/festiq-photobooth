/* Gedeelde renderer voor de booth en de ontwerpeditor:
   filters, stickers en het tekenen van fotostrips met kaders (ontwerpen). */
(function () {
  'use strict';

  /* ---------- filters ---------- */
  const FILTERS = {
    none:   { label: 'Normaal',   css: 'none' },
    bw:     { label: 'Zwart-wit', css: 'grayscale(1) contrast(1.1)' },
    sepia:  { label: 'Sepia',     css: 'sepia(.9) contrast(1.05)' },
    vintage:{ label: 'Vintage',   css: 'sepia(.4) contrast(1.15) saturate(1.3) hue-rotate(-10deg) brightness(.95)' },
    vivid:  { label: 'Levendig',  css: 'saturate(1.6) contrast(1.15)' },
    warm:   { label: 'Warm',      css: 'sepia(.25) saturate(1.3) hue-rotate(-8deg) brightness(1.05)' },
    cool:   { label: 'Koel',      css: 'saturate(1.1) hue-rotate(15deg) brightness(1.03)' },
    glow:   { label: 'Glow',      css: 'brightness(1.15) contrast(.9) saturate(1.25)' },
  };

  // Safari (iPad) kent ctx.filter soms niet: dan rekenen we de pixels zelf uit.
  const CTX_FILTER = (() => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 2;
      const x = c.getContext('2d'); if (!('filter' in x)) return false;
      x.filter = 'grayscale(1)'; x.fillStyle = '#f00'; x.fillRect(0, 0, 2, 2);
      const d = x.getImageData(0, 0, 1, 1).data;
      return Math.abs(d[0] - d[1]) < 6;
    } catch { return false; }
  })();

  function sat(r, g, b, s) { const y = .299 * r + .587 * g + .114 * b; return [y + (r - y) * s, y + (g - y) * s, y + (b - y) * s]; }
  function pixelFilter(d, name) {
    const con = (v, c) => (v - 128) * c + 128;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      switch (name) {
        case 'bw': { const y = .299 * r + .587 * g + .114 * b; r = g = b = con(y, 1.1); break; }
        case 'sepia': { const R = .393 * r + .769 * g + .189 * b, G = .349 * r + .686 * g + .168 * b, B = .272 * r + .534 * g + .131 * b;
          r = r * .1 + R * .9; g = g * .1 + G * .9; b = b * .1 + B * .9; break; }
        case 'vintage': { const R = .393 * r + .769 * g + .189 * b, G = .349 * r + .686 * g + .168 * b, B = .272 * r + .534 * g + .131 * b;
          r = r * .6 + R * .4; g = g * .6 + G * .4; b = b * .6 + B * .4; [r, g, b] = sat(r, g, b, 1.3); r = con(r, 1.15) * .95 + 6; g = con(g, 1.15) * .95; b = con(b, 1.15) * .95 - 6; break; }
        case 'vivid': [r, g, b] = sat(r, g, b, 1.6); r = con(r, 1.15); g = con(g, 1.15); b = con(b, 1.15); break;
        case 'warm': [r, g, b] = sat(r, g, b, 1.25); r = r * 1.05 + 14; g = g * 1.05 + 3; b = b * 1.05 - 12; break;
        case 'cool': [r, g, b] = sat(r, g, b, 1.1); r = r * 1.03 - 8; g = g * 1.03 + 2; b = b * 1.03 + 14; break;
        case 'glow': [r, g, b] = sat(r, g, b, 1.25); r = con(r, .9) * 1.15; g = con(g, .9) * 1.15; b = con(b, .9) * 1.15; break;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }

  /* tekent src (video/canvas) met filter in ctx; crop = {sx,sy,sw,sh} of null */
  function drawFiltered(ctx, src, crop, x, y, w, h, name, doMirror) {
    ctx.save();
    if (doMirror) { ctx.translate(x * 2 + w, 0); ctx.scale(-1, 1); }
    if (CTX_FILTER && name !== 'none') ctx.filter = FILTERS[name].css;
    if (crop) ctx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, x, y, w, h); else ctx.drawImage(src, x, y, w, h);
    ctx.restore();
    if (!CTX_FILTER && name !== 'none') {
      const id = ctx.getImageData(x, y, w, h); pixelFilter(id.data, name); ctx.putImageData(id, x, y);
    }
  }
  function coverCrop(sw, sh, aspect) {
    let cw = sw, ch = sw / aspect;
    if (ch > sh) { ch = sh; cw = sh * aspect; }
    return { sx: (sw - cw) / 2, sy: (sh - ch) / 2, sw: cw, sh: ch };
  }
  function lum(hex) { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

  /* ---------- stickers ---------- */
  const O = 'stroke="#fff" stroke-width="4" stroke-linejoin="round"';
  const petals = (attrs) => Array.from({ length: 8 }, (_, k) => `<ellipse cx="50" cy="25" rx="11" ry="21" transform="rotate(${k * 45} 50 50)" ${attrs}/>`).join('');
  const SVG = {
    star:    (c) => `<path d="M50 6l13 28 30 4-22 21 6 30-27-15-27 15 6-30L7 38l30-4z" fill="${c}" ${O}/>`,
    sparkle: (c) => `<path d="M50 4C54 32 68 46 96 50 68 54 54 68 50 96 46 68 32 54 4 50 32 46 46 32 50 4z" fill="${c}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>`,
    heart:   (c) => `<path d="M50 88C20 66 8 46 8 30 8 17 18 9 29 9c9 0 16 5 21 13 5-8 12-13 21-13 11 0 21 8 21 21 0 16-12 36-42 58z" fill="${c}" ${O}/>`,
    clover:  () => `<path d="M50 50Q58 78 70 94" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/>
      <g fill="#fff" stroke="#fff" stroke-width="9"><circle cx="36" cy="36" r="19"/><circle cx="64" cy="36" r="19"/><circle cx="36" cy="64" r="19"/><circle cx="64" cy="64" r="19"/></g>
      <path d="M50 50Q58 78 70 94" stroke="#3f9b3f" stroke-width="6" fill="none" stroke-linecap="round"/>
      <g fill="#5bc25b"><circle cx="36" cy="36" r="19"/><circle cx="64" cy="36" r="19"/><circle cx="36" cy="64" r="19"/><circle cx="64" cy="64" r="19"/></g>
      <g stroke="#3f9b3f" stroke-width="2.5" stroke-linecap="round" fill="none"><path d="M50 50L30 30"/><path d="M50 50L70 30"/><path d="M50 50L30 70"/><path d="M50 50L70 70"/></g>`,
    daisy:   () => `<g fill="#fff" stroke="#fff" stroke-width="8">${petals('')}</g><g fill="#fff" stroke="#d8d8ea" stroke-width="1.5">${petals('')}</g><circle cx="50" cy="50" r="13" fill="#ffcf3d" stroke="#fff" stroke-width="3"/>`,
    butterfly: (c) => `<g stroke="#fff" stroke-width="4" stroke-linejoin="round"><ellipse cx="30" cy="38" rx="25" ry="20" transform="rotate(-25 30 38)" fill="${c}"/><ellipse cx="70" cy="38" rx="25" ry="20" transform="rotate(25 70 38)" fill="${c}"/>
      <ellipse cx="35" cy="68" rx="16" ry="13" transform="rotate(20 35 68)" fill="${c}" fill-opacity=".85"/><ellipse cx="65" cy="68" rx="16" ry="13" transform="rotate(-20 65 68)" fill="${c}" fill-opacity=".85"/></g>
      <rect x="46.5" y="28" width="7" height="50" rx="3.5" fill="#33406b" stroke="#fff" stroke-width="2"/>
      <path d="M48 28Q44 14 38 10M52 28Q56 14 62 10" stroke="#33406b" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <g fill="#fff" fill-opacity=".55"><circle cx="24" cy="36" r="5"/><circle cx="76" cy="36" r="5"/></g>`,
    bow:     (c) => `<g fill="${c}" ${O}><path d="M50 50L10 26Q1 50 10 74Z"/><path d="M50 50L90 26Q99 50 90 74Z"/><path d="M46 58L30 94l13-6 7 9z"/><path d="M54 58L70 94l-13-6-7 9z"/><rect x="39" y="37" width="22" height="26" rx="9"/></g>
      <g stroke="#fff" stroke-opacity=".6" stroke-width="2.5" fill="none" stroke-linecap="round"><path d="M18 40Q28 50 18 62"/><path d="M82 40Q72 50 82 62"/></g>`,
    rainbow: () => `<g fill="none" stroke-width="9" stroke-linecap="round"><path d="M12 72A38 38 0 0 1 88 72" stroke="#ff7a8a"/><path d="M22 72A28 28 0 0 1 78 72" stroke="#ffd166"/><path d="M32 72A18 18 0 0 1 68 72" stroke="#7bd8ff"/></g>
      <g fill="#fff" stroke="#d3e4ff" stroke-width="2"><circle cx="13" cy="77" r="10"/><circle cx="25" cy="80" r="8"/><circle cx="4" cy="82" r="6"/><circle cx="87" cy="77" r="10"/><circle cx="75" cy="80" r="8"/><circle cx="96" cy="82" r="6"/></g>`,
    cloud:   () => `<g fill="#fff" stroke="#d3e4ff" stroke-width="3"><circle cx="30" cy="62" r="20"/><circle cx="52" cy="46" r="26"/><circle cx="76" cy="62" r="20"/><rect x="30" y="58" width="46" height="24" rx="12"/></g><g fill="#fff"><circle cx="30" cy="62" r="18"/><circle cx="52" cy="46" r="24"/><circle cx="76" cy="62" r="18"/></g>`,
    bubble:  (c) => `<circle cx="50" cy="50" r="42" fill="${c}" fill-opacity=".28" stroke="${c}" stroke-width="4"/><path d="M27 42A25 25 0 0 1 43 26" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="70" cy="68" r="4" fill="#fff" fill-opacity=".8"/>`,
    dot:     (c) => `<circle cx="50" cy="50" r="42" fill="${c}"/>`,
    crown:   (c) => `<path d="M12 80L6 30l24 22 20-34 20 34 24-22-6 50z" fill="${c}" ${O}/><g fill="#fff" stroke="${c}" stroke-width="3"><circle cx="6" cy="28" r="6"/><circle cx="50" cy="16" r="6"/><circle cx="94" cy="28" r="6"/></g><rect x="14" y="80" width="72" height="9" rx="4" fill="${c}" ${O}/>`,
    drop:    (c) => `<path d="M50 6C70 30 88 46 84 66 80 84 66 94 50 94 34 94 20 84 16 66 12 46 30 30 50 6z" fill="${c}" ${O}/><path d="M34 62A18 18 0 0 0 44 78" stroke="#fff" stroke-opacity=".7" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    moon:    (c) => `<path d="M62 8A44 44 0 1 0 92 62 34 34 0 0 1 62 8z" fill="${c}" ${O}/>`,
  };
  const STICKER_NAMES = Object.keys(SVG);
  const STICKER_LABELS = { star: 'Ster', sparkle: 'Glinster', heart: 'Hart', clover: 'Klaver', daisy: 'Madelief', butterfly: 'Vlinder', bow: 'Strik', rainbow: 'Regenboog', cloud: 'Wolk', bubble: 'Bel', dot: 'Stip', crown: 'Kroon', drop: 'Druppel', moon: 'Maan' };
  const STICKER_COLORS = { star: '#ffd84d', sparkle: '#ffe27a', heart: '#ff7fa8', butterfly: '#7fb2ff', bow: '#ff9ec4', bubble: '#8fd0ff', dot: '#8cc8f0', crown: '#ffa41c', drop: '#ff2a93', moon: '#ffd84d' };
  const STICKER_TINTABLE = new Set(Object.keys(STICKER_COLORS));

  function builtinSvg(name, color) {
    const c = color || STICKER_COLORS[name] || '#ffffff';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">${SVG[name](c)}</svg>`;
  }
  const builtinDataUrl = (name, color) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(builtinSvg(name, color));

  const cache = new Map(); // key -> HTMLImageElement | null
  const stickerKey = (s) => s.src + '|' + (s.src.startsWith('b:') ? (s.color || STICKER_COLORS[s.src.slice(2)] || '') : '');
  function stickerUrl(s) {
    if (s.src.startsWith('b:')) { const n = s.src.slice(2); return SVG[n] ? builtinDataUrl(n, s.color) : null; }
    if (s.src.startsWith('u:')) return '/media/stickers/' + encodeURIComponent(s.src.slice(2));
    return null;
  }
  function loadSticker(s) {
    const key = stickerKey(s);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const url = stickerUrl(s);
    if (!url) { cache.set(key, null); return Promise.resolve(null); }
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => { cache.set(key, img); res(img); };
      img.onerror = () => { cache.set(key, null); res(null); };
      img.src = url;
    });
  }
  /* laadt alle stickers van een lijst ontwerpen voor we tekenen */
  function preload(templates) {
    const jobs = [];
    (templates || []).forEach((t) => (t.stickers || []).forEach((s) => jobs.push(loadSticker(s))));
    return Promise.all(jobs);
  }
  function forgetSticker(src) { [...cache.keys()].forEach((k) => k.startsWith(src + '|') && cache.delete(k)); }

  /* ---------- fotostrip tekenen ---------- */
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }
  function makeCell(src, w, h, filter) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: !CTX_FILTER });
    drawFiltered(x, src, coverCrop(src.width, src.height, w / h), 0, 0, w, h, filter, false);
    return c;
  }
  function fitText(ctx, text, maxW, size, weight) {
    ctx.font = `${weight} ${size}px -apple-system,system-ui,sans-serif`;
    while (ctx.measureText(text).width > maxW && size > 8) { size -= 2; ctx.font = `${weight} ${size}px -apple-system,system-ui,sans-serif`; }
    return size;
  }

  /*  shots: array van canvassen; tpl: ontwerp; info: {name, footer, brand};
      guestFilter: filter gekozen door de gast (genegeerd als het ontwerp een vast filter heeft)
      opts.untilted: teken zonder kanteling (voor de editor) */
  function renderStrip(shots, tpl, info, guestFilter, opts) {
    opts = opts || {};
    const n = shots.length;
    const film = tpl.style === 'film';
    const frame = tpl.frame_color === 'brand' ? (info.brand || '#7c5cff') : tpl.frame_color;
    const filter = 'none'; // filters zijn verwijderd
    const ratio = n === 1 ? Math.min(16 / 9, Math.max(3 / 4, shots[0].width / shots[0].height)) : ({ '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4 }[tpl.aspect] || 4 / 3);
    const pw = n === 1 ? Math.min(1500, shots[0].width) : 720;
    const ph = Math.round(pw / ratio);
    const pad = Math.round(pw * .05), gap = Math.round(pw * .035), side = film ? Math.round(pw * .12) : pad;
    const showFooter = tpl.show_footer !== false;
    const foot = showFooter ? Math.round(pw * (n === 1 ? .1 : .2)) : 0;
    const W = pw + side * 2, H = pad + n * ph + (n - 1) * gap + pad + foot;
    const S = Math.round(W * .08), CW = W + S * 2, CH = H + S * 2;

    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const x = c.getContext('2d');

    // kader (met zachte schaduw)
    x.save(); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = CW * .03; x.shadowOffsetY = CW * .01;
    x.fillStyle = frame; rr(x, S, S, W, H, W * (tpl.frame_radius || 0) / 100); x.fill(); x.restore();

    // filmgaatjes
    if (film) {
      const hw = side * .38, hh = side * .5, step = side * .95;
      x.fillStyle = lum(frame) > .5 ? '#333' : '#f4ede3';
      for (let yy = S + step * .45; yy + hh < S + H - step * .2; yy += step) {
        rr(x, S + (side - hw) / 2, yy, hw, hh, hw * .3); x.fill();
        rr(x, S + W - side + (side - hw) / 2, yy, hw, hh, hw * .3); x.fill();
      }
    }

    // foto's
    for (let i = 0; i < n; i++) {
      const px = S + side, py = S + pad + i * (ph + gap);
      const cell = makeCell(shots[i], pw, ph, filter);
      x.save(); rr(x, px, py, pw, ph, pw * (tpl.photo_radius || 0) / 100); x.clip(); x.drawImage(cell, px, py); x.restore();
    }

    // tekst onderaan
    if (showFooter) {
      const color = !tpl.text_color || tpl.text_color === 'auto' ? (lum(frame) > .6 ? '#222222' : '#ffffff') : tpl.text_color;
      const top = S + pad + n * ph + (n - 1) * gap, cy = top + (pad + foot) / 2;
      const main = tpl.caption || info.name || '', sub = info.footer || '';
      x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
      const base = foot * (n === 1 ? .36 : .3);
      if (main) {
        const sz = fitText(x, main, W * .86, base, 700);
        x.fillText(main, S + W / 2, cy - (sub ? sz * .55 : 0));
        if (sub) { const s2 = fitText(x, sub, W * .86, sz * .72, 500); x.globalAlpha = .85; x.fillText(sub, S + W / 2, cy + sz * .6); x.globalAlpha = 1; }
      } else if (sub) { fitText(x, sub, W * .86, base, 600); x.fillText(sub, S + W / 2, cy); }
    }

    // stickers
    for (const s of tpl.stickers || []) {
      const img = cache.get(stickerKey(s)); if (!img) continue;
      const sw = s.size * CW, sh = sw * (img.naturalHeight || 1) / (img.naturalWidth || 1);
      x.save(); x.translate(s.x * CW, s.y * CH); x.rotate((s.rot || 0) * Math.PI / 180); x.drawImage(img, -sw / 2, -sh / 2, sw, sh); x.restore();
    }

    // achtergrond + kanteling
    const th = (opts.untilted ? 0 : (tpl.tilt || 0)) * Math.PI / 180;
    const FW = th ? Math.ceil(Math.abs(CW * Math.cos(th)) + Math.abs(CH * Math.sin(th))) : CW;
    const FH = th ? Math.ceil(Math.abs(CW * Math.sin(th)) + Math.abs(CH * Math.cos(th))) : CH;
    const out = document.createElement('canvas'); out.width = FW; out.height = FH;
    const o = out.getContext('2d');
    const g = o.createLinearGradient(0, 0, FW * .6, FH); g.addColorStop(0, tpl.bg_color || '#f1f1f7'); g.addColorStop(1, tpl.bg_color2 || tpl.bg_color || '#f1f1f7');
    o.fillStyle = g; o.fillRect(0, 0, FW, FH);
    o.save(); o.translate(FW / 2, FH / 2); o.rotate(th); o.drawImage(c, -CW / 2, -CH / 2); o.restore();
    return out;
  }

  /* voorbeeldfoto's voor de editor (gegenereerd, geen echte personen) */
  function sampleShot(i) {
    const pals = [['#f6d6c3', '#c98d7a', '#5b4a63'], ['#cfe3f5', '#8fb0d6', '#3a4a6b'], ['#f3e3b5', '#d9b26a', '#6a4d3a'], ['#d6efd8', '#8fc79a', '#3c5a4a']];
    const [bgc, skin, dark] = pals[i % pals.length];
    const c = document.createElement('canvas'); c.width = 960; c.height = 720;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 960, 720); g.addColorStop(0, bgc); g.addColorStop(1, '#ffffff'); x.fillStyle = g; x.fillRect(0, 0, 960, 720);
    x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.arc(160 + i * 40, 150, 90, 0, 7); x.fill(); x.beginPath(); x.arc(820 - i * 30, 260, 60, 0, 7); x.fill();
    x.fillStyle = dark; x.beginPath(); x.ellipse(480, 760, 300, 230, 0, Math.PI, 0); x.fill();       // schouders
    x.fillStyle = skin; x.fillRect(440, 400, 80, 110);                                               // nek
    x.beginPath(); x.ellipse(480, 330, 118, 140, 0, 0, 7); x.fill();                                 // hoofd
    x.fillStyle = dark; x.beginPath(); x.ellipse(480, 262, 132, 120, 0, Math.PI, 0); x.fill();       // haar
    x.fillRect(348, 262, 30, 150); x.fillRect(582, 262, 30, 150);
    x.fillStyle = '#2b2233'; x.beginPath(); x.arc(440, 340, 9, 0, 7); x.arc(520, 340, 9, 0, 7); x.fill();
    x.strokeStyle = '#a4574f'; x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.arc(480, 385, 34, .2, Math.PI - .2); x.stroke();
    return c;
  }

  /* ---------- videokaders (overlay over 360°-video) ---------- */
  const frameImgs = new Map();
  function loadFrameImage(url) {
    if (!url) return Promise.resolve(null);
    if (!frameImgs.has(url)) frameImgs.set(url, new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
    }));
    return frameImgs.get(url);
  }
  function rr(x, px, py, w, h, r) {
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  }
  // frame: {kind:'builtin', id} | {kind:'image', img:HTMLImageElement}; info: {name, footer}
  function drawVideoFrame(x, w, h, frame, info) {
    if (!frame) return;
    info = info || {};
    if (frame.kind === 'image') { if (frame.img) x.drawImage(frame.img, 0, 0, w, h); return; }
    if (frame.id === 'b_film') {
      const band = h * .11;
      x.fillStyle = '#0d0b12'; x.fillRect(0, 0, w, band); x.fillRect(0, h - band, w, band);
      const hole = band * .38, gap = hole * 1.7, hh = hole * .72;
      x.fillStyle = '#fcf8ef';
      for (let px = gap * .5; px < w; px += gap) {
        rr(x, px, band * .31, hole, hh, hole * .22); x.fill();
        rr(x, px, h - band + band * .31, hole, hh, hole * .22); x.fill();
      }
      x.fillStyle = 'rgba(255,255,255,.07)'; x.fillRect(0, band, w, 2); x.fillRect(0, h - band - 2, w, 2);
      const t = (info.name || '').trim();
      if (t) {
        x.fillStyle = '#ffa41c'; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.font = `700 ${band * .2}px ui-monospace,Menlo,monospace`; x.fillText(t.toUpperCase(), w * .03, band + band * .23);
      }
    } else if (frame.id === 'b_festiq') {
      const b = w * .028, top = b, bot = h * .13;
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ff2a93'); g.addColorStop(.35, '#ffa41c'); g.addColorStop(.7, '#7c3aed'); g.addColorStop(1, '#1eb4ff');
      x.save(); x.fillStyle = g; x.beginPath(); x.rect(0, 0, w, h);
      const iw = w - b * 2, ih = h - top - bot, r = Math.min(iw, ih) * .05;
      x.moveTo(b + r, top); x.arcTo(b + iw, top, b + iw, top + ih, r); x.arcTo(b + iw, top + ih, b, top + ih, r);
      x.arcTo(b, top + ih, b, top, r); x.arcTo(b, top, b + iw, top, r); x.closePath();
      x.fill('evenodd'); x.restore();
      const t = ((info.name || '') + (info.footer ? '  •  ' + info.footer : '')).trim();
      if (t) {
        x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
        let s = bot * .38; x.font = `800 ${s}px ui-rounded,"SF Pro Rounded",-apple-system,system-ui,sans-serif`;
        while (x.measureText(t).width > w * .9 && s > 10) { s -= 2; x.font = `800 ${s}px ui-rounded,-apple-system,system-ui,sans-serif`; }
        x.fillText(t, w / 2, h - bot / 2 + 2);
      }
    }
  }
  const VIDEO_FRAME_LABELS = { b_film: 'Filmstrip', b_festiq: 'Festiq-kader' };

  window.PB = { FILTERS, CTX_FILTER, drawFiltered, pixelFilter, coverCrop, lum, renderStrip, sampleShot, preload, loadSticker, forgetSticker,
    drawVideoFrame, loadFrameImage, VIDEO_FRAME_LABELS,
    STICKER_NAMES, STICKER_LABELS, STICKER_COLORS, STICKER_TINTABLE, builtinDataUrl, stickerKey };
})();
