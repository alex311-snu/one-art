/* 거래 상태 변경은 목록과 편집 화면에서 같은 규칙으로 저장한다. */
(function (root) {
  'use strict';
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function reconcile(original, draft, now) {
    var a = copy(draft);
    a.deliveredAt = a.deliveredAt || '';
    var before = original || { status: 'available', provenance: [], soldAt: '' };
    var at = now || new Date().toISOString();
    if (['available', 'reserved', 'sold', 'nfs'].indexOf(a.status) < 0) throw new Error('판매 상태를 확인해 주세요.');
    var month = a.soldAt || at.slice(0, 7);
    a.operations = copy(before.operations || []);
    a.saleSnapshot = before.saleSnapshot ? copy(before.saleSnapshot) : null;
    function record(type, extra) {
      a.operations.push(Object.assign({ type: type, at: at, from: before.status, to: a.status }, extra || {}));
    }
    if (before.status !== a.status) {
      if (before.status === 'sold') {
        record('sale_cancelled', { deliveredAt: before.deliveredAt || '' });
        if (before.saleSnapshot) {
          a.provenance = copy(before.saleSnapshot.provenance);
          a.soldAt = before.saleSnapshot.soldAt;
          a.showSoldPrice = before.saleSnapshot.showSoldPrice;
        } else {
          // 기존 데이터는 거래 직전 스냅샷이 없다. 확인 후 마지막 소유 기록을 취소한다.
          a.provenance = copy(before.provenance || []).slice(0, -1);
          a.soldAt = a.provenance.length ? a.provenance[0].from || '' : '';
          a.showSoldPrice = false;
        }
        a.saleSnapshot = null;
        a.deliveredAt = '';
      } else if (before.status === 'reserved' && a.status !== 'sold') {
        record('reservation_cancelled');
      }
      if (a.status === 'sold') {
        a.saleSnapshot = { provenance: copy(before.provenance || []), soldAt: before.soldAt || '', showSoldPrice: !!before.showSoldPrice };
        a.soldAt = month;
        a.provenance = copy(a.provenance || []);
        if (JSON.stringify(a.provenance) === JSON.stringify(before.provenance || []) || !a.provenance.length) {
          a.provenance.push({ label: a.provenance.length ? '소장자 · 비공개' : '첫 소장자 · 비공개', from: month, to: '' });
        }
        record('sale_completed');
      } else if (a.status === 'reserved') {
        record('reserved');
      } else if (before.status !== 'sold' && before.status !== 'reserved') {
        record('status_changed');
      }
    }
    if (a.status !== 'sold') a.deliveredAt = '';
    if (a.status === 'sold' && a.deliveredAt !== (before.deliveredAt || '')) {
      if (a.deliveredAt && (!/^\d{4}-\d{2}-\d{2}$/.test(a.deliveredAt) ||
          !Number.isFinite(Date.parse(a.deliveredAt)) || new Date(a.deliveredAt).toISOString().slice(0, 10) !== a.deliveredAt)) {
        throw new Error('전달일을 확인해 주세요.');
      }
      record(a.deliveredAt ? 'delivered' : 'delivery_cancelled', { date: a.deliveredAt || '', previousDate: before.deliveredAt || '' });
    }
    return a;
  }
  root.ONELifecycle = { reconcile: reconcile };
  if (typeof module !== 'undefined') module.exports = root.ONELifecycle;
})(typeof window === 'undefined' ? globalThis : window);
