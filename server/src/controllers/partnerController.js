const Partner = require('../models/Partner');
const { publishPartnersUpdated } = require('../services/realtimeService');

const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeString = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeEmail = (value) => normalizeString(value).toLowerCase();

const normalizeCustomerType = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (['regular', 'walk-in', 'vip'].includes(normalized)) {
    return normalized;
  }
  return 'regular';
};

const parseBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
};

const normalizeSupplierCapabilities = (value) => {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  const normalized = [];

  for (const entry of value) {
    const category = normalizeString(entry?.category);
    const brand = normalizeString(entry?.brand);
    if (!category) continue;

    const key = `${category.toLowerCase()}::${brand.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    normalized.push({ category, brand });
  }

  return normalized;
};

const isValidType = (value) => ['supplier', 'customer'].includes(value);

const listPartners = async (req, res, next) => {
  try {
    const type = normalizeString(req.query?.type).toLowerCase();
    const search = normalizeString(req.query?.search).toLowerCase();
    const includeArchived = parseBool(req.query?.includeArchived, false);

    if (type && !isValidType(type)) {
      return res.status(400).json({ message: "type must be 'supplier' or 'customer'." });
    }

    const query = {};

    if (type) {
      query.type = type;
    }

    if (!includeArchived) {
      query.isArchived = false;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
      ];
    }

    const partners = await Partner.find(query).sort({ createdAt: -1 });
    return res.json(partners);
  } catch (error) {
    return next(error);
  }
};

const createPartner = async (req, res, next, dependencies = {}) => {
  const findByRequestId = dependencies.findByRequestId || ((clientRequestId) => Partner.findOne({ clientRequestId }));
  const createPartnerRecord = dependencies.createPartnerRecord || ((payload) => Partner.create(payload));

  try {
    const clientRequestId = normalizeString(req.body?.clientRequestId);
    if (clientRequestId) {
      const existing = await findByRequestId(clientRequestId);
      if (existing) return res.status(200).json(existing);
    }

    const type = normalizeString(req.body?.type).toLowerCase();
    const name = normalizeString(req.body?.name);
    const contact = normalizeString(req.body?.contact);
    const email = normalizeEmail(req.body?.email);
    const address = normalizeString(req.body?.address);
    const note = normalizeString(req.body?.note);
    const supplierCapabilities = normalizeSupplierCapabilities(req.body?.supplierCapabilities);
    const customerType = normalizeCustomerType(req.body?.customerType);
    const isVerifiedCustomer = parseBool(req.body?.isVerifiedCustomer, true);

    if (!isValidType(type)) {
      return res.status(400).json({ message: "type is required and must be 'supplier' or 'customer'." });
    }

    if (!name) {
      return res.status(400).json({ message: 'name is required.' });
    }

    if (email && !EMAIL_RULE.test(email)) {
      return res.status(400).json({ message: 'email must be valid when provided.' });
    }

    const partner = await createPartnerRecord({
      type,
      name,
      contact,
      email,
      address,
      note,
      supplierCapabilities: type === 'supplier' ? supplierCapabilities : [],
      customerType: type === 'customer' ? customerType : 'regular',
      isVerifiedCustomer: type === 'customer' ? isVerifiedCustomer : true,
      isVatExempt: false,
      ...(clientRequestId ? { clientRequestId } : {}),
    });

    publishPartnersUpdated({
      reason: 'partner.created',
      partnerId: partner._id,
      partnerType: partner.type,
    });

    return res.status(201).json(partner);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.clientRequestId) {
      const existing = await findByRequestId(normalizeString(req.body?.clientRequestId));
      if (existing) return res.status(200).json(existing);
    }
    return next(error);
  }
};

const updatePartner = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Partner.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Partner not found.' });
    }

    const expectedUpdatedAtRaw = normalizeString(req.body?.expectedUpdatedAt);
    if (expectedUpdatedAtRaw) {
      const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
      if (!Number.isNaN(expectedUpdatedAt.getTime()) && existing.updatedAt) {
        if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          return res.status(409).json({ message: 'This partner was updated by another user. Please refresh and try again.' });
        }
      }
    }

    const payload = {};

    if (req.body?.name !== undefined) payload.name = normalizeString(req.body.name);
    if (req.body?.contact !== undefined) payload.contact = normalizeString(req.body.contact);
    if (req.body?.email !== undefined) payload.email = normalizeEmail(req.body.email);
    if (req.body?.address !== undefined) payload.address = normalizeString(req.body.address);
    if (req.body?.note !== undefined) payload.note = normalizeString(req.body.note);
    if (req.body?.supplierCapabilities !== undefined) {
      payload.supplierCapabilities = normalizeSupplierCapabilities(req.body.supplierCapabilities);
    }
    if (req.body?.customerType !== undefined) {
      payload.customerType = normalizeCustomerType(req.body.customerType);
    }
    if (req.body?.isVerifiedCustomer !== undefined) {
      payload.isVerifiedCustomer = parseBool(req.body.isVerifiedCustomer, true);
    }

    if (req.body?.type !== undefined) {
      const nextType = normalizeString(req.body.type).toLowerCase();
      if (!isValidType(nextType)) {
        return res.status(400).json({ message: "type must be 'supplier' or 'customer'." });
      }
      payload.type = nextType;
    }

    if (payload.email && !EMAIL_RULE.test(payload.email)) {
      return res.status(400).json({ message: 'email must be valid when provided.' });
    }

    if (payload.name !== undefined && !payload.name) {
      return res.status(400).json({ message: 'name cannot be empty.' });
    }

    const nextType = payload.type || existing.type;
    if (nextType !== 'supplier') {
      payload.supplierCapabilities = [];
    }
    if (nextType !== 'customer') {
      payload.customerType = 'regular';
      payload.isVerifiedCustomer = true;
      payload.isVatExempt = false;
    }

    existing.set(payload);
    await existing.save();

    publishPartnersUpdated({
      reason: 'partner.updated',
      partnerId: existing._id,
      partnerType: existing.type,
    });

    return res.json(existing);
  } catch (error) {
    return next(error);
  }
};

const archivePartner = async (req, res, next) => {
  try {
    const { id } = req.params;

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({ message: 'Partner not found.' });
    }

    partner.isArchived = true;
    partner.archivedAt = new Date();
    partner.archivedBy = req.user?._id || null;
    await partner.save();

    publishPartnersUpdated({
      reason: 'partner.archived',
      partnerId: partner._id,
      partnerType: partner.type,
    });

    return res.json({ message: 'Partner archived.', partner });
  } catch (error) {
    return next(error);
  }
};

const restorePartner = async (req, res, next) => {
  try {
    const { id } = req.params;

    const partner = await Partner.findById(id);
    if (!partner) {
      return res.status(404).json({ message: 'Partner not found.' });
    }

    partner.isArchived = false;
    partner.archivedAt = null;
    partner.archivedBy = null;
    await partner.save();

    publishPartnersUpdated({
      reason: 'partner.restored',
      partnerId: partner._id,
      partnerType: partner.type,
    });

    return res.json({ message: 'Partner restored.', partner });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listPartners,
  createPartner,
  updatePartner,
  archivePartner,
  restorePartner,
};
