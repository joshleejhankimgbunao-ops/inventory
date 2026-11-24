/* global require, process */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');

// Actual HTTP authorization and single-document CAS writes in a fresh DB.
// Do not load .env, start the application server or use application databases.
const realtimePath = require.resolve('../src/services/realtimeService');
require.cache[realtimePath] = { id: realtimePath, filename: realtimePath, loaded: true, exports: new Proxy({}, { get: () => () => {} }) };
const Product = require('../src/models/Product');
const User = require('../src/models/User');
const ActivityLog = require('../src/models/ActivityLog');
const productRoutes = require('../src/routes/productRoutes');
const limits = require('../../shared/recommendationBasisLimits.json');
let temporaryDirectory;
let mongo;
let server;
let baseUrl;
const tokens = {};
const users = {};
const oldSecret = process.env.JWT_SECRET;

test.before(async () => {
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'recommendation-basis-test-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const binary = process.env.PRODUCT_TEST_MONGOD || (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' : 'mongod');
  mongo = spawn(binary, ['--dbpath', temporaryDirectory, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { windowsHide: true, stdio: 'ignore' });
  let startupError; mongo.on('error', (error) => { startupError = error; });
  const deadline = Date.now() + 20000;
  for (;;) {
    if (startupError) throw startupError;
    if (mongo.exitCode !== null || Date.now() > deadline) throw new Error('Disposable MongoDB could not start.');
    try { await mongoose.connect(`mongodb://127.0.0.1:${port}/recommendation_basis_test`, { serverSelectionTimeoutMS: 500 }); break; } catch { /* Fresh isolated DB only. */ }
  }
  await Promise.all([Product.init(), User.init(), ActivityLog.init()]);
  for (const [name, role] of [['admin', 'admin'], ['other', 'admin'], ['superadmin', 'superadmin'], ['cashier', 'cashier']]) {
    users[name] = await User.create({ username: name, name: `Basis ${name}`, password: randomBytes(24).toString('hex'), role });
    tokens[name] = jwt.sign({ id: users[name]._id }, process.env.JWT_SECRET, { expiresIn: '10m' });
  }
  const app = express(); app.use(express.json()); app.use('/api/products', productRoutes);
  app.use((_error, _req, res, next) => { void next; return res.status(500).json({ message: 'Test write failed.' }); });
  server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/products`;
});
test.after(async () => {
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await mongoose.disconnect();
  if (mongo?.pid && mongo.exitCode === null && mongo.signalCode === null) { const exited = once(mongo, 'exit'); mongo.kill(); await exited; }
  if (temporaryDirectory && path.dirname(temporaryDirectory) === path.resolve(os.tmpdir()) && path.basename(temporaryDirectory).startsWith('recommendation-basis-test-')) await fs.rm(temporaryDirectory, { recursive: true, force: true });
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});

const request = async (method, suffix = '', body, role = 'admin') => {
  const res = await fetch(`${baseUrl}${suffix}`, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
};
const pair = async (key, legacy = false) => {
  const candidate = await Product.create({ sku: `CAND-${key}`, name: `Candidate ${key}`, price: 80, stock: 12, sellingUnit: 'roll' });
  const target = await Product.create({ sku: `TARGET-${key}`, name: `Target ${key}`, price: 100, stock: 25, sellingUnit: 'roll', ...(legacy ? { manualAlternatives: [candidate.sku] } : {}) });
  return { target, candidate };
};
const add = ({ target, candidate }, extra = {}, role = 'admin') => request('POST', `/${target._id}/recommendations`, { recommendationId: String(candidate._id), recommendationCode: candidate.sku, type: 'alternative', ...extra }, role);
const edit = ({ target, candidate }, extra = {}, role = 'admin') => request('PATCH', `/${target._id}/recommendations/${candidate._id}/basis`, { type: 'alternative', recommendationCode: candidate.sku, expectedTargetSku: target.sku, expectedRevision: 0, justification: '', limitations: '', ...extra }, role);
const remove = ({ target, candidate }, type = 'alternative', revision, role = 'admin') => request('DELETE', `/${target._id}/recommendations/${encodeURIComponent(candidate.sku)}?type=${type}${revision === undefined ? '' : `&expectedRevision=${revision}`}`, undefined, role);
const review = ({ target, candidate }, extra = {}, role = 'admin') => request('PATCH', `/${target._id}/recommendations/${candidate._id}/review`, {
  decision: 'approved', recommendationCode: candidate.sku, expectedTargetSku: target.sku, expectedRevision: 0, ...extra,
}, role);

test('ordered staff reasons persist with stable relationship identity and legacy text intact', async () => {
  const row = await pair('REASONS');
  const reasons = [{ indicator: 'check', text: '  Staff-positive reason.  ' }, { indicator: 'neutral', text: 'Same quoted price.' }, { indicator: 'warning', text: 'Confirm color with customer.' }];
  const added = await add(row, { justification: 'Legacy justification.', limitations: 'Historical limitations.', staffReasons: reasons }, 'superadmin');
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.recommendationBases[0].staffReasons, reasons.map((reason) => ({ ...reason, text: reason.text.trim() })));
  const reordered = [reasons[2], { indicator: 'warning', text: 'Edited positive statement.' }];
  const edited = await edit(row, { expectedRevision: 1, justification: undefined, limitations: undefined, staffReasons: reordered });
  assert.equal(edited.status, 200);
  const basis = (await request('GET', '', undefined, 'cashier')).body.find((product) => product.sku === row.target.sku).recommendationBases[0];
  assert.deepEqual(basis.staffReasons, reordered);
  assert.equal(basis.justification, 'Legacy justification.'); assert.equal(basis.limitations, 'Historical limitations.');
  assert.equal(basis.candidateProduct, String(row.candidate._id)); assert.equal(basis.targetSku, row.target.sku);
  const cleared = await edit(row, { expectedRevision: 2, justification: undefined, limitations: undefined, staffReasons: [] });
  assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.recommendationBases[0].staffReasons, []);
  assert.equal(cleared.body.recommendationBases[0].justification, 'Legacy justification.');
  assert.equal(cleared.body.stock, row.target.stock);
  const reasonsOnly = await pair('REASONS-ONLY');
  assert.equal((await add(reasonsOnly, { staffReasons: [{ indicator: 'neutral', text: 'Private custom reason.' }] })).status, 200);
  const log = await ActivityLog.findOne({ action: 'Added Recommendation', details: { $regex: reasonsOnly.candidate.sku } });
  assert.match(log.details, /basis recorded/); assert.ok(!log.details.includes('Private custom reason.'));
});

test('reason validation and authorization protect Add, Edit Basis and automatic review', async () => {
  const row = await pair('REASONS-VALIDATE', true);
  for (const role of ['cashier', null]) {
    assert.equal((await edit(row, { staffReasons: [{ indicator: 'check', text: 'Try edit.' }] }, role)).status, role ? 403 : 401);
    assert.equal((await review(row, { staffReasons: [{ indicator: 'check', text: 'Try review.' }] }, role)).status, role ? 403 : 401);
  }
  for (const staffReasons of [null, {}, 'reason', [null], [{ indicator: 'approved', text: 'Claim.' }], [{ indicator: 'check', text: '' }], [{ indicator: 'neutral', text: 42 }], [{ indicator: 'check', text: 'x'.repeat(limits.reasonText + 1) }], Array(limits.reasonCount + 1).fill({ indicator: 'neutral', text: 'Extra.' }), [{ indicator: 'warning', text: 'bad\u0000text' }], [{ indicator: 'check', text: 'Fact.', verified: true }]]) {
    for (const send of [add, edit, review]) assert.equal((await send(row, { staffReasons })).status, 400);
  }
  const valid = Array(limits.reasonCount).fill({ indicator: 'neutral', text: 'x'.repeat(limits.reasonText) });
  assert.equal((await edit(row, { staffReasons: valid })).status, 200);
});

test('old clients preserve structured reasons and new edits retain historical prose without migrations', async () => {
  const row = await pair('REASONS-LEGACY', true);
  const first = await edit(row, { justification: 'Keep original prose.', limitations: 'Keep original limits.' });
  assert.equal(first.status, 200); assert.equal(first.body.recommendationBases[0].staffReasons, undefined);
  const structured = await edit(row, { expectedRevision: 1, justification: undefined, limitations: undefined, staffReasons: [{ indicator: 'neutral', text: 'Optional note.' }] });
  assert.equal(structured.status, 200);
  const oldClient = await edit(row, { expectedRevision: 2, justification: 'Explicitly edited prose.', limitations: undefined });
  assert.equal(oldClient.status, 200);
  assert.deepEqual(oldClient.body.recommendationBases[0].staffReasons, structured.body.recommendationBases[0].staffReasons);
  assert.equal(oldClient.body.recommendationBases[0].limitations, 'Keep original limits.');
});

test('concurrent reason edits are atomic and identical retries do not duplicate reasons or logs', async () => {
  const row = await pair('REASONS-RACE', true);
  const first = [{ indicator: 'check', text: 'Private staff statement.' }];
  const identical = await Promise.all(Array.from({ length: 5 }, () => edit(row, { staffReasons: first })));
  assert.ok(identical.every((result) => result.status === 200));
  let saved = await Product.findById(row.target._id);
  assert.equal(saved.recommendationRevision, 1); assert.deepEqual(saved.recommendationBases[0].staffReasons.toObject(), first);
  const competing = await Promise.all(Array.from({ length: 5 }, (_, index) => edit(row, { expectedRevision: 1, staffReasons: [{ indicator: index % 2 ? 'warning' : 'neutral', text: `Different ${index}` }] }, index % 2 ? 'other' : 'admin')));
  assert.equal(competing.filter((result) => result.status === 200).length, 1);
  assert.equal(competing.filter((result) => result.status === 409).length, 4);
  saved = await Product.findById(row.target._id); assert.equal(saved.recommendationRevision, 2); assert.equal(saved.recommendationBases[0].staffReasons.length, 1);
  const logs = await ActivityLog.find({ action: 'Edited Recommendation Basis', details: { $regex: row.candidate.sku } }).lean();
  assert.equal(logs.length, 2); assert.ok(logs.every((log) => !log.details.includes('Private staff statement.')));
});

test('automatic review reasons are separate from manual basis and survive review/reset retries', async () => {
  const row = await pair('REASONS-REVIEW');
  const reasons = [{ indicator: 'warning', text: 'Staff confirmation needed.' }];
  const first = await review(row, { staffReasons: reasons, justification: 'Earlier review note.' });
  assert.equal(first.status, 200); assert.deepEqual(first.body.recommendationReviews[0].staffReasons, reasons);
  assert.equal((await review(row, { staffReasons: reasons, justification: 'Earlier review note.' })).status, 200);
  const changed = await review(row, { expectedRevision: 1, decision: 'not_reviewed' });
  assert.equal(changed.status, 200); assert.deepEqual(changed.body.recommendationReviews[0].staffReasons, reasons);
  assert.equal(changed.body.recommendationReviews[0].justification, 'Earlier review note.');
  const manual = await add(row, { expectedRevision: 2, justification: 'Separate manual note.', staffReasons: [] });
  assert.equal(manual.status, 200);
  assert.deepEqual(manual.body.recommendationReviews[0].staffReasons, reasons);
  assert.deepEqual(manual.body.recommendationBases[0].staffReasons, []);
});

test('automatic staff justification can be added and edited without approving or restoring a suggestion', async () => {
  const row = await pair('AUTO-STAFF-NOTE');
  const first = await review(row, { decision: 'not_reviewed', justification: 'Check the intended use.' }, 'admin');
  assert.equal(first.status, 200);
  assert.equal(first.body.recommendationReviews[0].decision, 'not_reviewed');
  assert.deepEqual(first.body.manualAlternatives, []);
  const updated = await review(row, { expectedRevision: 1, decision: 'not_reviewed', justification: 'Confirm use with the customer.' }, 'superadmin');
  assert.equal(updated.status, 200);
  assert.equal(updated.body.recommendationReviews[0].decision, 'not_reviewed');
  assert.deepEqual(updated.body.excludedAlternatives, []);
  const cashierView = await request('GET', '', undefined, 'cashier');
  assert.equal(cashierView.body.find((product) => product.sku === row.target.sku).recommendationReviews[0].justification, 'Confirm use with the customer.');
  assert.equal((await review(row, { expectedRevision: 2, decision: 'not_reviewed', justification: 'Cashier edit.' }, 'cashier')).status, 403);
});

test('failed custom-reason writes preserve the previous array and revision for a safe retry', async () => {
  const row = await pair('REASONS-FAIL', true);
  await edit(row, { staffReasons: [{ indicator: 'neutral', text: 'Original.' }] });
  const native = Product.findOneAndUpdate;
  Product.findOneAndUpdate = () => { throw new Error('Simulated write failure.'); };
  const payload = { expectedRevision: 1, staffReasons: [{ indicator: 'warning', text: 'Changed.' }] };
  try { assert.equal((await edit(row, payload)).status, 500); } finally { Product.findOneAndUpdate = native; }
  const saved = await Product.findById(row.target._id);
  assert.equal(saved.recommendationRevision, 1); assert.equal(saved.recommendationBases[0].staffReasons[0].text, 'Original.');
  assert.equal((await edit(row, payload)).status, 200);
});

test('review endpoint enforces authorization, bounds, identities and allowed inputs', async () => {
  const row = await pair('REVIEW-AUTH');
  for (const role of ['cashier', null]) assert.equal((await review(row, {}, role)).status, role ? 403 : 401);
  for (const extra of [{ decision: 'verified' }, { reviewReason: {} }, { reviewReason: 'x'.repeat(limits.reviewReason + 1) }, { reviewReason: 'bad\u0000note' }, { justification: 'x'.repeat(limits.justification + 1) }, { limitations: {} }, { restoreExclusions: 'yes' }, { expectedRevision: -1 }, { expectedRevision: undefined }, { price: 1 }, { compatibility: { verified: true } }]) {
    assert.equal((await review(row, extra)).status, 400);
  }
  assert.equal((await review(row, { expectedTargetSku: 'STALE' })).status, 409);
  assert.equal((await review(row, { recommendationCode: 'STALE' })).status, 409);
  assert.equal((await review({ target: row.target, candidate: row.target })).status, 400);
  assert.equal((await Product.findById(row.target._id)).recommendationReviews.length, 0);
});

test('review persists actors, snapshots and separate basis while preserving legacy relationships', async () => {
  const row = await pair('REVIEW-SAVE', true);
  await edit(row, { justification: 'Existing manual reason.' });
  await Product.updateOne({ _id: row.target._id }, { $set: { manualBudgetOptions: [row.candidate.sku] } });
  const before = await Product.findById(row.target._id).lean();
  const result = await review(row, { expectedRevision: 1, reviewReason: '  Checked with customer.  ', justification: 'Automatic staff note.', limitations: 'Check use.' }, 'superadmin');
  assert.equal(result.status, 200);
  const saved = (await request('GET', '', undefined, 'cashier')).body.find((item) => item.sku === row.target.sku);
  const record = saved.recommendationReviews[0];
  assert.equal(record.decision, 'approved'); assert.equal(record.reviewReason, 'Checked with customer.');
  assert.equal(record.candidateProduct, String(row.candidate._id)); assert.equal(record.targetSku, row.target.sku); assert.equal(record.candidateSku, row.candidate.sku);
  assert.equal(record.updatedBy, String(users.superadmin._id)); assert.ok(record.updatedAt); assert.equal(record.revision, 1);
  assert.deepEqual(saved.manualAlternatives, before.manualAlternatives); assert.deepEqual(saved.manualBudgetOptions, before.manualBudgetOptions);
  assert.equal(saved.recommendationBases[0].justification, 'Existing manual reason.'); assert.equal(saved.price, before.price); assert.equal(saved.stock, before.stock);
});

test('review retries are idempotent and different concurrent decisions allow one winner', async () => {
  const row = await pair('REVIEW-RACE');
  await Product.collection.updateOne({ _id: row.target._id }, { $unset: { recommendationRevision: '', recommendationReviews: '' } });
  const identical = await Promise.all(Array.from({ length: 5 }, () => review(row, { reviewReason: 'Same request.' })));
  assert.ok(identical.every((result) => result.status === 200));
  let saved = await Product.findById(row.target._id);
  assert.equal(saved.recommendationRevision, 1); assert.equal(saved.recommendationReviews.length, 1);
  assert.equal(await ActivityLog.countDocuments({ action: 'Reviewed Recommendation', details: { $regex: row.candidate.sku } }), 1);
  const competing = await Promise.all(Array.from({ length: 6 }, (_, index) => review(row, { expectedRevision: 1, decision: index % 2 ? 'rejected' : 'not_reviewed', reviewReason: `Reason ${index}` }, index % 2 ? 'other' : 'admin')));
  assert.equal(competing.filter((result) => result.status === 200).length, 1);
  assert.ok(competing.filter((result) => result.status !== 200).every((result) => result.status === 409));
  saved = await Product.findById(row.target._id); assert.equal(saved.recommendationRevision, 2); assert.equal(saved.recommendationReviews[0].revision, 2);
  assert.equal((await review(row, { expectedRevision: 0, decision: 'rejected', reviewReason: 'Stale replacement.' })).status, 409);
});

test('review and basis writes share one concurrency boundary; failed review saves no partial metadata', async () => {
  const row = await pair('REVIEW-BASIS-RACE', true);
  const results = await Promise.all([review(row, { reviewReason: 'Review write.' }), edit(row, { justification: 'Basis write.' })]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 1);
  assert.equal((await Product.findById(row.target._id)).recommendationRevision, 1);
  const failed = await pair('REVIEW-FAIL');
  const native = Product.findOneAndUpdate;
  Product.findOneAndUpdate = () => { throw new Error('Simulated write failure.'); };
  try { assert.equal((await review(failed, { decision: 'rejected' })).status, 500); }
  finally { Product.findOneAndUpdate = native; }
  const unchanged = await Product.findById(failed.target._id);
  assert.equal(unchanged.recommendationRevision, 0); assert.equal(unchanged.recommendationReviews.length, 0);
  assert.equal((await review(failed, { decision: 'rejected' })).status, 200);
});

test('approval preserves exclusions; explicit restoration clears both lists without deleting budget history', async () => {
  const row = await pair('REVIEW-RESTORE');
  await Product.updateOne({ _id: row.target._id }, { $set: { excludedAlternatives: [row.candidate.sku], excludedBudgetOptions: [row.candidate.sku], manualBudgetOptions: [row.candidate.sku] } });
  const approved = await review(row);
  assert.equal(approved.status, 200); assert.deepEqual(approved.body.excludedAlternatives, [row.candidate.sku]); assert.deepEqual(approved.body.excludedBudgetOptions, [row.candidate.sku]);
  const restored = await review(row, { decision: 'not_reviewed', restoreExclusions: true, expectedRevision: 1 });
  assert.equal(restored.status, 200); assert.deepEqual(restored.body.excludedAlternatives, []); assert.deepEqual(restored.body.excludedBudgetOptions, []);
  assert.deepEqual(restored.body.manualBudgetOptions, [row.candidate.sku]);
  assert.equal((await review(row, { decision: 'not_reviewed', restoreExclusions: true, expectedRevision: 1 })).status, 200);
  assert.equal((await Product.findById(row.target._id)).recommendationRevision, 2);
});

test('reviews survive archive/rename and cannot be saved against missing or stale identities', async () => {
  const row = await pair('REVIEW-IDENTITY');
  assert.equal((await review(row)).status, 200);
  await Product.updateOne({ _id: row.candidate._id }, { $set: { sku: 'REVIEW-RENAMED', isActive: false } });
  assert.equal((await review(row, { decision: 'rejected', expectedRevision: 1 })).status, 409);
  const renamed = { ...row, candidate: { _id: row.candidate._id, sku: 'REVIEW-RENAMED' } };
  const result = await review(renamed, { decision: 'not_reviewed', expectedRevision: 1 });
  assert.equal(result.status, 200); assert.equal(result.body.recommendationReviews.length, 1); assert.equal(result.body.recommendationReviews[0].candidateSku, 'REVIEW-RENAMED');
  await Product.deleteOne({ _id: row.candidate._id });
  assert.equal((await review(renamed, { expectedRevision: 2 })).status, 404);
  assert.equal((await Product.findById(row.target._id)).recommendationReviews.length, 1);
});

test('backend rejects cashier and anonymous mutations; cashier can read saved basis', async () => {
  const row = await pair('AUTH');
  for (const role of ['cashier', null]) {
    assert.equal((await add(row, {}, role)).status, role ? 403 : 401);
    assert.equal((await edit(row, {}, role)).status, role ? 403 : 401);
    assert.equal((await request('DELETE', `/${row.target._id}/recommendations/${row.candidate.sku}`, undefined, role)).status, role ? 403 : 401);
  }
  assert.equal((await add(row, { justification: 'Approved business choice.' }, 'superadmin')).status, 200);
  const visible = await request('GET', '', undefined, 'cashier');
  assert.equal(visible.body.find((item) => item.sku === row.target.sku).recommendationBases[0].justification, 'Approved business choice.');
});

test('Add saves trimmed basis, stable SKU identity and actor without changing price or stock', async () => {
  const row = await pair('ADD');
  const result = await add(row, { systemGenerated: true, systemSuggestion: '  Matching size: Standard.  ', justification: '  Same documented application.  ', limitations: '  Review finish with customer.  ' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.manualAlternatives, [row.candidate.sku]);
  assert.equal(result.body.recommendationRevision, 1);
  const saved = await Product.findById(row.target._id).lean();
  assert.equal(saved.recommendationBases.length, 1);
  const basis = saved.recommendationBases[0];
  assert.equal(basis.targetSku, row.target.sku);
  assert.equal(String(basis.candidateProduct), String(row.candidate._id));
  assert.equal(basis.candidateSku, row.candidate.sku);
  assert.equal(basis.justification, 'Same documented application.');
  assert.equal(basis.systemSuggestion, 'Matching size: Standard.');
  assert.equal(basis.systemGenerated, true);
  assert.equal(basis.limitations, 'Review finish with customer.');
  assert.equal(String(basis.updatedBy), String(users.admin._id));
  assert.ok(basis.createdAt && basis.updatedAt);
  assert.equal(saved.stock, 25); assert.equal(saved.price, 100);
  assert.equal((await Product.findById(row.candidate._id)).stock, 12);
  assert.equal((await edit(row, { expectedRevision: 1, justification: 'Updated explanation.', systemSuggestion: 'Replacement original.', systemGenerated: false })).status, 400);
  const edited = await edit(row, { expectedRevision: 1, justification: 'Updated explanation.' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.recommendationBases[0].justification, 'Updated explanation.');
  assert.equal(edited.body.recommendationBases[0].systemSuggestion, 'Matching size: Standard.');
  assert.equal(edited.body.recommendationBases[0].systemGenerated, true);
});

test('legacy missing metadata/revision can be edited and cleared by Admin or Super Admin', async () => {
  const row = await pair('LEGACY', true);
  await Product.collection.updateOne({ _id: row.target._id }, { $unset: { recommendationRevision: '', recommendationBases: '' } });
  const before = await Product.findById(row.target._id);
  assert.equal(before.recommendationBases.length, 0);
  const first = await edit(row, { justification: 'Legacy basis.', limitations: 'Check the required rating.' }, 'superadmin');
  assert.equal(first.status, 200);
  const cleared = await edit(row, { expectedRevision: 1, justification: '  ', limitations: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.recommendationBases.length, 1);
  assert.equal(cleared.body.recommendationBases[0].justification, '');
  assert.equal(cleared.body.recommendationBases[0].limitations, '');
  assert.equal(cleared.body.recommendationBases[0].createdAt, first.body.recommendationBases[0].createdAt);
  assert.deepEqual(cleared.body.manualAlternatives, [row.candidate.sku]);
});

test('invalid types, text, identities, missing versions, self-links and fact edits are rejected', async () => {
  const row = await pair('INVALID', true);
  for (const extra of [{ type: 'related' }, { type: null }, { justification: {} }, { justification: 'x'.repeat(limits.justification + 1) }, { limitations: 'x'.repeat(limits.limitations + 1) }, { justification: 'bad\u0000text' }, { expectedRevision: -1 }, { compatibility: { verified: true } }, { price: 1 }, { stock: 99 }]) {
    assert.equal((await edit(row, extra)).status, 400, JSON.stringify(extra).slice(0, 70));
  }
  assert.equal((await add(row, { systemGenerated: 'yes' })).status, 400);
  assert.equal((await add(row, { systemSuggestion: 'x'.repeat(limits.systemSuggestion + 1) })).status, 400);
  assert.equal((await request('PATCH', `/${row.target._id}/recommendations/${row.candidate._id}/basis`, { type: 'alternative' })).status, 400);
  assert.equal((await add(row, { recommendationId: String(row.target._id), recommendationCode: row.target.sku })).status, 400);
  assert.equal((await add(row, { recommendationId: 'bad' })).status, 400);
  assert.equal((await remove(row, 'unknown')).status, 400);
  assert.equal((await edit({ ...row, candidate: { _id: new mongoose.Types.ObjectId(), sku: 'MISSING' } })).status, 404);
  assert.equal((await Product.findById(row.target._id)).recommendationBases.length, 0);
});

test('an automatic or removed relationship cannot acquire orphaned manual basis', async () => {
  const row = await pair('NO-LINK');
  assert.equal((await edit(row, { justification: 'Cannot attach.' })).status, 409);
  await Product.updateOne({ _id: row.target._id }, { $set: { manualAlternatives: [row.candidate.sku], excludedAlternatives: [row.candidate.sku] } });
  assert.equal((await edit(row)).status, 409);
  assert.equal((await Product.findById(row.target._id)).recommendationBases.length, 0);
});

test('simultaneous edits allow one revision winner and leave exactly one basis record', async () => {
  const row = await pair('EDIT-RACE', true);
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => edit(row, { justification: `Reason ${index}` }, index % 2 ? 'other' : 'admin')));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.ok(results.filter((result) => result.status !== 200).every((result) => result.status === 409));
  const saved = await Product.findById(row.target._id);
  assert.equal(saved.recommendationRevision, 1);
  assert.equal(saved.recommendationBases.length, 1);
  assert.equal(saved.recommendationBases[0].justification, results.find((result) => result.status === 200).body.recommendationBases[0].justification);
  assert.equal(await ActivityLog.countDocuments({ action: 'Edited Recommendation Basis', details: { $regex: row.candidate.sku } }), 1);
});

test('concurrent Add retries create one link and one basis; a failed write saves neither', async () => {
  const row = await pair('ADD-RACE');
  const results = await Promise.all(Array.from({ length: 8 }, () => add(row, { justification: 'One basis.' })));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  const saved = await Product.findById(row.target._id);
  assert.equal(saved.manualAlternatives.length, 1); assert.equal(saved.recommendationBases.length, 1);
  const failed = await pair('FAILED');
  const original = Product.findOneAndUpdate;
  Product.findOneAndUpdate = async () => { throw new Error('Simulated atomic write failure'); };
  try { assert.equal((await add(failed, { justification: 'Not saved.' })).status, 500); } finally { Product.findOneAndUpdate = original; }
  const unchanged = await Product.findById(failed.target._id);
  assert.equal(unchanged.manualAlternatives.length, 0); assert.equal(unchanged.recommendationBases.length, 0);
  assert.equal((await add(failed)).status, 200);
});

test('Remove reconciles metadata by type, invalidates stale editors and permits clean re-add', async () => {
  const row = await pair('REMOVE');
  await add(row, { justification: 'Alternative basis.' });
  assert.equal((await add(row, { type: 'budget', justification: 'Budget basis.' })).status, 200);
  assert.equal((await remove(row, 'alternative', 2)).status, 200);
  const saved = await Product.findById(row.target._id);
  assert.deepEqual([...saved.manualAlternatives], []);
  assert.deepEqual([...saved.excludedAlternatives], []);
  assert.equal(saved.recommendationBases.length, 1);
  assert.equal(saved.recommendationBases[0].type, 'budget');
  assert.equal((await edit(row, { expectedRevision: 1, justification: 'Stale editor.' })).status, 409);
  assert.equal((await remove(row)).status, 409);
  const added = await add(row);
  assert.equal(added.status, 200);
  assert.equal(added.body.recommendationBases.filter((record) => record.type === 'alternative').length, 1);
  assert.equal(added.body.recommendationBases.find((record) => record.type === 'alternative').justification, '');
});

test('Remove changes only a manual link and its basis, preserving reviews and historical exclusions', async () => {
  const row = await pair('REMOVE-INDEPENDENT');
  await add(row, { justification: 'Manual choice.' });
  assert.equal((await remove(row, 'alternative', 1, 'cashier')).status, 403);
  assert.equal((await remove(row, 'alternative', 1, null)).status, 401);
  const reviewed = await review(row, { expectedRevision: 1, decision: 'rejected', reviewReason: 'Do not suggest.' });
  assert.equal(reviewed.status, 200);
  const removed = await remove(row, 'alternative', 2);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.manualAlternatives, []);
  assert.deepEqual(removed.body.excludedAlternatives, []);
  assert.equal(removed.body.recommendationBases.length, 0);
  assert.equal(removed.body.recommendationReviews[0].decision, 'rejected');
  assert.equal((await remove(row, 'alternative', 3)).status, 409);

  const excluded = await pair('REMOVE-EXCLUDED');
  await add(excluded);
  await Product.updateOne({ _id: excluded.target._id }, { $set: { excludedAlternatives: [excluded.candidate.sku] } });
  const result = await remove(excluded, 'alternative', 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.excludedAlternatives, [excluded.candidate.sku]);
  assert.deepEqual(result.body.manualAlternatives, []);
  assert.equal(result.body.recommendationBases.length, 0);
});

test('edit/remove races cannot leave basis without membership', async () => {
  const row = await pair('REMOVE-RACE', true);
  const results = await Promise.all([edit(row, { justification: 'Concurrent edit.' }), remove(row, 'alternative', 0)]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 1);
  const saved = await Product.findById(row.target._id);
  assert.equal(saved.recommendationBases.length, saved.manualAlternatives.includes(row.candidate.sku) ? 1 : 0);
});

test('archived candidate basis can be documented without changing availability or stock', async () => {
  const row = await pair('ARCHIVED'); await add(row);
  await Product.updateOne({ _id: row.candidate._id }, { $set: { isActive: false, stock: 0 } });
  const changed = await edit(row, { expectedRevision: 1, justification: 'Retained for historical review.' });
  assert.equal(changed.status, 200);
  const candidate = await Product.findById(row.candidate._id);
  assert.equal(candidate.isActive, false); assert.equal(candidate.stock, 0);
});

test('renamed/reused candidate SKUs reject stale edits; old links can be removed explicitly', async () => {
  const row = await pair('RENAME'); await add(row, { justification: 'Original identity only.' });
  await Product.updateOne({ _id: row.candidate._id }, { $set: { sku: 'RENAMED-CANDIDATE' } });
  assert.equal((await edit(row, { expectedRevision: 1 })).status, 409);
  const newIdentity = await Product.create({ sku: row.candidate.sku, name: 'Different SKU owner', price: 1, stock: 5 });
  assert.equal((await edit({ ...row, candidate: newIdentity }, { expectedRevision: 1 })).status, 409);
  const renamed = await Product.findById(row.candidate._id);
  assert.equal((await add({ ...row, candidate: renamed })).status, 409);
  assert.equal((await remove(row)).status, 200);
  const next = await add({ ...row, candidate: renamed });
  assert.equal(next.status, 200);
  assert.equal(next.body.recommendationBases.length, 1);
  assert.equal(next.body.recommendationBases[0].candidateSku, renamed.sku);
});

test('target SKU changes invalidate an open editor while the stable product owner remains editable', async () => {
  const row = await pair('SOURCE-RENAME', true);
  await Product.updateOne({ _id: row.target._id }, { $set: { sku: 'RENAMED-SOURCE' } });
  assert.equal((await edit(row, { justification: 'Stale source snapshot.' })).status, 409);
  const refreshed = await edit(row, { expectedTargetSku: 'RENAMED-SOURCE', justification: 'Reviewed current source.' });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.recommendationBases[0].targetSku, 'RENAMED-SOURCE');
});

test('activity identifies actor, link and changed fields without copying free text into logs', async () => {
  const row = await pair('AUDIT');
  await add(row, { justification: 'private free text' });
  await edit(row, { expectedRevision: 1, justification: 'new private free text', limitations: 'customer detail' });
  await remove(row);
  const logs = await ActivityLog.find({ details: { $regex: row.candidate.sku } }).lean();
  assert.equal(logs.length, 3);
  assert.deepEqual(logs.map((log) => log.action).sort(), ['Added Recommendation', 'Edited Recommendation Basis', 'Removed Recommendation'].sort());
  assert.ok(logs.every((log) => String(log.userRef) === String(users.admin._id)));
  assert.ok(logs.every((log) => !log.details.includes('private free text') && !log.details.includes('customer detail')));
  assert.ok(logs.some((log) => log.details.includes('justification updated') && log.details.includes('limitations updated')));
});

test('active recommendation catalog hides archived products without mutating saved links or review history', async () => {
  const row = await pair('ACTIVE-CATALOG');
  const privateImagePayload = 'data:image/png;base64,cHJvZHVjdC1pbWFnZS1wYXlsb2Fk';
  await Product.updateOne({ _id: row.candidate._id }, { $set: { imageUrl: privateImagePayload } });
  await add(row, { justification: 'Keep this manual basis.' });
  await review(row, { expectedRevision: 1, decision: 'approved', reviewReason: 'Existing approval.' });
  const before = await Product.findById(row.target._id).lean();

  await Product.updateOne({ _id: row.candidate._id }, { $set: { isActive: false } });
  let response = await request('GET', '/recommendations/active', undefined, 'cashier');
  assert.equal(response.status, 200);
  assert.equal(response.body.some((product) => String(product._id) === String(row.candidate._id)), false);
  const retained = await Product.findById(row.target._id).lean();
  assert.deepEqual(retained.manualAlternatives, before.manualAlternatives);
  assert.deepEqual(retained.recommendationBases, before.recommendationBases);
  assert.deepEqual(retained.recommendationReviews, before.recommendationReviews);

  await Product.updateOne({ _id: row.candidate._id }, { $set: { isActive: true } });
  response = await request('GET', '/recommendations/active', undefined, 'cashier');
  assert.equal(response.body.some((product) => String(product._id) === String(row.candidate._id)), true);
  const restoredCandidate = response.body.find((product) => String(product._id) === String(row.candidate._id));
  assert.equal(Object.hasOwn(restoredCandidate, 'imageUrl'), false, 'recommendation catalog keeps image payloads out of the list response');
  assert.equal((await Product.findById(row.candidate._id).lean()).imageUrl, privateImagePayload, 'stored image remains available through the scoped image endpoint');
  const restored = await Product.findById(row.target._id).lean();
  assert.deepEqual(restored.recommendationBases, before.recommendationBases);
  assert.deepEqual(restored.recommendationReviews, before.recommendationReviews);
});

test('new manual recommendations and approvals reject archived target or candidate products', async () => {
  const archivedCandidate = await pair('ACTIVE-GUARD-CANDIDATE');
  await Product.updateOne({ _id: archivedCandidate.candidate._id }, { $set: { isActive: false } });
  assert.equal((await add(archivedCandidate)).status, 409);
  assert.equal((await review(archivedCandidate, { decision: 'approved' })).status, 409);

  const archivedTarget = await pair('ACTIVE-GUARD-TARGET');
  await Product.updateOne({ _id: archivedTarget.target._id }, { $set: { isActive: false } });
  assert.equal((await add(archivedTarget)).status, 409);
  assert.equal((await review(archivedTarget, { decision: 'approved' })).status, 409);

  // Recording a rejection for an archived suggestion remains available; it does
  // not restore or approve the relationship when the product later returns.
  assert.equal((await review(archivedCandidate, { decision: 'rejected' })).status, 200);
  const saved = await Product.findById(archivedCandidate.target._id).lean();
  assert.equal(saved.recommendationReviews[0].decision, 'rejected');
});
