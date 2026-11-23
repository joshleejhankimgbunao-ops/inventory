import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getColorSwatch } from '../../src/utils/colorSwatches.js';

test('known single colors use their mapped shades and preserve the original display value', () => {
  assert.deepEqual(getColorSwatch('Burgundy'), {
    name: 'Burgundy',
    hex: '#800020',
    colors: [{ name: 'burgundy', hex: '#800020' }],
  });
  assert.equal(getColorSwatch('Gray').hex, '#808080');
  assert.equal(getColorSwatch('grey').hex, '#808080');
  assert.equal(getColorSwatch('Blue').hex, '#2563EB');
});

test('combination colors preserve their name and render every supported component color', async () => {
  for (const value of ['Yellow-Green', 'Yellow and Green', 'Yellow/Green', 'Yellow_Green']) {
    const swatch = getColorSwatch(value);
    assert.equal(swatch.name, value);
    assert.deepEqual(swatch.colors, [
      { name: 'yellow', hex: '#EAB308' },
      { name: 'green', hex: '#16A34A' },
    ]);
  }

  const component = await readFile(new URL('../../src/components/ColorSwatch.jsx', import.meta.url), 'utf8');
  assert.match(component, /swatch\.colors\.map\(\(color, index\)/);
  assert.match(component, /style=\{\{ backgroundColor: color\.hex \}\}/);
});

test('unsupported color names use the neutral fallback rather than a partial substring match', () => {
  assert.deepEqual(getColorSwatch('Chartreuse'), {
    name: 'Chartreuse',
    hex: '#94A3B8',
    colors: [{ name: 'chartreuse', hex: '#94A3B8' }],
  });

  const mixed = getColorSwatch('Yellow-Chartreuse');
  assert.deepEqual(mixed.colors, [
    { name: 'yellow', hex: '#EAB308' },
    { name: 'chartreuse', hex: '#94A3B8' },
  ]);
});
