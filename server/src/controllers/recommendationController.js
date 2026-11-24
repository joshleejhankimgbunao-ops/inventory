/* global require, module */
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { writeActivityLog } = require('../services/logService');
const { publishInventoryUpdated } = require('../services/realtimeService');
const limits = require('../../../shared/recommendationBasisLimits.json');

const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
const sku = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const idOf = (value) => String(value?._id || value || '');
const fieldsFor = (value) => {
  const type = value === undefined ? 'alternative' : value;
  if (!['alternative', 'budget'].includes(type)) throw invalid('Invalid recommendation relationship type.');
  return type === 'budget'
    ? { type, manual: 'manualBudgetOptions', excluded: 'excludedBudgetOptions', label: 'Budget Option' }
    : { type, manual: 'manualAlternatives', excluded: 'excludedAlternatives', label: 'Alternative Product' };
};
const validateIdentity = (id) => {
  if (!mongoose.isValidObjectId(id)) throw invalid('Invalid product identity.');
};
const readText = (body, key) => {
  const label = key === 'justification' ? 'Displayed Explanation' : key === 'systemSuggestion' ? 'Original system suggestion' : key === 'reviewReason' ? 'Review reason' : 'Important Differences / Limitations';
  if (body[key] === undefined) return '';
  if (typeof body[key] !== 'string') throw invalid(`${label} must be text.`);
  const value = body[key].trim();
  if (value.length > limits[key]) throw invalid(`${label} cannot exceed ${limits[key]} characters.`);
  if ([...value].some((char) => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) throw invalid('Basis text contains unsupported control characters.');
  return value;
};
const readRevision = (value, required = false) => {
  if (value === undefined && !required) return undefined;
  if ((typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
    throw invalid('A valid recommendation revision is required. Refresh and retry.');
  }
  return Number(value);
};
const readStaffReasons = (value, previous) => {
  if (value === undefined) return previous;
  if (!Array.isArray(value) || value.length > limits.reasonCount) throw invalid(`Use up to ${limits.reasonCount} staff reasons.`);
  return value.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some((key) => !['indicator', 'text'].includes(key)) || !['check', 'neutral', 'warning'].includes(row.indicator)) throw invalid('Invalid staff reason indicator or fields.');
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.trim().length > limits.reasonText) throw invalid(`Each staff reason needs 1 to ${limits.reasonText} characters.`);
    const text = row.text.trim();
    if ([...text].some((char) => char.charCodeAt(0) < 32 && !['\n', '\r', '\t'].includes(char))) throw invalid('Staff reason contains unsupported control characters.');
    return { indicator: row.indicator, text };
  });
};
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const snapshotFilter = (target, expectedRevision) => {
  const revision = Number(target.recommendationRevision || 0);
  if (expectedRevision !== undefined && expectedRevision !== revision) throw invalid('Recommendations changed. Refresh before saving this basis.', 409);
  return { _id: target._id, sku: target.sku, $expr: { $eq: [{ $ifNull: ['$recommendationRevision', 0] }, revision] } };
};
const basisRows = (target) => (target.recommendationBases || []).map((row) => row.toObject ? row.toObject() : { ...row });
const recordFor = (target, candidate, fields, body, user, previous) => ({
  staffReasons: readStaffReasons(body.staffReasons, previous?.staffReasons),
  type: fields.type,
  targetSku: target.sku,
  candidateProduct: candidate._id,
  candidateSku: candidate.sku,
  systemGenerated: previous ? previous.systemGenerated === true : body.systemGenerated === true,
  systemSuggestion: previous ? previous.systemSuggestion : readText(body, 'systemSuggestion'),
  justification: readText({ justification: previous?.justification, ...body }, 'justification'),
  limitations: readText({ limitations: previous?.limitations, ...body }, 'limitations'),
  createdAt: previous?.createdAt || new Date(),
  createdBy: previous?.createdBy || user._id,
  updatedAt: new Date(),
  updatedBy: user._id,
  updatedByName: user.displayName || user.name || user.username || '',
});
const sameLink = (row, candidate, type) => row.type === type && (row.candidateSku === candidate.sku || idOf(row.candidateProduct) === idOf(candidate._id));
const ensureBoundIdentity = (rows, candidate, type) => {
  if (rows.some((row) => row.type === type && (
    (row.candidateSku === candidate.sku && idOf(row.candidateProduct) !== idOf(candidate._id))
    || (idOf(row.candidateProduct) === idOf(candidate._id) && row.candidateSku !== candidate.sku)
  ))) throw invalid('The recommended SKU changed. Remove the old relationship and re-add the current SKU after review.', 409);
};
const logChange = async (req, product, action, details) => {
  await writeActivityLog({ user: req.user, action, details, ipAddress: req.ip, userAgent: req.get('user-agent') || '' });
  publishInventoryUpdated({ reason: 'product.recommendation.updated', productCodes: [product.sku] });
};
const handle = (operation) => async (req, res, next) => {
  // Routes enforce this too; retain the boundary for any direct controller caller.
  if (!['admin', 'superadmin'].includes(req.user?.role)) return res.status(req.user ? 403 : 401).json({ message: 'Not authorized to manage recommendations.' });
  try { return await operation(req, res); } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    return next(error);
  }
};

const listActiveRecommendationProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ isActive: { $ne: false } })
      .select('-imageUrl')
      .sort({ createdAt: -1 })
      .lean();
    const canViewPurchaseCost = ['admin', 'superadmin'].includes(req.user?.role);
    return res.json(products.map((product) => {
      const payload = {
        ...product,
      availableToSell: Math.max(0, Number(product.stock || 0) - Number(product.reservedStock || 0)),
      };
      if (canViewPurchaseCost) return payload;
      const safeProduct = { ...payload };
      delete safeProduct.purchaseCost;
      return safeProduct;
    }));
  } catch (error) {
    return next(error);
  }
};

const addProductRecommendation = handle(async (req, res) => {
  const fields = fieldsFor(req.body?.type);
  validateIdentity(req.params.id);
  validateIdentity(req.body?.recommendationId);
  const recommendationCode = sku(req.body?.recommendationCode);
  if (!recommendationCode) throw invalid('A recommendation product is required.');
  // Validate text before any write, including optional blank basis on old clients.
  if (req.body.systemGenerated !== undefined && typeof req.body.systemGenerated !== 'boolean') throw invalid('Recommendation source must be valid.');
  readText(req.body, 'systemSuggestion'); readText(req.body, 'justification'); readText(req.body, 'limitations');
  readStaffReasons(req.body.staffReasons);
  const [target, candidate] = await Promise.all([
    Product.findById(req.params.id),
    Product.findOne({ _id: req.body.recommendationId, sku: recommendationCode, isActive: { $ne: false }, stock: { $gt: 0 } }),
  ]);
  if (!target) throw invalid('Product not found.', 404);
  if (target.isActive === false) throw invalid('Archived products cannot be used in new recommendations.', 409);
  if (!candidate) throw invalid('The selected recommendation is unavailable or its SKU changed.', 409);
  if (idOf(target._id) === idOf(candidate._id)) throw invalid('A product cannot recommend itself.');
  if (req.body.expectedTargetSku !== undefined && sku(req.body.expectedTargetSku) !== target.sku) throw invalid('The target SKU changed. Refresh before saving.', 409);
  ensureBoundIdentity(basisRows(target), candidate, fields.type);
  const rows = basisRows(target).filter((row) => !sameLink(row, candidate, fields.type));
  rows.push(recordFor(target, candidate, fields, req.body, req.user));
  const product = await Product.findOneAndUpdate(
    { ...snapshotFilter(target, readRevision(req.body.expectedRevision)), [fields.manual]: { $ne: candidate.sku } },
    { $addToSet: { [fields.manual]: candidate.sku }, $pull: { [fields.excluded]: candidate.sku }, $set: { recommendationBases: rows }, $inc: { recommendationRevision: 1 } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!product) throw invalid('This recommendation already exists or changed. Refresh and retry.', 409);
  await logChange(req, product, 'Added Recommendation', `Added ${fields.label} ${candidate.sku} to ${product.name} (${product.sku}); basis ${readText(req.body, 'justification') || req.body.staffReasons?.length ? 'recorded' : 'not recorded'}; revision ${product.recommendationRevision}.`);
  return res.json(product);
});

const editProductRecommendationBasis = handle(async (req, res) => {
  const allowed = ['type', 'recommendationCode', 'justification', 'limitations', 'staffReasons', 'expectedRevision', 'expectedTargetSku'];
  if (Object.keys(req.body || {}).some((key) => !allowed.includes(key))) throw invalid('Only recommendation basis fields may be edited.');
  const fields = fieldsFor(req.body?.type);
  validateIdentity(req.params.id); validateIdentity(req.params.candidateId);
  const expectedRevision = readRevision(req.body?.expectedRevision, true);
  const [target, candidate] = await Promise.all([Product.findById(req.params.id), Product.findById(req.params.candidateId)]);
  if (!target || !candidate) throw invalid('The target or recommended product no longer exists.', 404);
  if (idOf(target._id) === idOf(candidate._id)) throw invalid('A product cannot recommend itself.');
  if (sku(req.body.recommendationCode) !== candidate.sku || sku(req.body.expectedTargetSku) !== target.sku) throw invalid('A product SKU changed. Refresh and review this relationship.', 409);
  const rows = basisRows(target);
  ensureBoundIdentity(rows, candidate, fields.type);
  if (!(target[fields.manual] || []).includes(candidate.sku) || (target[fields.excluded] || []).includes(candidate.sku)) throw invalid('This manual relationship was removed or is no longer available.', 409);
  const previous = rows.find((row) => sameLink(row, candidate, fields.type));
  const nextRecord = recordFor(target, candidate, fields, req.body, req.user, previous);
  const basisKeys = ['justification', 'limitations', 'staffReasons'];
  if (previous?.targetSku === target.sku && basisKeys.every((key) => sameValue(previous[key], nextRecord[key]))) return res.json(target);
  const nextRows = rows.filter((row) => !sameLink(row, candidate, fields.type));
  nextRows.push(nextRecord);
  const product = await Product.findOneAndUpdate(
    { ...snapshotFilter(target, expectedRevision), [fields.manual]: candidate.sku, [fields.excluded]: { $ne: candidate.sku } },
    { $set: { recommendationBases: nextRows }, $inc: { recommendationRevision: 1 } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!product) {
    const latest = await Product.findById(target._id);
    const saved = latest?.recommendationBases.find((row) => sameLink(row, candidate, fields.type));
    if (latest?.sku === target.sku && latest[fields.manual].includes(candidate.sku) && !latest[fields.excluded].includes(candidate.sku) && saved?.candidateSku === candidate.sku && idOf(saved.candidateProduct) === idOf(candidate._id) && saved.targetSku === target.sku && basisKeys.every((key) => sameValue(saved[key], nextRecord[key]))) return res.json(latest);
    throw invalid('Recommendations changed while saving. Your input is retained; refresh before retrying.', 409);
  }
  const changes = basisKeys.filter((key) => !sameValue(previous?.[key], nextRecord[key])).map((key) => `${key} ${key === 'staffReasons' ? nextRecord[key]?.length ? 'updated' : 'cleared' : nextRecord[key] ? 'updated' : 'cleared'}`).join(', ') || 'basis confirmed';
  await logChange(req, product, 'Edited Recommendation Basis', `${fields.label} ${candidate.sku} for ${product.name} (${product.sku}): ${changes}; revision ${product.recommendationRevision}.`);
  return res.json(product);
});

const removeProductRecommendation = handle(async (req, res) => {
  const fields = fieldsFor(req.query?.type);
  validateIdentity(req.params.id);
  const code = sku(req.params.alternativeCode);
  if (!code) throw invalid('A recommendation code is required.');
  const target = await Product.findById(req.params.id);
  if (!target) throw invalid('Product not found.', 404);
  const product = await Product.findOneAndUpdate(
    { ...snapshotFilter(target, readRevision(req.query?.expectedRevision)), [fields.manual]: code },
    { $pull: { [fields.manual]: code }, $set: { recommendationBases: basisRows(target).filter((row) => row.type !== fields.type || row.candidateSku !== code) }, $inc: { recommendationRevision: 1 } },
    { returnDocument: 'after', runValidators: true }
  );
  if (!product) throw invalid('This recommendation was already removed or changed. Refresh and retry.', 409);
  await logChange(req, product, 'Removed Recommendation', `Removed manual ${fields.label} ${code} from ${product.name} (${product.sku}); associated basis removed; existing exclusions and review retained; revision ${product.recommendationRevision}.`);
  return res.json(product);
});

const reviewProductRecommendation = handle(async (req, res) => {
  const body = req.body || {};
  const allowed = ['decision', 'reviewReason', 'justification', 'limitations', 'staffReasons', 'recommendationCode', 'expectedTargetSku', 'expectedRevision', 'restoreExclusions'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw invalid('Only recommendation review fields may be edited.');
  if (!['not_reviewed', 'approved', 'rejected'].includes(body.decision)) throw invalid('Invalid review decision.');
  if (body.restoreExclusions !== undefined && typeof body.restoreExclusions !== 'boolean') throw invalid('Invalid exclusion restoration.');
  validateIdentity(req.params.id); validateIdentity(req.params.candidateId);
  const expectedRevision = readRevision(body.expectedRevision, true);
  const [target, candidate] = await Promise.all([Product.findById(req.params.id), Product.findById(req.params.candidateId)]);
  if (!target || !candidate) throw invalid('The target or recommended product no longer exists.', 404);
  if (body.decision === 'approved' && (target.isActive === false || candidate.isActive === false)) {
    throw invalid('Archived products cannot be approved as recommendations.', 409);
  }
  if (idOf(target._id) === idOf(candidate._id)) throw invalid('A product cannot recommend itself.');
  if (sku(body.expectedTargetSku) !== target.sku || sku(body.recommendationCode) !== candidate.sku) throw invalid('A product SKU changed. Refresh before reviewing.', 409);
  const rows = (target.recommendationReviews || []).map((row) => row.toObject());
  const previous = rows.find((row) => idOf(row.candidateProduct) === idOf(candidate._id));
  const values = Object.fromEntries(['reviewReason', 'justification', 'limitations'].map((key) => [key, readText({ [key]: previous?.[key], ...body }, key)]));
  values.staffReasons = readStaffReasons(body.staffReasons, previous?.staffReasons);
  const restoring = body.restoreExclusions === true && ['excludedAlternatives', 'excludedBudgetOptions'].some((key) => target[key].includes(candidate.sku));
  const same = previous && previous.targetSku === target.sku && previous.candidateSku === candidate.sku && previous.decision === body.decision && Object.keys(values).every((key) => sameValue(values[key], previous[key]));
  // Exact retries are acknowledgements, including a lost successful response.
  // A different edit at a stale revision still conflicts with all recommendation writes.
  if (same && !restoring) return res.json(target);
  const record = { targetSku: target.sku, candidateProduct: candidate._id, candidateSku: candidate.sku, decision: body.decision, ...values,
    updatedBy: req.user._id, updatedByName: req.user.displayName || req.user.name || req.user.username || '', updatedAt: new Date(), revision: Number(previous?.revision || 0) + 1 };
  const update = { $set: { recommendationReviews: [...rows.filter((row) => idOf(row.candidateProduct) !== idOf(candidate._id)), record] }, $inc: { recommendationRevision: 1 } };
  if (body.restoreExclusions === true) update.$pull = { excludedAlternatives: candidate.sku, excludedBudgetOptions: candidate.sku };
  const product = await Product.findOneAndUpdate(snapshotFilter(target, expectedRevision), update, { returnDocument: 'after', runValidators: true });
  if (!product) {
    const latest = await Product.findById(target._id);
    const saved = latest?.recommendationReviews.find((row) => idOf(row.candidateProduct) === idOf(candidate._id));
    if (latest?.sku === target.sku && saved?.targetSku === target.sku && saved?.candidateSku === candidate.sku && saved.decision === body.decision && Object.keys(values).every((key) => sameValue(saved[key], values[key]))
      && (!body.restoreExclusions || ![...latest.excludedAlternatives, ...latest.excludedBudgetOptions].includes(candidate.sku))) return res.json(latest);
    throw invalid('Recommendations changed while saving. Your input is retained; refresh before retrying.', 409);
  }
  await logChange(req, product, 'Reviewed Recommendation', `${candidate.sku} for ${product.name} (${product.sku}): ${body.decision}${restoring ? '; exclusions explicitly restored' : ''}; revision ${product.recommendationRevision}.`);
  return res.json(product);
});

module.exports = { addProductRecommendation, editProductRecommendationBasis, listActiveRecommendationProducts, removeProductRecommendation, reviewProductRecommendation };
