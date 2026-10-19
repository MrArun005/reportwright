// Designer autosave drafts (src/designer/draft.js): what is kept in the browser, what is left out, expiry, users.
// The draft bar itself only runs in the non-embedded app, so these are unit tests of the pure functions.
import { describe, it, expect } from 'vitest';
import {
  DRAFT_PREFIX,
  DRAFT_TTL,
  userTag,
  draftKey,
  sanitizeDraft,
  mergeDraft,
  writeDraft,
  readDraft,
  clearDraft,
  clearDrafts,
  staleDraft,
} from '../../src/designer/draft.js';

/** A Storage-like map (localStorage's API). */
function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    keys: () => [...m.keys()],
  };
}
const NOW = 1_800_000_000_000;
const def = (more = {}) => ({
  name: 'R',
  page: { size: 'A4' },
  dataSources: [
    { name: 'api', type: 'rest', url: 'https://api.test/rows?token=s3cret', headers: { Authorization: 'Bearer abc' } },
    { name: 'inline', type: 'json', data: { rows: [{ ssn: '123' }] } },
  ],
  dataSets: [{ name: 'Rows', source: 'api', fields: [{ name: 'a' }] }],
  parameters: [
    { name: 'region', type: 'string', default: 'North' },
    { name: 'pin', type: 'string' },
  ],
  sections: {
    body: {
      height: 100,
      items: [{ type: 'image', name: 'Img', src: 'https://cdn.test/a.png?sig=xyz&w=40#top', x: 0, y: 0, w: 10, h: 10 }],
    },
  },
  ...more,
});

describe('userTag / draftKey', () => {
  it('is stable, 8 hex characters, and does not spell out the email', () => {
    expect(userTag('a@b.test')).toMatch(/^[0-9a-f]{8}$/);
    expect(userTag('a@b.test')).toBe(userTag('a@b.test'));
    expect(userTag('a@b.test')).not.toBe(userTag('c@b.test'));
    expect(draftKey('a@b.test', 'r1')).toBe(`${DRAFT_PREFIX}${userTag('a@b.test')}.r1`);
    expect(draftKey('a@b.test', 'r1')).not.toContain('a@b.test');
  });
  it('a missing user is "anonymous"', () => {
    expect(userTag(null)).toBe(userTag('anonymous'));
    expect(userTag(undefined)).toBe(userTag(''));
  });
});

describe('sanitizeDraft', () => {
  it('keeps only the name and type of data sources (no URL, headers or inline data)', () => {
    const d = sanitizeDraft(def());
    expect(d.dataSources).toEqual([
      { name: 'api', type: 'rest' },
      { name: 'inline', type: 'json' },
    ]);
    expect(JSON.stringify(d)).not.toContain('s3cret');
    expect(JSON.stringify(d)).not.toContain('Bearer');
    expect(JSON.stringify(d)).not.toContain('123');
  });
  it('drops parameter defaults and keeps the rest of the parameter', () => {
    expect(sanitizeDraft(def()).parameters).toEqual([
      { name: 'region', type: 'string' },
      { name: 'pin', type: 'string' },
    ]);
  });
  it('blanks credential-like URL query values anywhere in the layout, keeps the others and the hash', () => {
    const img = sanitizeDraft(def()).sections.body.items[0];
    expect(img.src).toBe('https://cdn.test/a.png?sig=&w=40#top');
  });
  it('drops credential-named keys anywhere (headers, password, token, apiKey, secret)', () => {
    const d = sanitizeDraft(def({ extra: { password: 'p', token: 't', apiKey: 'k', secret: 's', keep: 1 } }));
    expect(d.extra).toEqual({ keep: 1 });
  });
  it('does not change the definition it is given', () => {
    const d = def();
    const before = JSON.stringify(d);
    sanitizeDraft(d);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('a missing or empty definition gives an empty draft, not a throw', () => {
    expect(sanitizeDraft(null)).toEqual({ dataSources: [], parameters: [] });
    expect(sanitizeDraft({})).toEqual({ dataSources: [], parameters: [] });
  });
  it('regression: a credential in the query of a hash route (https://x/#/r?token=…) is kept in the draft', () => {
    const d = sanitizeDraft(
      def({
        sections: { body: { items: [{ type: 'image', name: 'I', src: 'https://app.test/#/view?token=s3cret' }] } },
      }),
    );
    expect(JSON.stringify(d)).not.toContain('s3cret');
  });
});

describe('mergeDraft', () => {
  it('takes data sources and parameter defaults from the saved report, by name', () => {
    const saved = def();
    const m = mergeDraft(sanitizeDraft(saved), saved);
    expect(m.dataSources).toEqual(saved.dataSources);
    expect(m.parameters).toEqual([
      { name: 'region', type: 'string', default: 'North' },
      { name: 'pin', type: 'string' },
    ]);
  });
  it('a data source the saved report does not have is left out; a parameter it does not have keeps no default', () => {
    const draft = { dataSources: [{ name: 'gone', type: 'rest' }], parameters: [{ name: 'new', type: 'number' }] };
    const m = mergeDraft(draft, def());
    expect(m.dataSources).toEqual([]);
    expect(m.parameters).toEqual([{ name: 'new', type: 'number' }]);
  });
  it('no saved report: no data sources', () => {
    expect(mergeDraft({ dataSources: [{ name: 'a', type: 'json' }] }, null).dataSources).toEqual([]);
  });
});

describe('writeDraft / readDraft / clearDraft', () => {
  it('writes and reads back a sanitized draft with its time and revision', () => {
    const s = memStore();
    expect(writeDraft(s, 'u@x', 'r1', def(), NOW, 'rev1')).toBe(true);
    const d = readDraft(s, 'u@x', 'r1', NOW + 1000);
    expect(d.at).toBe(NOW);
    expect(d.rev).toBe('rev1');
    expect(d.def).toEqual(sanitizeDraft(def()));
  });
  it('another user does not read it', () => {
    const s = memStore();
    writeDraft(s, 'u@x', 'r1', def(), NOW);
    expect(readDraft(s, 'v@x', 'r1', NOW)).toBe(null);
  });
  it('an expired draft is read as none and removed', () => {
    const s = memStore();
    writeDraft(s, 'u@x', 'r1', def(), NOW);
    expect(readDraft(s, 'u@x', 'r1', NOW + DRAFT_TTL)).toBe(null);
    expect(s.keys()).toEqual([]);
  });
  it('a draft just under the time limit is still read', () => {
    const s = memStore();
    writeDraft(s, 'u@x', 'r1', def(), NOW);
    expect(readDraft(s, 'u@x', 'r1', NOW + DRAFT_TTL - 1)).not.toBe(null);
  });
  it('unreadable, empty or definition-less entries read as none', () => {
    const s = memStore({
      [draftKey('u', 'a')]: '{not json',
      [draftKey('u', 'b')]: '{"at":1}',
      [draftKey('u', 'c')]: '{"at":1,"def":"x"}',
    });
    expect(readDraft(s, 'u', 'a', NOW)).toBe(null);
    expect(readDraft(s, 'u', 'b', NOW)).toBe(null);
    expect(readDraft(s, 'u', 'c', NOW)).toBe(null);
    expect(readDraft(s, 'u', 'none', NOW)).toBe(null);
  });
  it('full or blocked storage: no draft, no throw', () => {
    const full = {
      ...memStore(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeDraft(full, 'u', 'r', def(), NOW)).toBe(false);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readDraft(blocked, 'u', 'r', NOW)).toBe(null);
    expect(() => clearDraft(blocked, 'u', 'r')).not.toThrow();
    expect(() => clearDrafts(blocked)).not.toThrow();
  });
  it('clearDraft removes only that report of that user', () => {
    const s = memStore();
    writeDraft(s, 'u', 'r1', def(), NOW);
    writeDraft(s, 'u', 'r2', def(), NOW);
    writeDraft(s, 'v', 'r1', def(), NOW);
    clearDraft(s, 'u', 'r1');
    expect(s.keys().sort()).toEqual([draftKey('u', 'r2'), draftKey('v', 'r1')].sort());
  });
});

describe('clearDrafts', () => {
  it('sign-out: every draft goes, other keys stay', () => {
    const s = memStore({ other: '1' });
    writeDraft(s, 'u', 'r1', def(), NOW);
    writeDraft(s, 'v', 'r1', def(), NOW);
    clearDrafts(s, null, NOW);
    expect(s.keys()).toEqual(['other']);
  });
  it('another user opens the designer: only their fresh drafts stay', () => {
    const s = memStore();
    writeDraft(s, 'u', 'r1', def(), NOW);
    writeDraft(s, 'u', 'old', def(), NOW - DRAFT_TTL - 1);
    writeDraft(s, 'v', 'r1', def(), NOW);
    s.setItem(`${DRAFT_PREFIX}${userTag('u')}.bad`, '{broken');
    clearDrafts(s, 'u', NOW);
    expect(s.keys()).toEqual([draftKey('u', 'r1')]);
  });
});

describe('staleDraft', () => {
  it('is stale only when both revisions are known and differ', () => {
    expect(staleDraft({ rev: 'a' }, 'b')).toBe(true);
    expect(staleDraft({ rev: 'a' }, 'a')).toBe(false);
    expect(staleDraft({ rev: null }, 'b')).toBe(false);
    expect(staleDraft({ rev: 'a' }, null)).toBe(false);
    expect(staleDraft(null, 'b')).toBe(false);
  });
});
