const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const realtimeServicePath = require.resolve('../src/services/realtimeService');
require.cache[realtimeServicePath] = {
  id: realtimeServicePath,
  filename: realtimeServicePath,
  loaded: true,
  exports: { publishPartnersUpdated: () => {} },
};

const Partner = require('../src/models/Partner');
const Setting = require('../src/models/Setting');
const { createPartner } = require('../src/controllers/partnerController');

const createResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('regular customer quotation fields are optional and backward compatible', () => {
  assert.equal(Partner.schema.path('attentionName').options.default, '');
  assert.equal(Partner.schema.path('attentionPosition').options.default, '');
  assert.equal(Partner.schema.path('taxTreatment').options.default, 'standard');
  assert.deepEqual(Partner.schema.path('taxTreatment').options.enum, ['standard', 'vat_zero_rated', 'exempt']);

  const partnersSource = fs.readFileSync(path.resolve(__dirname, '../../src/pages/Partners.jsx'), 'utf8');
  assert.match(partnersSource, /partner\?\.isVatExempt \? 'exempt' : \(partner\?\.taxTreatment \|\| 'standard'\)/);
});

test('customer creation normalizes formal quotation metadata', async () => {
  let createdPayload;
  const response = createResponse();

  await createPartner({
    body: {
      type: 'customer',
      name: '  Citizen Machinery  ',
      attentionName: '  Beverly Ramos ',
      attentionPosition: ' Purchasing Staff ',
      taxTreatment: 'VAT Zero Rated',
    },
  }, response, assert.fail, {
    findByRequestId: async () => null,
    createPartnerRecord: async (payload) => {
      createdPayload = payload;
      return { _id: 'customer-1', ...payload };
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(createdPayload.name, 'Citizen Machinery');
  assert.equal(createdPayload.attentionName, 'Beverly Ramos');
  assert.equal(createdPayload.attentionPosition, 'Purchasing Staff');
  assert.equal(createdPayload.taxTreatment, 'vat_zero_rated');
  assert.equal(createdPayload.isVatExempt, false);
});

test('supplier creation cannot retain customer quotation metadata', async () => {
  let createdPayload;

  await createPartner({
    body: {
      type: 'supplier',
      name: 'Supplier',
      attentionName: 'Not applicable',
      attentionPosition: 'Not applicable',
      taxTreatment: 'exempt',
    },
  }, createResponse(), assert.fail, {
    findByRequestId: async () => null,
    createPartnerRecord: async (payload) => {
      createdPayload = payload;
      return { _id: 'supplier-1', ...payload };
    },
  });

  assert.equal(createdPayload.attentionName, '');
  assert.equal(createdPayload.attentionPosition, '');
  assert.equal(createdPayload.taxTreatment, 'standard');
  assert.equal(createdPayload.isVatExempt, false);
});

test('business settings provide optional formal quotation configuration', () => {
  assert.equal(Setting.schema.path('storeBusinessSubtitle').options.default, '');
  assert.equal(Setting.schema.path('authorizedSignatoryName').options.default, '');
  assert.equal(Setting.schema.path('authorizedSignatoryPosition'), undefined);
});
