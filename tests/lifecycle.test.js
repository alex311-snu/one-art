const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { reconcile } = require('../assets/js/lifecycle.js');
const stamp = '2026-09-27T03:00:00.000Z';
const fresh = () => ({ id: 'test', status: 'available', soldAt: '', provenance: [], showSoldPrice: false });
const update = (a, changes) => reconcile(a, { ...a, ...changes }, stamp);

test('reservation cancellation restores availability and keeps events', () => {
  const reserved = update(fresh(), { status: 'reserved' });
  const cancelled = update(reserved, { status: 'available' });
  assert.equal(cancelled.status, 'available');
  assert.deepEqual(cancelled.provenance, []);
  assert.deepEqual(cancelled.operations.map(r => r.type), ['reserved', 'reservation_cancelled']);
});

test('sale, delivery, cancellation and resale keep consistent ownership', () => {
  const initial = fresh();
  const sold = update(update(initial, { status: 'reserved' }), { status: 'sold' });
  assert.equal(sold.provenance.length, 1);
  assert.equal(sold.soldAt, '2026-09');
  const delivered = update(sold, { deliveredAt: '2026-09-27' });
  const cancelled = update(delivered, { status: 'available' });
  assert.deepEqual(cancelled.provenance, []);
  assert.equal(cancelled.soldAt, '');
  assert.equal(cancelled.deliveredAt, '');
  assert.equal(cancelled.operations.at(-1).deliveredAt, '2026-09-27');
  const resold = update(cancelled, { status: 'sold', soldAt: '2026-10' });
  assert.equal(resold.provenance.length, 1);
  assert.equal(resold.provenance[0].from, '2026-10');
  assert.equal(resold.deliveredAt, '');
  assert.deepEqual(initial, fresh());
});

test('cancellation preserves pre-existing ownership and price visibility', () => {
  const initial = { ...fresh(), soldAt: '2025-01', showSoldPrice: true,
    provenance: [{ label: 'Earlier owner', from: '2025-01', to: '2026-08' }] };
  const sold = update(initial, { status: 'sold', soldAt: '2026-09' });
  assert.equal(sold.provenance.length, 2);
  const cancelled = update(sold, { status: 'available' });
  assert.deepEqual(cancelled.provenance, initial.provenance);
  assert.equal(cancelled.soldAt, initial.soldAt);
  assert.equal(cancelled.showSoldPrice, true);
});

test('legacy cancellation removes only the last confirmed ownership entry', () => {
  const legacy = { ...fresh(), status: 'sold', soldAt: '2025-01',
    provenance: [{ label: 'Earlier', from: '2025-01' }, { label: 'Cancelled', from: '2026-09' }] };
  const cancelled = update(legacy, { status: 'available' });
  assert.deepEqual(cancelled.provenance, [legacy.provenance[0]]);
  assert.equal(cancelled.operations[0].type, 'sale_cancelled');
});

test('delivery corrections and undo are recorded, repeated saves are not', () => {
  let a = update(fresh(), { status: 'sold', deliveredAt: '2026-09-25' });
  assert.deepEqual(a.operations.map(r => r.type), ['sale_completed', 'delivered']);
  a = update(a, { deliveredAt: '2026-09-26' });
  assert.equal(a.operations.at(-1).previousDate, '2026-09-25');
  a = update(a, { deliveredAt: '' });
  assert.equal(a.operations.at(-1).type, 'delivery_cancelled');
  assert.deepEqual(update(a, {}).operations, a.operations);
});

test('invalid delivery dates fail; non-sold works cannot be delivered', () => {
  const sold = update(fresh(), { status: 'sold' });
  assert.throws(() => update(sold, { deliveredAt: '2026-02-30' }));
  assert.throws(() => update(sold, { deliveredAt: 'not-a-date' }));
  assert.equal(update(fresh(), { deliveredAt: '2026-09-27' }).deliveredAt, '');
});

test('manually entered ownership is not duplicated and unsaved history cannot overwrite records', () => {
  const a = update(fresh(), { status: 'sold', provenance: [{ label: 'Approved public label', from: '2026-09' }] });
  assert.equal(a.provenance.length, 1);
  assert.deepEqual(update(a, { operations: [] }).operations, a.operations);
});

// Execute the actual administrator handlers with an isolated store, without touching real catalog data.
const source = fs.readFileSync(require.resolve('../assets/js/admin.js'), 'utf8');
function functionSource(name) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end < 0 ? source.lastIndexOf('})();') : end);
}
function adminHarness(work, fail = false) {
  const context = {
    state: { catalog: { artworks: [work] }, saving: false },
    window: { ONELifecycle: { reconcile } },
    clone: a => JSON.parse(JSON.stringify(a)),
    statusLabel: s => s, thisMonth: () => '2026-09', today: () => '2026-09-27',
    confirm: () => true, toast() {}, savedSuffix: () => '', renderList() {}, refreshDirty() {},
    handleError(e) { context.error = e; }, S: { CATALOG_PATH: 'data/catalog.json' },
    setCatalog(next) { context.state.catalog = next; },
    esc: x => String(x).replace(/</g, '&lt;'),
  };
  context.state.store = { commit: async () => { if (fail) throw Error('save failed'); } };
  context.findArtwork = id => context.state.catalog.artworks.find(a => a.id === id);
  vm.createContext(context);
  for (const name of ['saveChange', 'confirmTransition', 'changeStatus', 'markDelivered', 'operationHistory']) {
    vm.runInContext(functionSource(name), context);
  }
  return context;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('administrator list actions save reservation, sale, delivery, cancellation', async () => {
  const ctx = adminHarness(fresh());
  for (const status of ['reserved', 'sold']) {
    ctx.changeStatus('test', status, {});
    await settle();
  }
  ctx.markDelivered('test', {});
  await settle();
  assert.equal(ctx.findArtwork('test').deliveredAt, '2026-09-27');
  ctx.changeStatus('test', 'available', {});
  await settle();
  const a = ctx.findArtwork('test');
  assert.equal(a.provenance.length, 0);
  assert.equal(a.operations.length, 4);
  assert.match(ctx.operationHistory(a), /sale_cancelled|판매 취소/);
  assert.equal(ctx.error, undefined);
});

test('save failure leaves original data intact and cancellation confirmation can stop mutation', async () => {
  const ctx = adminHarness(fresh(), true);
  ctx.changeStatus('test', 'sold', {});
  await settle();
  assert.equal(ctx.findArtwork('test').status, 'available');
  assert.equal(ctx.state.saving, false);
  assert.ok(ctx.error);
  const sold = update(fresh(), { status: 'sold' });
  const other = adminHarness(sold);
  other.confirm = () => false;
  other.changeStatus('test', 'available', {});
  await settle();
  assert.equal(other.findArtwork('test').status, 'sold');
});

test('editor save uses the same lifecycle for sale, delivery and cancellation', async () => {
  const initial = { ...fresh(), title: 'Test', artistId: 'artist', images: [], exhibitions: [] };
  const ctx = adminHarness(initial);
  Object.assign(ctx, {
    pending: {}, blobCache: {}, findArtist: () => ({ id: 'artist' }), byId: () => 0,
    go() {}, markInvalid: (key, msg) => { throw Error(key + msg); },
  });
  vm.runInContext(functionSource('saveArtwork'), ctx);
  for (const changes of [{ status: 'sold' }, { deliveredAt: '2026-09-27' }, { status: 'available' }]) {
    ctx.state.draft = { kind: 'artwork', isNew: false, originalId: 'test', data: { ...ctx.findArtwork('test'), ...changes } };
    ctx.saveArtwork();
    await settle();
    assert.equal(ctx.error, undefined);
  }
  const a = ctx.findArtwork('test');
  assert.equal(a.status, 'available');
  assert.equal(a.provenance.length, 0);
  assert.deepEqual(Array.from(a.operations, r => r.type), ['sale_completed', 'delivered', 'sale_cancelled']);
});
