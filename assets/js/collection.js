/* 컬렉션 목록 — 인스타 프로필 링크, 전시장 안내용 */
(function () {
  'use strict';

  var O = window.ONE;
  var esc = O.esc;
  var list = document.getElementById('list');
  var filtersEl = document.getElementById('filters');
  var FILTERS = [
    { key: 'all', label: '전체' },
    { key: 'available', label: '판매 가능' },
    { key: 'sold', label: '소장됨' }
  ];
  var current = 'all';
  var catalog = null;

  O.loadCatalog().then(function (data) {
    catalog = data;
    var site = data.site || {};
    if (site.tagline) document.getElementById('tagline').textContent = site.tagline;
    var insta = document.getElementById('instaChip');
    if (site.instagramUrl) insta.href = site.instagramUrl; else insta.remove();
    document.getElementById('footer').insertAdjacentHTML('beforeend', esc(site.notice || ''));
    renderFilters();
    renderList();
  }).catch(function (err) {
    console.error(err);
    list.innerHTML = '<div class="empty">작품 정보를 불러오지 못했어요.<br>잠시 후 다시 시도해 주세요.</div>';
  });

  function published() {
    return (catalog.artworks || []).filter(function (a) { return a.published; });
  }

  function renderFilters() {
    var works = published();
    filtersEl.innerHTML = FILTERS.map(function (f) {
      var n = f.key === 'all' ? works.length : works.filter(function (a) { return a.status === f.key; }).length;
      return '<button class="filter" type="button" data-key="' + f.key + '" aria-pressed="' + (f.key === current) + '">' + f.label + ' ' + n + '</button>';
    }).join('');
    filtersEl.onclick = function (e) {
      var b = e.target.closest('[data-key]');
      if (!b) return;
      current = b.getAttribute('data-key');
      renderFilters();
      renderList();
    };
  }

  function renderList() {
    var works = published().filter(function (a) { return current === 'all' || a.status === current; });
    if (!works.length) {
      list.innerHTML = '<div class="empty">해당하는 작품이 없어요.</div>';
      return;
    }
    list.innerHTML = '<div class="cards">' + works.map(function (a) {
      var ar = O.artistOf(catalog, a) || {};
      var st = O.STATUS[a.status] || O.STATUS.available;
      var img = a.images && a.images[0] ? O.asset(a.images[0].src) : '';
      return '<a class="card" href="a/?id=' + encodeURIComponent(a.id) + '&src=web">' +
        (img ? '<img src="' + esc(img) + '" alt="' + esc(a.title) + '" loading="lazy">' : '<div class="skeleton" style="aspect-ratio:1;animation:none"></div>') +
        '<div class="card-body"><div class="card-no">ONE #' + esc(a.id) + '</div>' +
        '<div class="card-title">' + esc(a.title) + '</div>' +
        '<div class="card-meta">' + esc([ar.name, a.year].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="card-foot"><span>' + (a.status === 'available' ? esc(O.won(a.price)) : '') + '</span>' +
        '<span class="status ' + st.tone + '">' + st.label + '</span></div></div></a>';
    }).join('') + '</div>';
  }
})();
