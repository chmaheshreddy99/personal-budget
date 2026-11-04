/** The mobile web version reads bills with a generated copy of receipt.ts: it has to be the current one. */
const { stale } = require('../scripts/build-web-bill');

it('the web copy of the bill reader is up to date (npm run web:bill)', () => {
  expect(stale()).toEqual([]);
});
