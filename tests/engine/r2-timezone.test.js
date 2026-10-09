// Server renders show dates in the viewer's zone (sent with the request), so a server PDF matches the browser.
import { it, expect } from 'vitest';
import { renderTo, checkTimeZone } from '../../src/server/renderer.js';

const def = (tz) => ({ $schema: 'reportwright/report@1', name: 'TZ', ...(tz && { timeZone: tz }), sections: { body: { items: [{ type: 'textbox', name: 'T', x: 0, y: 0, w: 300, h: 16, value: '=Format(CDate("2026-01-01T23:30:00Z"), "yyyy-MM-dd HH:mm")' }] } } });
const text = (m) => JSON.stringify(m.pages[0]);

it('the viewer\'s zone is used; the report\'s own zone wins; an unknown zone is a 400', async () => {
  const tokyo = (await renderTo(def(), { format: 'json', timeZone: 'Asia/Tokyo' })).model;
  expect(tokyo.timeZone).toBe('Asia/Tokyo');
  expect(text(tokyo)).toContain('2026-01-02 08:30');
  const ny = (await renderTo(def(), { format: 'json', timeZone: 'America/New_York' })).model;
  expect(text(ny)).toContain('2026-01-01 18:30');
  const own = (await renderTo(def('Europe/Paris'), { format: 'json', timeZone: 'Asia/Tokyo' })).model;
  expect(own.timeZone).toBe('Europe/Paris');
  expect(text(own)).toContain('2026-01-02 00:30');
  expect(() => checkTimeZone('Mars/Olympus')).toThrow(/Unknown time zone/);
  expect(() => checkTimeZone({})).toThrow();
  expect(checkTimeZone(undefined)).toBe(undefined);
  await expect(renderTo(def(), { format: 'json', timeZone: 'Nope/Nope' })).rejects.toMatchObject({ status: 400 });
});

it('the viewer sends its zone with server render links', async () => {
  const { withTimeZone, viewerTimeZone } = await import('../../src/viewer/timeZone.js');
  expect(viewerTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(withTimeZone('/api/reports/a/pdf', 'Asia/Kolkata')).toBe('/api/reports/a/pdf?timeZone=Asia%2FKolkata');
  expect(withTimeZone('/api/reports/a/pdf?format=xlsx', 'Europe/Paris')).toBe('/api/reports/a/pdf?format=xlsx&timeZone=Europe%2FParis');
  expect(withTimeZone('/x?timeZone=UTC', 'Europe/Paris')).toBe('/x?timeZone=UTC');
  expect(withTimeZone('/x', '')).toBe('/x');
  expect(checkTimeZone(new URL(withTimeZone('http://h/x', 'America/New_York')).searchParams.get('timeZone'))).toBe('America/New_York');
});
