/* ONE 공통 유틸 — 공개 페이지와 관리자 페이지가 함께 사용 */
(function () {
  'use strict';

  // 각 HTML의 <html data-root="../"> 로 사이트 루트까지의 상대 경로를 지정한다.
  var ROOT = document.documentElement.getAttribute('data-root') || './';

  var STATUS = {
    available: { label: '판매 가능', tone: 'ok' },
    reserved: { label: '예약 중', tone: 'warn' },
    sold: { label: '소장됨', tone: 'done' },
    nfs: { label: '비매품', tone: 'muted' }
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function asset(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    return ROOT + String(path).replace(/^\/+/, '');
  }

  function won(n) {
    if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  function sizeText(size) {
    if (!size) return '';
    var parts = [size.w, size.h, size.d].filter(function (v) {
      return v !== null && v !== undefined && v !== '';
    });
    return parts.length ? parts.join(' × ') + ' cm' : '';
  }

  // '2026-09-16' → '2026.09.16', '2026-09' → '2026.09'
  function dot(date) {
    return date ? String(date).replace(/-/g, '.') : '';
  }

  function period(from, to, openLabel) {
    if (!from && !to) return '';
    if (from && !to) return dot(from) + '–' + (openLabel || '');
    if (!from) return '~' + dot(to);
    return dot(from) + '–' + dot(to);
  }

  // 빈 줄로 나눈 문단을 <p>로 바꾼다 (입력은 이스케이프).
  function paragraphs(text) {
    if (!text) return '';
    return String(text)
      .split(/\n\s*\n/)
      .map(function (p) { return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; })
      .join('');
  }

  function catalogUrl() {
    // GitHub Pages CDN 캐시를 피하려고 매번 다른 쿼리를 붙인다.
    return ROOT + 'data/catalog.json?v=' + Date.now();
  }

  function loadCatalog() {
    return fetch(catalogUrl(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('catalog ' + res.status);
      return res.json();
    });
  }

  function artistOf(catalog, artwork) {
    return (catalog.artists || []).find(function (a) { return a.id === artwork.artistId; }) || null;
  }

  function query(name) {
    return new URLSearchParams(location.search).get(name);
  }

  window.ONE = {
    ROOT: ROOT,
    STATUS: STATUS,
    esc: esc,
    asset: asset,
    won: won,
    sizeText: sizeText,
    dot: dot,
    period: period,
    paragraphs: paragraphs,
    loadCatalog: loadCatalog,
    artistOf: artistOf,
    query: query
  };
})();
