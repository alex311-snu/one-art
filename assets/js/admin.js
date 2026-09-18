/* ONE 관리자 페이지 — 작품·작가·사이트 설정 편집 */
(function () {
  'use strict';

  var O = window.ONE;
  var S = window.ONEStore;
  var esc = O.esc;
  var app = document.getElementById('app');
  var GH_KEY = 'one-admin-github';

  var state = {
    store: null,
    catalog: null,
    filter: 'all',
    search: '',
    draft: null, // { kind: 'artwork'|'artist'|'settings', isNew, originalId, data, initial }
    saving: false
  };
  var pending = {};   // 'pending:xxx' → { base64, type, ext, url }  아직 저장 안 된 사진
  var blobCache = {}; // 저장된 경로 → blob URL  (GitHub Pages 재배포 전에도 썸네일이 보이도록)
  var lastHash = '';
  var ignoreHash = false;

  var STATUS_ORDER = ['available', 'reserved', 'sold', 'nfs'];

  /* =========================================================
   * 유틸
   * ======================================================= */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rand() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function byId(a, b) { return String(a.id).localeCompare(String(b.id), 'en', { numeric: true }); }
  function statusLabel(s) { return (O.STATUS[s] || { label: s }).label; }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function today() { var d = new Date(); return thisMonth() + '-' + String(d.getDate()).padStart(2, '0'); }

  function imgUrl(src) {
    if (!src) return '';
    if (pending[src]) return pending[src].url;
    if (blobCache[src]) return blobCache[src];
    return O.asset(src);
  }

  function findArtwork(id) { return state.catalog.artworks.find(function (a) { return a.id === id; }); }
  function findArtist(id) { return state.catalog.artists.find(function (a) { return a.id === id; }); }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (o, k) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; return o[k]; }, obj);
    target[last] = value;
  }

  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  function savedSuffix() {
    return state.store.mode === 'github' ? ' · 공개 페이지 반영까지 1~2분' : '';
  }

  function handleError(err) {
    console.error(err);
    if (err && err.code === 'conflict') {
      if (confirm(err.message + '\n\n지금 최신 데이터를 다시 불러올까요? (작성 중인 내용은 사라집니다)')) {
        reload();
      }
      return;
    }
    alert('저장하지 못했어요.\n\n' + (err && err.message ? err.message : err));
  }

  function reload() {
    state.store.load().then(function (cat) {
      setCatalog(normalize(cat));
      state.draft = null;
      route();
      toast('최신 데이터를 불러왔어요');
    }).catch(handleError);
  }

  /* =========================================================
   * 이미지 처리 — 휴대폰 사진을 긴 변 max px로 줄여 WebP(안 되면 JPEG)로
   * ======================================================= */
  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return loadImgEl(file); });
    }
    return loadImgEl(file);
  }
  function loadImgEl(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('이미지를 읽을 수 없어요: ' + file.name)); };
      img.src = url;
    });
  }
  function toBlob(canvas, type, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, type, q); });
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function processImage(file, max) {
    return loadImage(file).then(function (img) {
      var w = img.width, h = img.height;
      var scale = Math.min(1, max / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return toBlob(canvas, 'image/webp', 0.85).then(function (blob) {
        if (blob && blob.type === 'image/webp') return blob;
        return toBlob(canvas, 'image/jpeg', 0.88);
      });
    }).then(function (blob) {
      return blobToBase64(blob).then(function (b64) {
        var key = 'pending:' + rand();
        pending[key] = {
          base64: b64,
          type: blob.type,
          ext: blob.type === 'image/webp' ? 'webp' : 'jpg',
          url: URL.createObjectURL(blob),
          size: blob.size
        };
        return key;
      });
    });
  }

  // 저장소 안의 이미지이고, 다른 작품·작가가 쓰지 않는 경우에만 삭제 대상
  function deletableImage(src, catalog, exceptArtworkId, exceptArtistId) {
    if (!src || !/^images\//.test(src)) return false;
    var used = catalog.artworks.some(function (a) {
      return a.id !== exceptArtworkId && (a.images || []).some(function (im) { return im.src === src; });
    }) || catalog.artists.some(function (ar) { return ar.id !== exceptArtistId && ar.photo === src; });
    return !used;
  }

  /* =========================================================
   * 시작 · 연결
   * ======================================================= */
  function normalize(cat) {
    cat = cat || {};
    cat.site = cat.site || {};
    cat.artists = Array.isArray(cat.artists) ? cat.artists : [];
    cat.artworks = Array.isArray(cat.artworks) ? cat.artworks : [];
    return cat;
  }

  function setCatalog(cat) { state.catalog = cat; }

  function readCfg() { try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null'); } catch (e) { return null; } }
  function writeCfg(c) { try { localStorage.setItem(GH_KEY, JSON.stringify(c)); } catch (e) { /* 저장 못 해도 이번 세션은 동작 */ } }
  function clearCfg() { try { localStorage.removeItem(GH_KEY); } catch (e) { /* 무시 */ } }

  function boot() {
    S.LocalStore.detect(O.ROOT).then(function (isLocal) {
      if (isLocal) {
        return connect(new S.LocalStore(O.ROOT)).catch(function (e) {
          app.innerHTML = '<div class="state"><h1>데이터를 읽지 못했어요</h1><p>' + esc(e.message) + '</p></div>';
        });
      }
      var cfg = readCfg();
      if (cfg && cfg.token) {
        return connect(new S.GitHubStore(cfg)).catch(function (e) { renderConnect(e.message); });
      }
      renderConnect();
    });
  }

  function connect(store) {
    app.innerHTML = '<div class="state"><p>데이터를 불러오는 중…</p></div>';
    var verify = store.verify ? store.verify() : Promise.resolve();
    return verify.then(function () { return store.load(); }).then(function (cat) {
      state.store = store;
      setCatalog(normalize(cat));
      window.addEventListener('hashchange', onHash);
      window.addEventListener('beforeunload', function (e) {
        if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
      });
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && state.draft) {
          e.preventDefault();
          saveDraft();
        }
      });
      lastHash = location.hash;
      route();
    });
  }

  function guessRepo() {
    var host = location.hostname;
    if (!/\.github\.io$/.test(host)) return { owner: '', repo: '' };
    var seg = location.pathname.split('/').filter(Boolean);
    return { owner: host.replace(/\.github\.io$/, ''), repo: seg[0] && seg[0] !== 'admin' ? seg[0] : host };
  }

  function renderConnect(errorMsg) {
    var cfg = readCfg() || {};
    var g = guessRepo();
    app.innerHTML =
      '<div class="connect"><div class="fs">' +
      '<span class="logo">ONE</span><h2>관리자 로그인</h2>' +
      '<p class="desc">작품 정보는 GitHub 저장소에 저장됩니다. 처음 한 번만 입력하면 이 기기에서 기억합니다.</p>' +
      '<form id="connectForm" class="fields">' +
      field('half', '저장소 소유자', '<input type="text" name="owner" required autocomplete="off" placeholder="one-art-snu" value="' + esc(cfg.owner || g.owner) + '">') +
      field('half', '저장소 이름', '<input type="text" name="repo" required autocomplete="off" placeholder="one-nfc" value="' + esc(cfg.repo || g.repo) + '">') +
      field('', '브랜치', '<input type="text" name="branch" required value="' + esc(cfg.branch || 'main') + '">') +
      field('', 'GitHub 토큰', '<input type="password" name="token" required autocomplete="off" placeholder="github_pat_…">',
        '이 기기의 브라우저에만 저장되고, GitHub 외에는 어디에도 보내지 않습니다.') +
      '<div class="f"><button class="a-btn" type="submit">연결하기</button></div>' +
      '</form>' +
      (errorMsg ? '<p class="err">' + esc(errorMsg) + '</p>' : '') +
      '<details class="guide"><summary>토큰 발급 방법 (처음 한 번)</summary><ol>' +
      '<li>GitHub 로그인 → 오른쪽 위 프로필 → <b>Settings</b></li>' +
      '<li>왼쪽 맨 아래 <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b></li>' +
      '<li>Token name: <code>ONE 관리자 - 이름</code>, Expiration: 학기 말 날짜</li>' +
      '<li>Resource owner: 저장소 주인 계정(예: alex311-snu) → Repository access: <b>Only select repositories</b> → 이 저장소 하나만 선택</li><li>다른 팀원이 쓰려면: 저장소 Settings → Collaborators에서 팀원을 초대한 뒤, 팀원도 각자 토큰을 만듭니다</li>' +
      '<li>Permissions → Repository permissions → <b>Contents: Read and write</b> (나머지는 그대로)</li>' +
      '<li>Generate token → 나온 <code>github_pat_…</code> 값을 복사해 위에 붙여넣기</li>' +
      '</ol><p style="margin-top:10px">휴대폰을 잃어버리면 같은 화면에서 토큰을 삭제하세요.</p></details>' +
      '</div></div>';

    document.getElementById('connectForm').onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(e.target);
      var c = {
        owner: String(fd.get('owner')).trim(),
        repo: String(fd.get('repo')).trim(),
        branch: String(fd.get('branch')).trim() || 'main',
        token: String(fd.get('token')).trim()
      };
      connect(new S.GitHubStore(c)).then(function () { writeCfg(c); }).catch(function (err) { renderConnect(err.message); });
    };
  }

  /* =========================================================
   * 라우팅
   * ======================================================= */
  function isDirty() {
    var d = state.draft;
    if (!d) return false;
    return JSON.stringify(d.data) !== d.initial;
  }

  function onHash() {
    if (ignoreHash) { ignoreHash = false; return; }
    if (isDirty() && !confirm('저장하지 않은 변경 내용이 있어요. 이 화면을 나갈까요?')) {
      ignoreHash = true;
      location.hash = lastHash;
      return;
    }
    state.draft = null;
    lastHash = location.hash;
    route();
  }

  function go(hash) {
    if (location.hash === hash) { state.draft = null; route(); return; }
    location.hash = hash;
  }

  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var view = parts[0] || 'list';
    var arg = parts[1] ? decodeURIComponent(parts[1]) : '';
    window.scrollTo(0, 0);
    if (view === 'new') return openArtwork(null);
    if (view === 'edit') return openArtwork(arg);
    if (view === 'artists') return renderArtists();
    if (view === 'artist') return openArtist(arg === 'new' ? null : arg);
    if (view === 'settings') return openSettings();
    return renderList();
  }

  /* =========================================================
   * 공통 레이아웃
   * ======================================================= */
  function shell(active, inner) {
    var st = state.store;
    var navItem = function (key, label, href) {
      return '<a href="' + href + '"' + (active === key ? ' class="on" aria-current="page"' : '') + '>' + label + '</a>';
    };
    var mode = st.mode === 'local'
      ? '<span class="mode local" title="dev_server.py로 실행 중 — 파일이 이 컴퓨터에 바로 저장됩니다">로컬 테스트</span>'
      : '<span class="mode" title="' + esc(st.label) + ' · ' + esc(st.branch) + '">GitHub 연결됨</span>';
    var history = st.mode === 'github'
      ? '<a class="a-link" href="https://github.com/' + esc(st.owner) + '/' + esc(st.repo) + '/commits/' + esc(st.branch) + '" target="_blank" rel="noopener">변경 기록</a>'
      : '';
    return '<header class="a-top"><div class="wrap">' +
      '<a class="a-brand" href="#/list"><span class="logo">ONE</span><small>관리자</small></a>' +
      '<nav class="a-nav">' + navItem('list', '작품', '#/list') + navItem('artists', '작가', '#/artists') + navItem('settings', '설정', '#/settings') + '</nav>' +
      '<div class="a-right">' + mode + '<a class="a-link" href="../" target="_blank" rel="noopener">사이트 ↗</a>' + history +
      (st.mode === 'github' ? '<button class="a-link" type="button" id="logoutBtn">로그아웃</button>' : '') +
      '</div></div></header>' +
      '<main class="a-main"><div class="wrap">' + inner + '</div></main>';
  }

  function mount(html) {
    app.innerHTML = html;
    var lo = document.getElementById('logoutBtn');
    if (lo) lo.onclick = function () {
      if (isDirty() && !confirm('저장하지 않은 변경 내용이 사라집니다. 로그아웃할까요?')) return;
      clearCfg();
      location.hash = '';
      location.reload();
    };
    app.onclick = app.oninput = app.onchange = null;
  }

  function field(cls, label, control, help, required) {
    return '<label class="f' + (cls ? ' ' + cls : '') + '"><span>' + label + (required ? '<em>*</em>' : '') + '</span>' + control +
      (help ? '<small>' + help + '</small>' : '') + '</label>';
  }

  // data-k 로 draft.data 경로와 연결되는 입력 컨트롤
  function input(path, opts) {
    opts = opts || {};
    var v = getPath(state.draft.data, path);
    var type = opts.type || 'text';
    var attrs = ' data-k="' + path + '"' + (opts.num ? ' data-type="number"' : '') +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      (opts.disabled ? ' disabled' : '') + (opts.list ? ' list="' + opts.list + '"' : '') +
      (opts.step ? ' step="' + opts.step + '"' : '') + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '');
    if (type === 'textarea') return '<textarea' + attrs + (opts.rows ? ' rows="' + opts.rows + '"' : '') + '>' + esc(v) + '</textarea>';
    return '<input type="' + type + '"' + attrs + ' value="' + esc(v == null ? '' : v) + '">';
  }
  function checkbox(path, label, help) {
    var v = !!getPath(state.draft.data, path);
    return '<label class="check"><input type="checkbox" data-k="' + path + '"' + (v ? ' checked' : '') + '><span>' + label +
      (help ? '<small>' + help + '</small>' : '') + '</span></label>';
  }
  function select(path, options) {
    var v = getPath(state.draft.data, path);
    return '<select data-k="' + path + '">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  function readControl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.getAttribute('data-type') === 'number') return el.value === '' ? '' : Number(el.value);
    if (el.getAttribute('data-type') === 'lines') return el.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return el.value;
  }

  function saveBar(extraLeft) {
    return '<div class="savebar"><div class="wrap">' +
      '<span class="dirty" id="dirty">변경 사항 없음</span>' + (extraLeft || '') +
      '<a class="a-btn ghost" href="' + (state.draft.kind === 'artist' ? '#/artists' : '#/list') + '">닫기</a>' +
      '<button class="a-btn" type="button" id="saveBtn">저장</button>' +
      '</div></div>';
  }

  function refreshDirty() {
    var el = document.getElementById('dirty');
    if (!el) return;
    var dirty = isDirty();
    el.textContent = state.saving ? '저장 중…' : dirty ? '저장하지 않은 변경 사항이 있어요' : '변경 사항 없음';
    el.classList.toggle('on', dirty);
    var btn = document.getElementById('saveBtn');
    if (btn) btn.disabled = state.saving;
  }

  // 공통 저장: 성공했을 때만 state.catalog를 바꾼다.
  function saveChange(message, mutate, files) {
    var next = clone(state.catalog);
    mutate(next);
    var text = JSON.stringify(next, null, 2) + '\n';
    state.saving = true;
    refreshDirty();
    return state.store.commit(message, [{ path: S.CATALOG_PATH, text: text }].concat(files || []))
      .then(function () { setCatalog(next); })
      .finally(function () { state.saving = false; refreshDirty(); });
  }

  function saveDraft() {
    if (state.saving || !state.draft) return;
    if (state.draft.kind === 'artwork') return saveArtwork();
    if (state.draft.kind === 'artist') return saveArtist();
    if (state.draft.kind === 'settings') return saveSettings();
  }

  /* =========================================================
   * 작품 목록
   * ======================================================= */
  function renderList() {
    var works = state.catalog.artworks;
    var counts = { all: works.length };
    works.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var filters = [['all', '전체']].concat(STATUS_ORDER.map(function (s) { return [s, statusLabel(s)]; }));

    var html = '<div class="a-head"><div><h1>작품</h1><p>작품을 등록하고, 판매 상태를 바꾸고, NFC·QR 주소를 확인합니다.</p></div>' +
      '<a class="a-btn" href="#/new">+ 작품 추가</a></div>' +
      '<div class="toolbar"><div class="filters">' + filters.map(function (f) {
        return '<button class="filter" type="button" data-filter="' + f[0] + '" aria-pressed="' + (state.filter === f[0]) + '">' + f[1] + ' ' + (counts[f[0]] || 0) + '</button>';
      }).join('') + '</div>' +
      '<input class="search" type="search" id="search" placeholder="작품번호·작품명·작가 검색" value="' + esc(state.search) + '"></div>' +
      '<div id="rows"></div>';

    mount(shell('list', html));
    renderRows();

    app.onclick = function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { state.filter = f.getAttribute('data-filter'); renderList(); }
    };
    app.oninput = function (e) {
      if (e.target.id === 'search') { state.search = e.target.value; renderRows(); }
    };
    app.onchange = function (e) {
      var sel = e.target.closest('[data-status-of]');
      if (sel) changeStatus(sel.getAttribute('data-status-of'), sel.value, sel);
    };
  }

  function renderRows() {
    var q = state.search.trim().toLowerCase();
    var works = state.catalog.artworks.slice().sort(byId).filter(function (a) {
      if (state.filter !== 'all' && a.status !== state.filter) return false;
      if (!q) return true;
      var ar = findArtist(a.artistId) || {};
      return [a.id, a.title, a.titleEn, ar.name].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var rows = document.getElementById('rows');
    if (!state.catalog.artworks.length) {
      rows.innerHTML = '<div class="a-list"><div class="empty">아직 등록된 작품이 없어요.<br><a class="a-btn" style="margin-top:14px" href="#/new">첫 작품 추가하기</a></div></div>';
      return;
    }
    if (!works.length) { rows.innerHTML = '<div class="a-list"><div class="empty">조건에 맞는 작품이 없어요.</div></div>'; return; }
    rows.innerHTML = '<div class="a-list">' + works.map(function (a) {
      var ar = findArtist(a.artistId) || {};
      var st = O.STATUS[a.status] || O.STATUS.available;
      var img = a.images && a.images[0] ? imgUrl(a.images[0].src) : '';
      var v = a.verification || {};
      return '<div class="a-item">' +
        (img ? '<img class="a-thumb" src="' + esc(img) + '" alt="">' : '<div class="a-thumb"></div>') +
        '<div><div class="a-item-title"><span class="no">#' + esc(a.id) + '</span>' + esc(a.title || '(제목 없음)') + '</div>' +
        '<div class="a-item-meta"><span>' + esc([ar.name, a.year].filter(Boolean).join(' · ')) + '</span>' +
        (a.price ? '<span>' + esc(O.won(a.price)) + '</span>' : '') +
        (a.published ? '' : '<span class="flag off">비공개</span>') +
        (v.artistApproved ? '' : '<span class="flag">작가 확인 전</span>') +
        (a.sample ? '<span class="flag sample">예시</span>' : '') +
        '</div></div>' +
        '<div class="a-actions">' +
        '<select class="status-select ' + st.tone + '" data-status-of="' + esc(a.id) + '" aria-label="판매 상태">' +
        STATUS_ORDER.map(function (s) { return '<option value="' + s + '"' + (s === a.status ? ' selected' : '') + '>' + statusLabel(s) + '</option>'; }).join('') +
        '</select>' +
        '<a class="a-btn ghost sm" href="#/edit/' + encodeURIComponent(a.id) + '">수정</a>' +
        '<a class="a-btn ghost sm" href="../a/?id=' + encodeURIComponent(a.id) + '&src=admin" target="_blank" rel="noopener">보기</a>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  function changeStatus(id, next, selectEl) {
    var a = findArtwork(id);
    if (!a || a.status === next) return;
    var prev = a.status;
    var note = '';
    selectEl.disabled = true;
    saveChange('#' + id + ' 상태 변경: ' + statusLabel(prev) + ' → ' + statusLabel(next), function (cat) {
      var w = cat.artworks.find(function (x) { return x.id === id; });
      w.status = next;
      if (next === 'sold') {
        if (!w.soldAt) w.soldAt = thisMonth();
        if (!w.provenance || !w.provenance.length) {
          w.provenance = [{ label: '첫 소장자 · 비공개', from: w.soldAt, to: '' }];
          note = ' · 소장 시점과 소유 이력을 자동으로 채웠어요';
        }
      }
    }).then(function () {
      toast(statusLabel(next) + '(으)로 바꿨어요' + note + savedSuffix(), 3200);
      renderList();
    }).catch(function (err) {
      handleError(err);
      renderList();
    });
  }

  /* =========================================================
   * 작품 편집
   * ======================================================= */
  function nextId() {
    var max = state.catalog.artworks.reduce(function (m, a) {
      var n = parseInt(a.id, 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return String(max + 1).padStart(4, '0');
  }

  function blankArtwork() {
    return {
      id: nextId(), published: false, sample: false,
      title: '', titleEn: '', artistId: (state.catalog.artists[0] || {}).id || '',
      year: new Date().getFullYear(), medium: '', size: { w: '', h: '', d: '' }, edition: 'Original 1/1',
      images: [],
      quote: '', story: '', origin: '', process: '', video: '',
      status: 'available', price: '', framed: false, delivery: '', viewingPlace: '',
      soldAt: '', showSoldPrice: false, care: '',
      verification: { artistApproved: false, approvedAt: '' },
      exhibitions: [], provenance: []
    };
  }

  function openArtwork(id) {
    var data;
    if (id) {
      var a = findArtwork(id);
      if (!a) { toast('#' + id + ' 작품을 찾을 수 없어요'); go('#/list'); return; }
      data = Object.assign(blankArtwork(), clone(a));
      data.size = Object.assign({ w: '', h: '', d: '' }, data.size);
      data.verification = Object.assign({ artistApproved: false, approvedAt: '' }, data.verification);
      ['images', 'exhibitions', 'provenance'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    } else {
      data = blankArtwork();
    }
    state.draft = { kind: 'artwork', isNew: !id, originalId: id, data: data };
    state.draft.initial = JSON.stringify(data);
    renderArtworkForm();
  }

  function renderArtworkForm() {
    var d = state.draft;
    var a = d.data;
    var artists = state.catalog.artists;
    var artistOptions = artists.length
      ? artists.map(function (ar) { return [ar.id, ar.name + (ar.affiliation ? ' · ' + ar.affiliation : '')]; })
      : [['', '먼저 작가를 추가하세요']];

    var html =
      '<div class="a-head"><div><h1>' + (d.isNew ? '새 작품' : '#' + esc(a.id) + ' ' + esc(a.title)) + '</h1>' +
      '<p>' + (d.isNew ? '필수 항목(*)을 채우고 저장하세요. 작가 확인 전에는 “공개”를 끄고 저장하면 됩니다.' : '수정한 뒤 아래 저장 버튼을 누르세요. (Ctrl+S)') + '</p></div>' +
      (d.isNew ? '' : '<a class="a-btn ghost" href="../a/?id=' + encodeURIComponent(a.id) + '&src=admin" target="_blank" rel="noopener">공개 페이지 ↗</a>') +
      '</div>' +
      '<div class="form-grid"><nav class="form-nav" aria-label="입력 항목">' +
      '<a href="#s-basic" data-jump>기본 정보</a><a href="#s-images" data-jump>사진</a><a href="#s-story" data-jump>작품 이야기</a>' +
      '<a href="#s-sale" data-jump>판매</a><a href="#s-record" data-jump>작품 기록</a><a href="#s-nfc" data-jump>NFC · QR</a>' +
      (d.isNew ? '' : '<a href="#s-danger" data-jump>삭제</a>') +
      '</nav><div id="form">' +

      // 기본 정보
      '<section class="fs" id="s-basic"><h2>기본 정보</h2><p class="desc">작품번호는 NFC 태그·QR 주소에 들어가므로 저장 후에는 바꿀 수 없습니다.</p><div class="fields">' +
      field('third keep', '작품번호', input('id', { disabled: !d.isNew, inputmode: 'numeric' }), d.isNew ? '자동으로 다음 번호' : '', true) +
      field('third', '작가', select('artistId', artistOptions) , '<a href="#/artist/new">+ 새 작가 추가</a>', true) +
      field('third', '제작연도', input('year', { type: 'number', num: true, inputmode: 'numeric' })) +
      field('half', '작품명', input('title', { placeholder: '오후의 여백' }), '', true) +
      field('half', '영문 제목', input('titleEn', { placeholder: 'Afternoon Margin' })) +
      field('half', '재료', input('medium', { placeholder: 'Oil on canvas', list: 'mediums' })) +
      field('half', '원작 구분', input('edition', { list: 'editions' }), '유일 원작만 “Original 1/1”. 판화·사진은 “Edition 3/10”처럼') +
      field('third keep', '가로 (cm)', input('size.w', { type: 'number', num: true, step: '0.1', inputmode: 'decimal' })) +
      field('third keep', '세로 (cm)', input('size.h', { type: 'number', num: true, step: '0.1', inputmode: 'decimal' })) +
      field('third keep', '깊이 (cm)', input('size.d', { type: 'number', num: true, step: '0.1', inputmode: 'decimal' })) +
      '<div class="f half">' + checkbox('published', '공개', '끄면 NFC·QR로 열어도 “준비 중” 화면만 보입니다') + '</div>' +
      '<div class="f half">' + checkbox('sample', '예시 데이터', '발표·시연용 가상 작품이면 켜세요. 페이지에 “예시” 표시가 붙습니다') + '</div>' +
      '</div>' +
      '<datalist id="mediums"><option value="Oil on canvas"><option value="Acrylic on canvas"><option value="Mixed media on canvas"><option value="Watercolor on paper"><option value="Ink on paper"><option value="Charcoal on paper"><option value="Ceramic"></datalist>' +
      '<datalist id="editions"><option value="Original 1/1"><option value="Edition 1/10"></datalist>' +
      '</section>' +

      // 사진
      '<section class="fs" id="s-images"><h2>사진</h2><p class="desc">첫 번째 사진이 대표 이미지가 됩니다. 올리면 자동으로 긴 변 1600px로 줄여 저장합니다. 전체 → 디테일(질감) → 공간에 걸린 모습 순서를 추천해요.</p>' +
      '<div class="img-grid" id="imgs"></div></section>' +

      // 이야기
      '<section class="fs" id="s-story"><h2>작품 이야기</h2><p class="desc">작가 인터뷰를 바탕으로 쓰고, 작가가 확인한 문장만 공개합니다. 빈 줄을 넣으면 문단이 나뉩니다.</p><div class="fields">' +
      field('', '작가의 한 문장', input('quote', { placeholder: '작업실에 머문 오후의 빛을 기록했습니다.' }), '페이지 상단과 “작품 이야기”에 인용으로 크게 보입니다') +
      field('', '작품 배경 · 제작 의도', input('story', { type: 'textarea', rows: 6 })) +
      field('', '제작 과정', input('process', { type: 'textarea', rows: 4 }), '재료, 기간, 기법 등') +
      field('', 'ONE에 오기까지', input('origin', { type: 'textarea', rows: 3 }), '예: 졸업전 이후 작업실에 보관되어 있던 작품입니다. (보관·폐기 사정은 사실대로)') +
      field('', '작가 인터뷰 영상 링크', input('video', { type: 'url', placeholder: 'https://www.instagram.com/reel/…' })) +
      '</div></section>' +

      // 판매
      '<section class="fs" id="s-sale"><h2>판매</h2><p class="desc">인스타·현장·페이지 가격은 모두 같게 표시합니다.</p><div class="fields">' +
      field('third', '판매 상태', select('status', STATUS_ORDER.map(function (s) { return [s, statusLabel(s)]; }))) +
      field('third', '판매가 (원)', input('price', { type: 'number', num: true, inputmode: 'numeric', placeholder: '200000' })) +
      '<div class="f third" style="justify-content:flex-end">' + checkbox('framed', '액자 포함') + '</div>' +
      field('half', '전달 방법 · 비용', input('delivery', { placeholder: '서울 내 직접 전달 무료 · 그 외 택배비 별도' })) +
      field('half', '실물 관람 장소', input('viewingPlace', { placeholder: '서울대학교 313동 1층 로비' })) +
      '<div class="f half" data-show="sold">' + '<span>최초 소장 시점</span>' + input('soldAt', { type: 'month' }) + '</div>' +
      '<div class="f half" data-show="sold" style="justify-content:flex-end">' + checkbox('showSoldPrice', '판매 후에도 최초 판매가 공개', '소장자가 동의한 경우에만 켜세요') + '</div>' +
      '</div></section>' +

      // 기록
      '<section class="fs" id="s-record"><h2>작품 기록</h2><p class="desc">NFC로 확인하는 작가 승인과 이력입니다. 구매자 실명·연락처는 절대 적지 마세요 (이 데이터는 공개됩니다).</p><div class="fields">' +
      '<div class="f half">' + checkbox('verification.artistApproved', '작가 승인 완료', '작가가 사진·정보·원작 여부·소개 글을 확인했을 때') + '</div>' +
      field('half', '승인 날짜', input('verification.approvedAt', { type: 'date' }), '승인 증빙(메시지 캡처)은 판매 원장에 따로 보관') +
      '<div class="f"><span>전시 이력</span><div class="rep" id="rep-exhibitions"></div></div>' +
      '<div class="f"><span>소유 이력</span><div class="rep" id="rep-provenance"></div><small>예: 첫 소장자 · 비공개 / 기업 소장 · (회사 동의 시 회사명)</small></div>' +
      field('', '작품 관리 안내', input('care', { type: 'textarea', rows: 3 }), '소장자를 위한 보관 방법') +
      '</div></section>' +

      // NFC
      '<section class="fs" id="s-nfc"><h2>NFC · QR</h2><p class="desc">NFC 태그에는 아래 NFC 주소를, 전시 캡션에는 QR을 씁니다. 두 주소는 같은 페이지를 열고 유입 경로만 구분합니다.</p>' +
      '<div id="nfcBox"></div></section>' +

      (d.isNew ? '' :
        '<section class="fs" id="s-danger"><h2>삭제</h2><p class="desc">삭제하면 이 번호의 NFC 태그를 대도 “작품을 찾을 수 없어요” 화면이 나옵니다. 판매가 끝난 작품은 삭제하지 말고 상태를 “소장됨”으로 두세요. 잠시 숨기려면 “공개”를 끄면 됩니다.</p>' +
        '<button class="a-btn danger" type="button" id="deleteBtn">이 작품 삭제</button></section>') +

      '</div></div>' + saveBar('<button class="a-btn ghost" type="button" id="previewBtn">미리보기</button>');

    mount(shell('list', html));
    renderImages();
    renderRepeater('exhibitions', [['place', '장소', ''], ['from', '시작', 'date'], ['to', '종료', 'date']]);
    renderRepeater('provenance', [['label', '소장자 표기', ''], ['from', '시작', 'month'], ['to', '종료', 'month']]);
    renderNfc();
    applyShow();
    refreshDirty();
    bindArtworkForm();
  }

  function applyShow() {
    var status = state.draft.data.status;
    app.querySelectorAll('[data-show]').forEach(function (el) {
      el.hidden = el.getAttribute('data-show') !== status;
    });
  }

  function bindArtworkForm() {
    app.oninput = app.onchange = function (e) {
      var el = e.target;
      if (el.hasAttribute('data-k')) {
        setPath(state.draft.data, el.getAttribute('data-k'), readControl(el));
        el.classList.remove('invalid');
        var k = el.getAttribute('data-k');
        if (k === 'status') {
          applyShow();
          if (state.draft.data.status === 'sold' && !state.draft.data.soldAt) {
            state.draft.data.soldAt = thisMonth();
            var m = app.querySelector('[data-k="soldAt"]');
            if (m) m.value = state.draft.data.soldAt;
          }
        }
        if (k === 'verification.artistApproved' && el.checked && !state.draft.data.verification.approvedAt) {
          state.draft.data.verification.approvedAt = today();
          var dt = app.querySelector('[data-k="verification.approvedAt"]');
          if (dt) dt.value = state.draft.data.verification.approvedAt;
        }
        if (k === 'id' && e.type === 'change') renderNfc();
      } else if (el.hasAttribute('data-rep')) {
        var list = state.draft.data[el.getAttribute('data-rep')];
        list[Number(el.getAttribute('data-i'))][el.getAttribute('data-f')] = el.value;
      } else if (el.hasAttribute('data-caption')) {
        state.draft.data.images[Number(el.getAttribute('data-caption'))].caption = el.value;
      } else if (el.id === 'fileInput' && e.type === 'change') {
        addFiles(el.files);
        el.value = '';
      }
      refreshDirty();
    };

    app.onclick = function (e) {
      var t = e.target;
      var jump = t.closest('[data-jump]');
      if (jump) {
        e.preventDefault();
        var target = document.querySelector(jump.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var imgBtn = t.closest('[data-img-act]');
      if (imgBtn) return imageAction(imgBtn.getAttribute('data-img-act'), Number(imgBtn.getAttribute('data-i')));
      var add = t.closest('[data-rep-add]');
      if (add) {
        var key = add.getAttribute('data-rep-add');
        state.draft.data[key].push(key === 'exhibitions' ? { place: '', from: '', to: '' } : { label: '', from: '', to: '' });
        rerenderRepeater(key);
        var rows = app.querySelectorAll('#rep-' + key + ' .rep-row input');
        if (rows.length) rows[rows.length - 3].focus();
        refreshDirty();
        return;
      }
      var del = t.closest('[data-rep-del]');
      if (del) {
        state.draft.data[del.getAttribute('data-rep-del')].splice(Number(del.getAttribute('data-i')), 1);
        rerenderRepeater(del.getAttribute('data-rep-del'));
        refreshDirty();
        return;
      }
      var copyBtn = t.closest('[data-copy]');
      if (copyBtn) {
        var text = copyBtn.getAttribute('data-copy');
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(function () { toast('주소를 복사했어요'); }, function () { prompt('아래 주소를 복사하세요', text); });
        return;
      }
      if (t.closest('#qrDownload')) return downloadQr();
      if (t.closest('#labelBtn')) return printLabels();
      if (t.closest('#saveBtn')) return saveDraft();
      if (t.closest('#previewBtn')) return previewArtwork();
      if (t.closest('#deleteBtn')) return deleteArtwork();
    };
  }

  function bindDrop(drop, handler) {
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) { handler(e.dataTransfer.files); });
  }

  /* ----- 사진 ----- */
  function renderImages() {
    var imgs = state.draft.data.images;
    var box = document.getElementById('imgs');
    box.innerHTML = imgs.map(function (im, i) {
      return '<div class="img-card' + (i === 0 ? ' main' : '') + '">' +
        '<img src="' + esc(imgUrl(im.src)) + '" alt="">' +
        '<div class="img-body">' +
        (i === 0 ? '<span class="img-badge">대표 이미지</span>' : '') +
        (pending[im.src] ? '<span class="pending">저장 전 · ' + Math.round(pending[im.src].size / 1024) + 'KB</span>' : '') +
        '<input type="text" data-caption="' + i + '" placeholder="설명 (예: 질감 디테일)" value="' + esc(im.caption || '') + '">' +
        '<div class="img-tools">' +
        (i > 0 ? '<button type="button" data-img-act="main" data-i="' + i + '" title="대표 이미지로">대표</button>' : '') +
        (i > 0 ? '<button type="button" data-img-act="left" data-i="' + i + '" aria-label="앞으로">←</button>' : '') +
        (i < imgs.length - 1 ? '<button type="button" data-img-act="right" data-i="' + i + '" aria-label="뒤로">→</button>' : '') +
        '<button type="button" data-img-act="remove" data-i="' + i + '">삭제</button>' +
        '</div></div></div>';
    }).join('') +
      '<label class="drop" id="drop"><input type="file" id="fileInput" accept="image/*" multiple>' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>' +
      '<span><b>사진 추가</b><br>눌러서 선택하거나 끌어다 놓기</span></label>';
    bindDrop(document.getElementById('drop'), addFiles);
  }

  function addFiles(fileList) {
    var files = Array.prototype.filter.call(fileList || [], function (f) { return /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name); });
    if (!files.length) return;
    toast('사진 ' + files.length + '장을 처리하는 중…');
    files.reduce(function (p, f) {
      return p.then(function () {
        return processImage(f, 1600).then(function (key) {
          state.draft.data.images.push({ src: key, caption: '' });
        }).catch(function (err) { alert(err.message + '\nJPG·PNG 형식으로 다시 올려주세요.'); });
      });
    }, Promise.resolve()).then(function () {
      renderImages();
      refreshDirty();
      toast('사진을 추가했어요 · 저장해야 반영됩니다');
    });
  }

  function imageAction(act, i) {
    var imgs = state.draft.data.images;
    if (act === 'remove') {
      if (!confirm('이 사진을 뺄까요? (저장해야 반영됩니다)')) return;
      imgs.splice(i, 1);
    } else if (act === 'main') {
      imgs.unshift(imgs.splice(i, 1)[0]);
    } else if (act === 'left' && i > 0) {
      imgs.splice(i - 1, 0, imgs.splice(i, 1)[0]);
    } else if (act === 'right' && i < imgs.length - 1) {
      imgs.splice(i + 1, 0, imgs.splice(i, 1)[0]);
    }
    renderImages();
    refreshDirty();
  }

  /* ----- 반복 입력 (전시 이력, 소유 이력) ----- */
  var repConfig = {};
  function renderRepeater(key, cols) {
    repConfig[key] = cols;
    rerenderRepeater(key);
  }
  function rerenderRepeater(key) {
    var cols = repConfig[key];
    var list = state.draft.data[key];
    var box = document.getElementById('rep-' + key);
    box.innerHTML = list.map(function (row, i) {
      return '<div class="rep-row">' + cols.map(function (c) {
        return '<input type="' + (c[2] || 'text') + '" data-rep="' + key + '" data-i="' + i + '" data-f="' + c[0] + '" placeholder="' + c[1] + '" aria-label="' + c[1] + '" value="' + esc(row[c[0]] || '') + '">';
      }).join('') + '<button class="x-btn" type="button" data-rep-del="' + key + '" data-i="' + i + '" aria-label="이 줄 삭제">×</button></div>';
    }).join('') +
      '<button class="a-btn ghost sm add-row" type="button" data-rep-add="' + key + '">+ 한 줄 추가</button>';
  }

  /* ----- NFC · QR ----- */
  function siteBase() {
    var s = (state.catalog.site.siteUrl || '').trim();
    if (s) return s.replace(/\/?$/, '/');
    return new URL('../', location.href).href;
  }
  function pageUrl(id, src) {
    return siteBase() + 'a/?id=' + encodeURIComponent(id) + '&src=' + src;
  }

  function renderNfc() {
    var box = document.getElementById('nfcBox');
    if (!box) return;
    var id = String(state.draft.data.id || '').trim();
    var nfc = pageUrl(id, 'nfc');
    var qr = pageUrl(id, 'qr');
    var isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(siteBase());
    box.innerHTML =
      '<div class="fields">' +
      '<div class="f"><span>NFC 태그에 쓸 주소</span><div class="url-box"><code>' + esc(nfc) + '</code><button class="a-btn ghost sm" type="button" data-copy="' + esc(nfc) + '">복사</button></div>' +
      '<small>NFC Tools 앱 → 쓰기 → 레코드 추가 → URL/URI → 위 주소 붙여넣기 → 쓰기. ' + nfc.length + '자 (NTAG213 여유 있음)</small></div>' +
      '<div class="f"><span>전시 캡션 QR 주소</span><div class="url-box"><code>' + esc(qr) + '</code><button class="a-btn ghost sm" type="button" data-copy="' + esc(qr) + '">복사</button></div></div>' +
      '</div>' +
      '<div class="qr-wrap"><div class="qr" id="qr"></div><div style="display:flex;flex-direction:column;gap:8px">' +
      '<button class="a-btn ghost sm" type="button" id="qrDownload">QR 이미지 저장</button>' +
      '<button class="a-btn ghost sm" type="button" id="labelBtn">캡션·NFC 라벨 인쇄</button></div></div>' +
      (isLocalhost ? '<p class="hint">지금은 내 컴퓨터 주소(localhost)라서 휴대폰에서 열리지 않습니다. GitHub Pages 배포 후 이 화면에서 다시 복사하거나, 설정 → 사이트 주소를 먼저 입력하세요. 태그는 실제 주소로만 쓰세요.</p>' : '') +
      (state.draft.isNew ? '<p class="hint">새 작품은 저장한 뒤에 태그를 쓰세요.</p>' : '');
    drawQr(document.getElementById('qr'), qr);
  }

  function drawQr(el, text) {
    if (!el) return;
    el.innerHTML = '';
    if (!window.QRCode) {
      el.innerHTML = '<small style="color:var(--muted)">QR 도구를 불러오지 못했어요 (인터넷 연결 확인)</small>';
      return;
    }
    new window.QRCode(el, { text: text, width: 512, height: 512, correctLevel: window.QRCode.CorrectLevel.M });
  }

  function qrDataUrl() {
    var c = document.querySelector('#qr canvas');
    return c ? c.toDataURL('image/png') : '';
  }

  function downloadQr() {
    var url = qrDataUrl();
    if (!url) return toast('QR을 만들지 못했어요');
    var a = document.createElement('a');
    a.href = url;
    a.download = 'ONE-' + state.draft.data.id + '-QR.png';
    a.click();
  }

  function printLabels() {
    var a = state.draft.data;
    var ar = findArtist(a.artistId) || {};
    var qr = qrDataUrl();
    var spec = [a.year, a.medium, O.sizeText(a.size)].filter(Boolean).join(' · ');
    var w = window.open('', '_blank');
    if (!w) return toast('팝업이 차단됐어요. 팝업을 허용해 주세요');
    w.document.write('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ONE #' + esc(a.id) + ' 라벨</title>' +
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500&display=swap">' +
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">' +
      '<style>@page{size:A4;margin:15mm}body{font-family:"Pretendard Variable",sans-serif;color:#191a19;margin:0;padding:20px}' +
      '.row{display:flex;gap:14mm;align-items:flex-start;flex-wrap:wrap}.cap{width:100mm;height:62mm;border:1px solid #ccc;padding:6mm;box-sizing:border-box;display:grid;grid-template-columns:1fr 26mm;gap:5mm;background:#fffefb}' +
      '.logo{font-family:"Bodoni Moda",Georgia,serif;font-size:16pt;line-height:1}.no{font-family:Georgia,serif;font-size:9pt;color:#646760;margin-top:1mm}' +
      'h1{font-size:14pt;margin:4mm 0 1mm;letter-spacing:-.02em}.m{font-size:8.5pt;color:#3a3c38;line-height:1.55}.p{font-family:Georgia,serif;font-size:13pt;font-weight:700;margin-top:3mm}' +
      '.qr img{width:26mm;height:26mm}.qr p{font-size:6.5pt;color:#646760;margin:1.5mm 0 0;line-height:1.35;text-align:center}' +
      '.nfc{width:20mm;height:40mm;border:1px solid #ccc;border-radius:2mm;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5mm;background:#f7f5ef}' +
      '.nfc .logo{font-size:11pt}.nfc svg{width:8mm;height:8mm}.nfc b{font-family:Georgia,serif;font-weight:400;font-size:8pt}.nfc span{font-size:6pt;letter-spacing:.1em;color:#646760}' +
      '.tip{font-size:10pt;color:#646760;margin:0 0 16px}button{font:inherit;padding:8px 16px;margin-bottom:16px}@media print{.tip,button{display:none}}</style></head><body>' +
      '<button onclick="print()">인쇄</button><p class="tip">실제 크기로 인쇄하세요. 캡션은 작품 옆 벽면에, NFC 라벨은 작품 뒤 나무틀에 NFC 스티커와 함께 붙입니다.</p>' +
      '<div class="row"><div class="cap"><div><div class="logo">ONE</div><div class="no">#' + esc(a.id) + '</div>' +
      '<h1>' + esc(a.title) + '</h1><div class="m">' + esc(ar.name || '') + (ar.affiliation ? '<br>' + esc(ar.affiliation) : '') + '<br>' + esc(spec) + '<br>' + esc(a.edition || '') + '</div>' +
      (a.status === 'available' && a.price ? '<div class="p">' + esc(O.won(a.price)) + '</div>' : '') +
      '</div><div class="qr">' + (qr ? '<img src="' + qr + '" alt="">' : '') + '<p>휴대폰 카메라로 비추면<br>작품 이야기와<br>구매 안내를 볼 수 있어요</p></div></div>' +
      '<div class="nfc"><div class="logo">ONE</div><svg viewBox="0 0 24 24" fill="none" stroke="#191a19" stroke-width="1.7" stroke-linecap="round"><path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17"/></svg><b>#' + esc(a.id) + '</b><span>NFC</span></div></div>' +
      '</body></html>');
    w.document.close();
  }

  /* ----- 미리보기 · 저장 · 삭제 ----- */
  function previewArtwork() {
    var d = state.draft;
    var cat = clone(state.catalog);
    var a = clone(d.data);
    // blob URL은 같은 사이트의 다른 탭에서도 열 수 있다.
    a.images = a.images.map(function (im) { return { src: imgUrl(im.src), caption: im.caption }; });
    cat.artists = cat.artists.map(function (ar) { return Object.assign({}, ar, { photo: imgUrl(ar.photo) }); });
    var i = cat.artworks.findIndex(function (x) { return x.id === (d.originalId || a.id); });
    if (i >= 0) cat.artworks[i] = a; else cat.artworks.push(a);
    try {
      localStorage.setItem('one-preview', JSON.stringify(cat));
    } catch (e) {
      return toast('미리보기를 만들지 못했어요');
    }
    window.open('../a/?id=' + encodeURIComponent(a.id) + '&preview=1&src=' + (a.status === 'sold' ? 'nfc' : 'qr'), '_blank');
  }

  function markInvalid(path, msg) {
    var el = app.querySelector('[data-k="' + path + '"]');
    if (el) {
      el.classList.add('invalid');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(function () { el.focus({ preventScroll: true }); }, 300);
    }
    toast(msg);
  }

  function saveArtwork() {
    var d = state.draft;
    var a = clone(d.data);
    a.id = String(a.id).trim();
    a.title = String(a.title || '').trim();

    if (!/^[0-9A-Za-z-]{1,16}$/.test(a.id)) return markInvalid('id', '작품번호는 숫자·영문·하이픈만 쓸 수 있어요');
    if (d.isNew && findArtwork(a.id)) return markInvalid('id', '이미 있는 작품번호예요');
    if (!a.title) return markInvalid('title', '작품명을 입력하세요');
    if (!a.artistId || !findArtist(a.artistId)) return markInvalid('artistId', '작가를 선택하세요 (없으면 작가 탭에서 먼저 추가)');

    a.exhibitions = a.exhibitions.filter(function (x) { return String(x.place || '').trim(); });
    a.provenance = a.provenance.filter(function (x) { return String(x.label || '').trim(); });

    var files = [];
    var used = [];
    a.images = a.images.map(function (im) {
      var p = pending[im.src];
      if (!p) return im;
      var path = 'images/artworks/' + a.id + '/' + rand() + '.' + p.ext;
      files.push({ path: path, base64: p.base64 });
      used.push([im.src, path]);
      return { src: path, caption: im.caption || '' };
    });

    var message = (d.isNew ? '작품 추가' : '작품 수정') + ': #' + a.id + ' ' + a.title;
    var original = d.isNew ? null : findArtwork(d.originalId);

    saveChange(message, function (cat) {
      var i = cat.artworks.findIndex(function (x) { return x.id === d.originalId; });
      if (!d.isNew && i >= 0) cat.artworks[i] = a; else cat.artworks.push(a);
      cat.artworks.sort(byId);
      // 빠진 사진 파일 정리 (다른 곳에서 안 쓰는 것만)
      if (original) {
        (original.images || []).forEach(function (im) {
          var stillUsed = a.images.some(function (x) { return x.src === im.src; });
          if (!stillUsed && deletableImage(im.src, cat, null, null)) files.push({ path: im.src, delete: true });
        });
      }
    }, files).then(function () {
      used.forEach(function (u) { blobCache[u[1]] = pending[u[0]].url; delete pending[u[0]]; });
      state.draft = null;
      toast('저장했어요' + savedSuffix(), 3200);
      go('#/list');
    }).catch(handleError);
  }

  function deleteArtwork() {
    var d = state.draft;
    var a = findArtwork(d.originalId);
    if (!a) return;
    var answer = prompt('정말 삭제하려면 작품번호 ' + a.id + ' 를 입력하세요.\n(판매된 작품은 삭제 대신 “소장됨” 상태로 두세요)');
    if (answer === null) return;
    if (answer.trim() !== a.id) return toast('작품번호가 달라서 삭제하지 않았어요');
    var files = [];
    saveChange('작품 삭제: #' + a.id + ' ' + a.title, function (cat) {
      cat.artworks = cat.artworks.filter(function (x) { return x.id !== a.id; });
      (a.images || []).forEach(function (im) {
        if (deletableImage(im.src, cat, null, null)) files.push({ path: im.src, delete: true });
      });
    }, files).then(function () {
      state.draft = null;
      toast('삭제했어요');
      go('#/list');
    }).catch(handleError);
  }

  /* =========================================================
   * 작가
   * ======================================================= */
  function renderArtists() {
    var artists = state.catalog.artists;
    var html = '<div class="a-head"><div><h1>작가</h1><p>작가 정보는 그 작가의 모든 작품 페이지에 함께 보입니다.</p></div>' +
      '<a class="a-btn" href="#/artist/new">+ 작가 추가</a></div>';
    if (!artists.length) {
      html += '<div class="a-list"><div class="empty">등록된 작가가 없어요. 작품을 올리기 전에 작가를 먼저 추가하세요.</div></div>';
    } else {
      html += '<div class="artist-grid">' + artists.map(function (ar) {
        var n = state.catalog.artworks.filter(function (a) { return a.artistId === ar.id; }).length;
        var avatar = ar.photo ? '<img class="avatar" src="' + esc(imgUrl(ar.photo)) + '" alt="">' : '<div class="avatar">' + esc((ar.name || '?').charAt(0)) + '</div>';
        return '<a class="artist-card" href="#/artist/' + encodeURIComponent(ar.id) + '">' + avatar +
          '<div><div style="font-weight:700">' + esc(ar.name) + '</div><div style="font-size:13px;color:var(--muted)">' + esc(ar.affiliation || '') + '</div>' +
          '<div style="font-size:12.5px;color:var(--faint)">작품 ' + n + '점</div></div></a>';
      }).join('') + '</div>';
    }
    mount(shell('artists', html));
  }

  function slugify(s) {
    return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  function openArtist(id) {
    var data;
    if (id) {
      var ar = findArtist(id);
      if (!ar) { toast('작가를 찾을 수 없어요'); go('#/artists'); return; }
      data = Object.assign({ name: '', nameEn: '', affiliation: '', photo: '', bio: '', instagram: '', history: [] }, clone(ar));
    } else {
      data = { id: '', name: '', nameEn: '', affiliation: '서울대학교 미술대학 ', photo: '', bio: '', instagram: '', history: [] };
    }
    state.draft = { kind: 'artist', isNew: !id, originalId: id, data: data };
    state.draft.initial = JSON.stringify(data);

    var d = state.draft;
    var works = id ? state.catalog.artworks.filter(function (a) { return a.artistId === id; }) : [];
    var html = '<div class="a-head"><div><h1>' + (d.isNew ? '새 작가' : esc(data.name)) + '</h1>' +
      '<p>작가 소개는 작가가 직접 확인한 내용으로 올려주세요. 얼굴 사진 대신 작업실·손 사진도 좋아요.</p></div></div>' +
      '<section class="fs"><h2>작가 정보</h2><div class="fields">' +
      field('half', '이름', input('name', { placeholder: '김하늘' }), '', true) +
      field('half', '영문 이름', input('nameEn', { placeholder: 'Kim Haneul' })) +
      field('', '소속 · 전공', input('affiliation', { placeholder: '서울대학교 미술대학 서양화과' })) +
      '<div class="f"><span>사진</span><div id="photoBox" style="display:flex;gap:14px;align-items:center"></div></div>' +
      field('', '작가 소개', input('bio', { type: 'textarea', rows: 5 }), '3~5줄 · 관심 주제, 작업 방식') +
      field('', '전시 · 활동 이력', '<textarea data-k="history" data-type="lines" rows="4" placeholder="한 줄에 하나씩&#10;2025 서울대학교 미술대학 학기말전">' + esc((data.history || []).join('\n')) + '</textarea>', '한 줄에 하나씩') +
      field('', '인스타그램 주소', input('instagram', { type: 'url', placeholder: 'https://www.instagram.com/…' }), '작가가 공개에 동의한 경우에만') +
      '</div></section>' +
      (d.isNew ? '' : '<section class="fs"><h2>이 작가의 작품</h2>' +
        (works.length ? '<p class="desc">' + works.map(function (a) { return '<a href="#/edit/' + encodeURIComponent(a.id) + '">#' + esc(a.id) + ' ' + esc(a.title) + '</a>'; }).join(' · ') + '</p>' : '<p class="desc">아직 작품이 없어요.</p>') +
        '<button class="a-btn danger" type="button" id="deleteArtistBtn"' + (works.length ? ' disabled title="작품이 있는 작가는 삭제할 수 없어요"' : '') + '>작가 삭제</button></section>') +
      saveBar();

    mount(shell('artists', html));
    renderPhoto();
    refreshDirty();

    app.oninput = app.onchange = function (e) {
      var el = e.target;
      if (el.hasAttribute('data-k')) {
        setPath(state.draft.data, el.getAttribute('data-k'), readControl(el));
        el.classList.remove('invalid');
      } else if (el.id === 'photoInput' && e.type === 'change' && el.files[0]) {
        processImage(el.files[0], 800).then(function (key) {
          state.draft.data.photo = key;
          renderPhoto();
          refreshDirty();
        }).catch(function (err) { alert(err.message); });
      }
      refreshDirty();
    };
    app.onclick = function (e) {
      if (e.target.closest('#saveBtn')) return saveDraft();
      if (e.target.closest('#photoRemove')) { state.draft.data.photo = ''; renderPhoto(); refreshDirty(); return; }
      if (e.target.closest('#deleteArtistBtn')) return deleteArtist();
    };
  }

  function renderPhoto() {
    var p = state.draft.data.photo;
    document.getElementById('photoBox').innerHTML =
      (p ? '<img class="avatar" src="' + esc(imgUrl(p)) + '" alt="">' : '<div class="avatar">' + esc((state.draft.data.name || '?').charAt(0)) + '</div>') +
      '<label class="a-btn ghost sm" style="cursor:pointer">사진 선택<input type="file" id="photoInput" accept="image/*" hidden></label>' +
      (p ? '<button class="a-btn ghost sm" type="button" id="photoRemove">사진 빼기</button>' : '') +
      (pending[p] ? '<span class="pending">저장 전</span>' : '');
  }

  function saveArtist() {
    var d = state.draft;
    var ar = clone(d.data);
    ar.name = String(ar.name || '').trim();
    if (!ar.name) return markInvalid('name', '이름을 입력하세요');
    if (d.isNew) {
      var base = slugify(ar.nameEn) || 'artist-' + rand().slice(-5);
      var idc = base, n = 2;
      while (findArtist(idc)) idc = base + '-' + n++;
      ar.id = idc;
    }
    var files = [];
    var used = null;
    if (pending[ar.photo]) {
      var p = pending[ar.photo];
      var path = 'images/artists/' + ar.id + '-' + rand() + '.' + p.ext;
      files.push({ path: path, base64: p.base64 });
      used = [ar.photo, path];
      ar.photo = path;
    }
    var original = d.isNew ? null : findArtist(d.originalId);
    saveChange((d.isNew ? '작가 추가: ' : '작가 수정: ') + ar.name, function (cat) {
      var i = cat.artists.findIndex(function (x) { return x.id === d.originalId; });
      if (!d.isNew && i >= 0) cat.artists[i] = ar; else cat.artists.push(ar);
      if (original && original.photo && original.photo !== ar.photo && deletableImage(original.photo, cat, null, null)) {
        files.push({ path: original.photo, delete: true });
      }
    }, files).then(function () {
      if (used) { blobCache[used[1]] = pending[used[0]].url; delete pending[used[0]]; }
      state.draft = null;
      toast('저장했어요' + savedSuffix(), 3200);
      go('#/artists');
    }).catch(handleError);
  }

  function deleteArtist() {
    var d = state.draft;
    var ar = findArtist(d.originalId);
    if (!ar || !confirm(ar.name + ' 작가를 삭제할까요?')) return;
    var files = [];
    saveChange('작가 삭제: ' + ar.name, function (cat) {
      cat.artists = cat.artists.filter(function (x) { return x.id !== ar.id; });
      if (ar.photo && deletableImage(ar.photo, cat, null, null)) files.push({ path: ar.photo, delete: true });
    }, files).then(function () {
      state.draft = null;
      toast('삭제했어요');
      go('#/artists');
    }).catch(handleError);
  }

  /* =========================================================
   * 사이트 설정
   * ======================================================= */
  function openSettings() {
    var data = Object.assign({ name: 'ONE', tagline: '', siteUrl: '', inquiryLabel: '', inquiryUrl: '', instagramUrl: '', notice: '' }, clone(state.catalog.site));
    state.draft = { kind: 'settings', data: data };
    state.draft.initial = JSON.stringify(data);
    var guess = new URL('../', location.href).href;
    var html = '<div class="a-head"><div><h1>설정</h1><p>모든 작품 페이지에 공통으로 쓰이는 정보입니다.</p></div></div>' +
      '<section class="fs"><h2>사이트 주소</h2><p class="desc">NFC 태그·QR에 들어갈 주소의 앞부분입니다. <b>태그를 쓰기 전에 확정</b>하세요. 비워두면 지금 접속한 주소를 씁니다.</p><div class="fields">' +
      field('', '사이트 주소', input('siteUrl', { type: 'url', placeholder: guess }), '예: https://one-art-snu.github.io/one-nfc/ 또는 구입한 도메인 https://one-art.kr/') +
      '</div></section>' +
      '<section class="fs"><h2>구매 문의</h2><p class="desc">판매 가능한 작품 페이지의 “구매 문의” 버튼이 여는 곳입니다. 5번(판매·회계)과 정한 채널 하나로 모으세요.</p><div class="fields">' +
      field('half', '버튼 문구', input('inquiryLabel', { placeholder: '인스타그램 DM으로 문의하기' })) +
      field('half', '문의 링크', input('inquiryUrl', { type: 'url', placeholder: 'https://ig.me/m/계정 · 카카오 오픈채팅 · 구글폼' })) +
      field('', 'ONE 인스타그램', input('instagramUrl', { type: 'url', placeholder: 'https://www.instagram.com/…' })) +
      '</div></section>' +
      '<section class="fs"><h2>문구</h2><div class="fields">' +
      field('', '한 줄 소개', input('tagline')) +
      field('', '하단 고지', input('notice', { type: 'textarea', rows: 3 }), '학교 공식 인증이 아니라는 점, 가격 상승을 보장하지 않는다는 점을 유지하세요') +
      '</div></section>' + saveBar();
    mount(shell('settings', html));
    refreshDirty();
    app.oninput = app.onchange = function (e) {
      if (e.target.hasAttribute('data-k')) setPath(state.draft.data, e.target.getAttribute('data-k'), readControl(e.target));
      refreshDirty();
    };
    app.onclick = function (e) { if (e.target.closest('#saveBtn')) saveDraft(); };
  }

  function saveSettings() {
    var s = clone(state.draft.data);
    s.siteUrl = String(s.siteUrl || '').trim();
    if (s.siteUrl && !/^https:\/\//.test(s.siteUrl)) return markInvalid('siteUrl', '사이트 주소는 https:// 로 시작해야 해요');
    if (s.siteUrl) s.siteUrl = s.siteUrl.replace(/\/?$/, '/');
    saveChange('사이트 설정 수정', function (cat) { cat.site = s; }).then(function () {
      state.draft = { kind: 'settings', data: clone(s) };
      state.draft.initial = JSON.stringify(state.draft.data);
      refreshDirty();
      toast('저장했어요' + savedSuffix(), 3200);
    }).catch(handleError);
  }

  boot();
})();
