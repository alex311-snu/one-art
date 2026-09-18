/*
 * 관리자 저장소 — 두 가지 모드를 같은 인터페이스로 제공한다.
 *   LocalStore  : 내 컴퓨터에서 dev_server.py로 띄웠을 때. 파일을 바로 디스크에 쓴다.
 *   GitHubStore : GitHub Pages에 배포된 뒤. GitHub API로 한 번에 커밋한다.
 * 인터페이스: load() → catalog, commit(message, files) → void
 *   files: [{ path, text }] | [{ path, base64 }] | [{ path, delete: true }]
 */
(function () {
  'use strict';

  var CATALOG_PATH = 'data/catalog.json';

  function utf8ToBase64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function StoreError(message, code) {
    var e = new Error(message);
    e.code = code;
    return e;
  }

  /* ---------- 로컬 모드 ---------- */
  function LocalStore(root) {
    this.root = root;
    this.mode = 'local';
    this.label = '로컬 테스트 모드';
  }

  LocalStore.detect = function (root) {
    return fetch(root + '__local/ping', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.ok); })
      .catch(function () { return false; });
  };

  LocalStore.prototype.load = function () {
    return fetch(this.root + CATALOG_PATH + '?v=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw StoreError('데이터 파일을 읽지 못했습니다.'); return r.json(); });
  };

  LocalStore.prototype.commit = function (message, files) {
    var payload = {
      message: message,
      files: files.map(function (f) {
        if (f.delete) return { path: f.path, delete: true };
        return { path: f.path, base64: f.base64 || utf8ToBase64(f.text) };
      })
    };
    return fetch(this.root + '__local/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw StoreError('저장 실패: ' + t); });
    });
  };

  /* ---------- GitHub 모드 ---------- */
  function GitHubStore(cfg) {
    this.owner = cfg.owner;
    this.repo = cfg.repo;
    this.branch = cfg.branch || 'main';
    this.token = cfg.token;
    this.mode = 'github';
    this.label = this.owner + '/' + this.repo;
    this.catalogSha = null; // 마지막으로 읽은 catalog.json의 blob sha (동시 수정 감지용)
  }

  GitHubStore.prototype.api = function (path, opts) {
    opts = opts || {};
    var url = 'https://api.github.com/repos/' + encodeURIComponent(this.owner) + '/' + encodeURIComponent(this.repo) + path;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + this.token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      if (r.ok) return r.status === 204 ? null : r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var msg = j.message || ('HTTP ' + r.status);
        if (r.status === 401) throw StoreError('토큰이 올바르지 않거나 만료되었습니다.', 'auth');
        if (r.status === 403 || r.status === 404) throw StoreError('저장소에 접근할 수 없습니다. 저장소 이름과 토큰 권한을 확인하세요. (' + msg + ')', 'access');
        if (r.status === 409 || r.status === 422) throw StoreError(msg, 'conflict');
        throw StoreError(msg);
      });
    });
  };

  GitHubStore.prototype.verify = function () {
    return this.api('').then(function (repo) {
      if (repo.permissions && !repo.permissions.push) {
        throw StoreError('이 토큰에는 저장소 쓰기 권한이 없습니다. Contents: Read and write 권한을 주세요.', 'access');
      }
      return repo;
    });
  };

  // 브랜치 이름 대신 커밋 sha로 읽어야 GitHub API 캐시 때문에 옛 내용을 받는 일이 없다.
  GitHubStore.prototype.head = function () {
    return this.api('/git/ref/heads/' + encodeURIComponent(this.branch)).then(function (ref) { return ref.object.sha; });
  };

  GitHubStore.prototype.readCatalogAt = function (commitSha) {
    return this.api('/contents/' + CATALOG_PATH + '?ref=' + commitSha);
  };

  GitHubStore.prototype.load = function () {
    var self = this;
    return this.head()
      .then(function (sha) { return self.readCatalogAt(sha); })
      .then(function (file) {
        self.catalogSha = file.sha;
        return JSON.parse(base64ToUtf8(file.content));
      });
  };

  GitHubStore.prototype.commit = function (message, files) {
    var self = this;
    var headSha;
    var newCatalogSha = null;

    // 1) 최신 커밋 확인 + 내가 불러온 뒤 다른 사람이 catalog.json을 바꿨는지 확인
    return this.head()
      .then(function (sha) {
        headSha = sha;
        return self.readCatalogAt(sha);
      })
      .then(function (file) {
        if (self.catalogSha && file.sha !== self.catalogSha) {
          throw StoreError('다른 사람이 먼저 수정했습니다. 새로고침한 뒤 다시 저장해 주세요.', 'conflict');
        }
        return self.api('/git/commits/' + headSha);
      })
      // 2) 파일마다 blob 생성 → 기존 트리 위에 새 트리
      .then(function (commit) {
        var baseTree = commit.tree.sha;
        return Promise.all(files.map(function (f) {
          if (f.delete) return { path: f.path, mode: '100644', type: 'blob', sha: null };
          return self.api('/git/blobs', {
            method: 'POST',
            body: { content: f.base64 || utf8ToBase64(f.text), encoding: 'base64' }
          }).then(function (blob) {
            if (f.path === CATALOG_PATH) newCatalogSha = blob.sha;
            return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
          });
        })).then(function (entries) {
          return self.api('/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
        });
      })
      // 3) 커밋 생성 후 브랜치 이동 (force 없이 → 그 사이 다른 커밋이 있으면 실패)
      .then(function (tree) {
        return self.api('/git/commits', { method: 'POST', body: { message: message, tree: tree.sha, parents: [headSha] } });
      })
      .then(function (newCommit) {
        return self.api('/git/refs/heads/' + encodeURIComponent(self.branch), {
          method: 'PATCH', body: { sha: newCommit.sha, force: false }
        });
      })
      // 4) 다음 저장의 충돌 감지를 위해 새 sha 기억
      .then(function () {
        if (newCatalogSha) self.catalogSha = newCatalogSha;
      })
      .catch(function (e) {
        if (e.code === 'conflict' && !/먼저 수정/.test(e.message)) {
          throw StoreError('저장하는 사이 저장소가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.', 'conflict');
        }
        throw e;
      });
  };

  window.ONEStore = {
    CATALOG_PATH: CATALOG_PATH,
    LocalStore: LocalStore,
    GitHubStore: GitHubStore,
    utf8ToBase64: utf8ToBase64
  };
})();
