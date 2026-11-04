'use strict';

// Bu dosya yalnizca Draft 2020-12 anahtarlarinin bu aday semada gecen alt kumesini
// uygular. Sema gecerliligi yetki karari degildir.

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);
const SUPPORTED = new Set([
  'type', 'const', 'enum', 'required', 'additionalProperties', 'properties',
  'items', 'minLength', 'maxLength', 'minimum', 'format',
]);

function validateDraft2020(schema, data) {
  const errors = [];
  if (!schema || schema.$schema !== DIALECT) errors.push('$:dialect');
  else checkNode(schema, data, '$', errors);
  return { ok: errors.length === 0, errors, authorization: false };
}

function checkNode(schema, data, path, errors) {
  const unknown = Object.keys(schema).filter((key) => !ANNOTATIONS.has(key) && !SUPPORTED.has(key));
  if (unknown.length) {
    errors.push(`${path}:unsupported`);
    return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && data !== schema.const) {
    errors.push(`${path}:const`);
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${path}:enum`);
  if (schema.type && !typeMatches(schema.type, data)) {
    errors.push(`${path}:type`);
    return;
  }
  if (typeof data === 'string') {
    if (schema.minLength != null && data.length < schema.minLength) errors.push(`${path}:minLength`);
    if (schema.maxLength != null && data.length > schema.maxLength) errors.push(`${path}:maxLength`);
    if (schema.format && schema.format !== 'uuid') errors.push(`${path}:format`);
    if (schema.format === 'uuid' && !UUID.test(data)) errors.push(`${path}:uuid`);
  }
  if (typeof data === 'number' && schema.minimum != null && data < schema.minimum) {
    errors.push(`${path}:minimum`);
  }
  if (isPlainObject(data)) {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) errors.push(`${path}.${key}:required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(`${path}.${key}:additional`);
      }
    }
    for (const key of Object.keys(props)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        checkNode(props[key], data[key], `${path}.${key}`, errors);
      }
    }
  }
  if (Array.isArray(data) && schema.items) {
    for (let i = 0; i < data.length; i += 1) {
      checkNode(schema.items, data[i], `${path}[${i}]`, errors);
    }
  }
}

function typeMatches(type, data) {
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => {
    if (item === 'null') return data === null;
    if (item === 'string') return typeof data === 'string';
    if (item === 'number') return typeof data === 'number' && Number.isFinite(data);
    if (item === 'integer') return typeof data === 'number' && Number.isInteger(data);
    if (item === 'boolean') return typeof data === 'boolean';
    if (item === 'array') return Array.isArray(data);
    if (item === 'object') return isPlainObject(data);
    return false;
  });
}

function isPlainObject(data) {
  return data !== null && typeof data === 'object' && !Array.isArray(data);
}

module.exports = { DIALECT, validateDraft2020 };
