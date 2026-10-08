const capitalizeHumanReadable = (value) => String(value ?? '').replace(
  /(^|[^\p{L}])(\p{L})/gu,
  (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`,
);

const normalizeHumanReadable = (value) => capitalizeHumanReadable(String(value ?? '').trim());

module.exports = {
  capitalizeHumanReadable,
  normalizeHumanReadable,
};
