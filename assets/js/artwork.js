/* 작품 상세 페이지 — NFC(src=nfc)와 QR(src=qr)이 여는 화면 */
(function () {
  'use strict';

  var O = window.ONE;
  var esc = O.esc;
  var app = document.getElementById('app');
  var id = (O.query('id') || '').trim();
  var src = O.query('src') || '';
  var isPreview = O.query('preview') === '1';

  var ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.6"/></svg>';
  var ICON_NFC = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/></svg>';

  /* ---------- 데이터 불러오기 ---------- */
  function getCatalog() {
    if (isPreview) {
      try {
        var raw = localStorage.getItem('one-preview');
        if (raw) return Promise.resolve(JSON.parse(raw));
      } catch (e) { /* 미리보기 데이터가 없으면 실제 데이터로 */ }
    }
    return O.loadCatalog();
  }

  getCatalog().then(render).catch(function (err) {
    console.error(err);
    showState('작품 정보를 불러오지 못했어요', '네트워크 연결을 확인한 뒤 다시 시도해 주세요.', true);
  });

  /* ---------- 렌더링 ---------- */
  function render(catalog) {
    var site = catalog.site || {};
    setupMenu(site);

    var artwork = (catalog.artworks || []).find(function (a) { return a.id === id; });
    if (!id || !artwork) {
      showState('작품을 찾을 수 없어요', id ? 'ONE #' + esc(id) + ' 번호의 작품 기록이 없습니다.' : '작품 번호가 없는 주소입니다.');
      return;
    }
    if (!artwork.published && !isPreview) {
      showState('준비 중인 작품이에요', 'ONE #' + esc(artwork.id) + ' 작품 정보는 작가 확인 후 공개됩니다.');
      return;
    }

    var artist = O.artistOf(catalog, artwork) || {};
    var status = O.STATUS[artwork.status] || O.STATUS.available;
    var fromNfc = src === 'nfc';
    // 판매 후 NFC로 들어온 소장자에게는 작품 기록을 먼저 보여준다.
    var recordFirst = fromNfc && (artwork.status === 'sold' || artwork.status === 'nfs');

    document.title = artwork.title + ' · ' + (artist.name || '') + ' | ONE #' + artwork.id;
    document.getElementById('topChip').textContent = fromNfc ? 'NFC 기록' : '작품 기록';

    var html = '';
    if (isPreview) html += '<div class="preview-bar">미리보기 · 아직 저장되지 않은 내용입니다</div>';
    html += '<div class="content">';

    if (fromNfc) {
      html += '<div class="nfc-note">' + ICON_NFC + '<span>작품 뒤 ONE NFC로 연결된 작품 기록입니다.</span></div>';
    }
    if (artwork.sample) {
      html += '<div class="sample-note">예시 데이터 · 실제 작품·인증 정보가 아닙니다</div>';
    }

    html += '<div class="eyebrow-row"><span class="serial">ONE<b>#' + esc(artwork.id) + '</b></span>' +
      '<span class="status ' + status.tone + '">' + status.label + '</span></div>';

    html += gallery(artwork);
    html += titleBlock(artwork, artist);
    html += stats(artwork, status);
    html += summaryRows(artwork);
    if (artwork.status === 'available') html += buyBox(artwork, site);

    var storySec = storySection(artwork);
    var artistSec = artistSection(artist);
    var recordSec = recordSection(artwork, artist);
    html += recordFirst ? recordSec + storySec + artistSec : storySec + artistSec + recordSec;

    html += careSection(artwork);
    html += othersSection(catalog, artwork, artist);

    html += '<div class="share-row"><button class="btn ghost" id="shareBtn" type="button">이 작품 공유하기</button></div>';
    html += '</div>';
    html += footer(site);

    app.innerHTML = html;
    bindGallery(artwork);
    bindShare(artwork, artist);
  }

  function gallery(artwork) {
    var images = (artwork.images || []).filter(function (im) { return im && im.src; });
    if (!images.length) {
      return '<div class="gallery"><div class="gallery-item"><div class="skeleton" style="aspect-ratio:4/3;animation:none"></div></div></div>';
    }
    var items = images.map(function (im, i) {
      return '<figure class="gallery-item"><button type="button" data-index="' + i + '" aria-label="이미지 크게 보기" style="padding:0;border:0;background:none;width:100%;display:block">' +
        '<img src="' + esc(O.asset(im.src)) + '" alt="' + esc(artwork.title + (im.caption ? ' — ' + im.caption : '')) + '"' + (i ? ' loading="lazy"' : '') + '></button>' +
        (images.length > 1 && im.caption ? '<figcaption>' + esc(im.caption) + '</figcaption>' : '') + '</figure>';
    }).join('');
    var dots = images.length > 1
      ? '<div class="dots" aria-hidden="true">' + images.map(function (_, i) { return '<span' + (i ? '' : ' class="on"') + '></span>'; }).join('') + '</div>'
      : '';
    return '<div class="gallery"><div class="gallery-track" id="track">' + items + '</div>' + dots + '</div>';
  }

  function titleBlock(artwork, artist) {
    var spec = [artwork.year, artwork.medium, O.sizeText(artwork.size)].filter(Boolean).map(esc).join(' · ');
    var who = [artist.name ? '<a href="#artist">' + esc(artist.name) + '</a>' : '', esc(artist.affiliation || '')].filter(Boolean).join(' · ');
    var v = artwork.verification || {};
    var badge = v.artistApproved
      ? '<div class="verify">' + ICON_CHECK + '작가 승인 인증' + (v.approvedAt ? ' <small>' + esc(O.dot(v.approvedAt)) + '</small>' : '') + '</div>'
      : '<div class="verify pending">작가 확인 대기 중</div>';
    return '<div class="title-block">' +
      '<h1>' + esc(artwork.title) + '</h1>' +
      (artwork.titleEn ? '<div class="title-en">' + esc(artwork.titleEn) + '</div>' : '') +
      '<div class="meta">' + (who ? who + '<br>' : '') + spec + (artwork.edition ? '<br>' + esc(artwork.edition) : '') + '</div>' +
      badge + '</div>';
  }

  function stats(artwork, status) {
    var left, right;
    if (artwork.status === 'sold') {
      left = stat('최초 판매가', artwork.showSoldPrice && artwork.price ? O.won(artwork.price) : '비공개', !(artwork.showSoldPrice && artwork.price));
      right = stat('최초 소장', artwork.soldAt ? O.dot(artwork.soldAt) : '—');
    } else if (artwork.status === 'nfs') {
      left = stat('판매', '비매품', true);
      right = stat('제작', artwork.year || '—');
    } else {
      left = stat(artwork.status === 'reserved' ? '판매가 · 예약 중' : '판매가', O.won(artwork.price) || '문의', !artwork.price);
      right = stat('실물 관람', artwork.viewingPlace || '문의 후 안내', true);
    }
    return '<div class="stats">' + left + right + '</div>';
  }

  function stat(label, value, isText) {
    return '<div class="stat"><span class="label">' + esc(label) + '</span><div class="value' + (isText ? ' text' : '') + '">' + esc(value) + '</div></div>';
  }

  function summaryRows(artwork) {
    var out = '';
    var ex = (artwork.exhibitions || []).filter(function (e) { return e.place; });
    if (ex.length) {
      out += row('전시 이력', '<div class="chain">' + ex.map(function (e) { return '<span>' + esc(e.place) + '</span>'; }).join('<i>→</i>') + '</div>');
    }
    if (artwork.quote) out += row('작품 이야기', esc(artwork.quote));
    if (artwork.status === 'sold') {
      var pv = (artwork.provenance || []).filter(function (p) { return p.label; });
      var last = pv[pv.length - 1];
      out += row('현재 소유 이력', last ? esc(last.label) + (last.from ? ' / ' + esc(O.period(last.from, last.to, '현재')) : '') : '비공개');
    }
    return out ? '<div class="rows">' + out + '</div>' : '';
  }

  function row(label, valueHtml) {
    return '<div class="row"><span class="label">' + esc(label) + '</span><div class="value">' + valueHtml + '</div></div>';
  }

  function buyBox(artwork, site) {
    var info = [];
    info.push(artwork.framed ? '액자 포함' : '액자 미포함');
    if (artwork.delivery) info.push(artwork.delivery);
    if (artwork.viewingPlace) info.push('실물 관람: ' + artwork.viewingPlace);
    var url = site.inquiryUrl || '';
    return '<div class="buy">' +
      '<div class="buy-price"><span class="label" style="margin:0">구매 안내</span><span class="value">' + esc(O.won(artwork.price) || '가격 문의') + '</span></div>' +
      '<ul>' + info.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      (url ? '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(site.inquiryLabel || '구매 문의하기') + '</a>' : '') +
      '<p style="margin:10px 0 0;font-size:12.5px;color:var(--faint);text-align:center">문의 시 작품번호 <b>ONE #' + esc(artwork.id) + '</b>를 알려주세요.</p>' +
      '</div>';
  }

  function storySection(artwork) {
    if (!artwork.quote && !artwork.story && !artwork.origin && !artwork.process && !artwork.video) return '';
    var html = '<section class="section" id="story"><div class="section-head"><h2>작품 이야기</h2><span class="eyebrow">Story</span></div>';
    if (artwork.quote) html += '<blockquote class="quote">“' + esc(artwork.quote) + '”</blockquote>';
    if (artwork.story) html += '<div class="prose">' + O.paragraphs(artwork.story) + '</div>';
    if (artwork.process) html += '<div class="sub-block"><h3>제작 과정</h3><div class="prose">' + O.paragraphs(artwork.process) + '</div></div>';
    if (artwork.origin) html += '<div class="sub-block"><h3>ONE에 오기까지</h3><div class="prose">' + O.paragraphs(artwork.origin) + '</div></div>';
    if (artwork.video) html += '<a class="video-link" href="' + esc(artwork.video) + '" target="_blank" rel="noopener">▶ 작가 인터뷰 영상 보기</a>';
    return html + '</section>';
  }

  function artistSection(artist) {
    if (!artist.name) return '';
    var avatar = artist.photo
      ? '<img class="avatar" src="' + esc(O.asset(artist.photo)) + '" alt="' + esc(artist.name) + ' 작가">'
      : '<div class="avatar" aria-hidden="true">' + esc(artist.name.charAt(0)) + '</div>';
    var html = '<section class="section" id="artist"><div class="section-head"><h2>작가</h2><span class="eyebrow">Artist</span></div>' +
      '<div class="artist">' + avatar + '<div><div class="artist-name">' + esc(artist.name) +
      (artist.nameEn ? '<span>' + esc(artist.nameEn) + '</span>' : '') + '</div>' +
      '<div class="artist-aff">' + esc(artist.affiliation || '') + '</div></div></div>';
    if (artist.bio) html += '<div class="prose">' + O.paragraphs(artist.bio) + '</div>';
    if (artist.history && artist.history.length) {
      html += '<ul class="history">' + artist.history.map(function (h) { return '<li>' + esc(h) + '</li>'; }).join('') + '</ul>';
    }
    if (artist.instagram) html += '<a class="text-link" href="' + esc(artist.instagram) + '" target="_blank" rel="noopener">작가 인스타그램 ↗</a>';
    return html + '</section>';
  }

  function recordSection(artwork, artist) {
    var v = artwork.verification || {};
    var items = [];
    items.push(['작품번호', 'ONE #' + esc(artwork.id)]);
    items.push(['작가', esc(artist.name || '—')]);
    items.push(['원작 구분', esc(artwork.edition || '—')]);
    items.push(['작가 승인', v.artistApproved ? '승인 완료' + (v.approvedAt ? ' · ' + esc(O.dot(v.approvedAt)) : '') : '확인 대기']);

    var ex = (artwork.exhibitions || []).filter(function (e) { return e.place; });
    if (ex.length) items.push(['전시 이력', timeline(ex.map(function (e) { return { title: e.place, sub: O.period(e.from, e.to, '현재') }; }))]);

    if (artwork.status === 'sold') {
      if (artwork.showSoldPrice && artwork.price) items.push(['최초 판매가', esc(O.won(artwork.price))]);
      if (artwork.soldAt) items.push(['최초 소장', esc(O.dot(artwork.soldAt))]);
    }
    var pv = (artwork.provenance || []).filter(function (p) { return p.label; });
    if (pv.length) items.push(['소유 이력', timeline(pv.map(function (p) { return { title: p.label, sub: O.period(p.from, p.to, '현재') }; }))]);

    return '<section class="section" id="record"><div class="section-head"><h2>작품 기록</h2><span class="eyebrow">Record</span></div>' +
      '<dl class="record-list">' + items.map(function (it) { return '<div><dt>' + it[0] + '</dt><dd>' + it[1] + '</dd></div>'; }).join('') + '</dl>' +
      '<p class="record-foot">작가 승인은 작가가 작품 사진·정보·원작 여부를 확인했다는 뜻입니다. 소유 이력은 소장자가 동의한 범위만 공개하며, NFC를 읽는 것만으로 소유권이 바뀌지 않습니다.</p>' +
      '</section>';
  }

  function timeline(list) {
    return '<ul class="timeline">' + list.map(function (t) {
      return '<li>' + esc(t.title) + (t.sub ? '<small>' + esc(t.sub) + '</small>' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function careSection(artwork) {
    if (!artwork.care) return '';
    return '<section class="section"><div class="section-head"><h2>작품 관리</h2><span class="eyebrow">Care</span></div>' +
      '<div class="prose">' + O.paragraphs(artwork.care) + '</div></section>';
  }

  function othersSection(catalog, artwork, artist) {
    var all = (catalog.artworks || []).filter(function (a) { return a.published && a.id !== artwork.id; });
    var same = all.filter(function (a) { return a.artistId === artwork.artistId; });
    var list = same.length ? same : all;
    if (!list.length) return '';
    var title = same.length ? esc(artist.name || '작가') + '의 다른 작품' : 'ONE의 다른 작품';
    return '<section class="section"><div class="section-head"><h2>' + title + '</h2><a class="text-link" style="margin:0" href="../">전체 보기</a></div>' +
      '<div class="cards">' + list.slice(0, 4).map(function (a) { return card(catalog, a); }).join('') + '</div></section>';
  }

  function card(catalog, a) {
    var ar = O.artistOf(catalog, a) || {};
    var st = O.STATUS[a.status] || O.STATUS.available;
    var img = a.images && a.images[0] ? O.asset(a.images[0].src) : '';
    return '<a class="card" href="?id=' + encodeURIComponent(a.id) + '&src=web">' +
      (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">' : '<div class="skeleton" style="aspect-ratio:1;animation:none"></div>') +
      '<div class="card-body"><div class="card-no">ONE #' + esc(a.id) + '</div><div class="card-title">' + esc(a.title) + '</div>' +
      '<div class="card-meta">' + esc(ar.name || '') + '</div>' +
      '<div class="card-foot"><span>' + (a.status === 'available' ? esc(O.won(a.price)) : '') + '</span><span class="status ' + st.tone + '">' + st.label + '</span></div></div></a>';
  }

  function footer(site) {
    return '<footer class="footer"><span class="logo">ONE</span>' +
      esc(site.tagline || '') + '<br>' + esc(site.notice || '') + '</footer>';
  }

  function showState(title, message, retry) {
    app.innerHTML = '<div class="state"><h1>' + esc(title) + '</h1><p>' + message + '</p>' +
      (retry ? '<button class="btn" type="button" onclick="location.reload()">다시 시도</button>' : '<a class="btn ghost" href="../">컬렉션 전체 보기</a>') + '</div>';
  }

  /* ---------- 상호작용 ---------- */
  function setupMenu(site) {
    var menu = document.getElementById('menu');
    var btn = document.getElementById('menuBtn');
    var insta = document.getElementById('menuInsta');
    var inquiry = document.getElementById('menuInquiry');
    if (site.instagramUrl) insta.href = site.instagramUrl; else insta.remove();
    if (site.inquiryUrl) inquiry.href = site.inquiryUrl; else inquiry.remove();
    function toggle(open) {
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.onclick = function () { toggle(true); };
    document.getElementById('menuClose').onclick = function () { toggle(false); };
    menu.addEventListener('click', function (e) { if (e.target === menu) toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { toggle(false); closeLightbox(); } });
  }

  function bindGallery(artwork) {
    var track = document.getElementById('track');
    if (!track) return;
    var dots = app.querySelectorAll('.dots span');
    track.addEventListener('scroll', function () {
      var i = Math.round(track.scrollLeft / track.clientWidth);
      dots.forEach(function (d, k) { d.classList.toggle('on', k === i); });
    }, { passive: true });
    track.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-index]');
      if (!b) return;
      var im = artwork.images[Number(b.getAttribute('data-index'))];
      openLightbox(O.asset(im.src), artwork.title + (im.caption ? ' — ' + im.caption : ''));
    });
    document.getElementById('lbClose').onclick = closeLightbox;
    document.getElementById('lightbox').addEventListener('click', function (e) {
      if (e.target.id === 'lightbox') closeLightbox();
    });
  }

  function openLightbox(url, caption) {
    document.getElementById('lbImg').src = url;
    document.getElementById('lbImg').alt = caption;
    document.getElementById('lbCap').textContent = caption;
    document.getElementById('lightbox').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    var lb = document.getElementById('lightbox');
    if (!lb.classList.contains('open')) return;
    lb.classList.remove('open');
    document.body.style.overflow = '';
  }

  function bindShare(artwork, artist) {
    var btn = document.getElementById('shareBtn');
    // 공유 링크에는 NFC/QR 유입 표시를 빼고 share로 남긴다.
    var url = location.origin + location.pathname + '?id=' + encodeURIComponent(artwork.id) + '&src=share';
    var text = artwork.title + ' · ' + (artist.name || '') + ' | ONE';
    btn.onclick = function () {
      if (navigator.share) {
        navigator.share({ title: text, url: url }).catch(function () {});
        return;
      }
      copy(url).then(function () { toast('링크를 복사했어요'); }, function () { toast(url); });
    };
  }

  function copy(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('clipboard unavailable'));
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
})();
