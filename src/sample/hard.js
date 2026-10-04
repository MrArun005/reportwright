// @ts-check
/**
 * Deliberately difficult sample data for testing the designer and the engine.
 * Deterministic (seeded), fictional, and full of the things that break reports:
 * nulls and empty strings, very long and very short text, Unicode in six scripts,
 * emoji, RTL text, negative and tiny and huge numbers, mixed date formats, time zones,
 * duplicate keys, deep nesting, arrays of arrays, inconsistent types in one column,
 * a wide table (40 columns), a sparse table, and group sizes from 1 to 400.
 *
 *   GET /api/sample/hard            → everything (about 3,000 rows across the sets)
 *   GET /api/sample/hard?rows=20000 → a bigger "transactions" set for pagination and speed
 */

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];

const NAMES = [
  'Priya Raghavan', 'Arjun Mehta', 'Zoë Müller-Łukasiewicz', 'José Ñoño da Silva', 'Nguyễn Thị Hồng Nhung',
  'முருகன் சுப்பிரமணியன்', 'ಪ್ರಕಾಶ್ ಗೌಡ', 'राधिका शर्मा', 'محمد عبد الرحمن', 'דוד בן-גוריון', '李小龙', '佐藤 花子', '김민준',
  'Ṣọlá Adébáyọ̀', 'O\'Brien-Smyth', 'X Æ A-12', 'A', 'Jean-Baptiste Emmanuel Zorg de la Fontaine-Montmorency the Third, Esq.',
  'Emoji 🎉 Customer 🚀', '   leading spaces', 'trailing spaces   ', '', null, 'NULL', 'undefined', '<script>alert(1)</script>', 'Robert"); DROP TABLE customers;--',
];
const CITIES = ['Bengaluru', 'Mumbai', 'Delhi', 'Chennai', 'Kolkata', 'Hyderabad', 'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Thiruvananthapuram', 'Visakhapatnam', 'Bhubaneswar', 'Guwahati', 'Srinagar', 'Port Blair', 'Kavaratti', 'São Paulo', 'Zürich', 'Reykjavík', 'Ho Chi Minh City', '東京', 'القاهرة', null, ''];
const PRODUCTS = ['Home loan', 'Personal loan', 'Gold loan', 'Two-wheeler loan', 'Loan against property', 'Education loan', 'Micro-finance JLG', 'Credit line', 'BNPL', 'Overdraft'];
const STATUSES = ['Active', 'Closed', 'Overdue', 'Written off', 'Restructured', 'NPA', 'Legal', 'Settled', 'active', 'ACTIVE', ' Active ', null];
const LOREM = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ';
const LONG = LOREM.repeat(40); // ~3,400 chars
const NO_SPACES = 'Supercalifragilisticexpialidocious'.repeat(8); // 272 chars, nowhere to wrap
const MULTILINE = 'Line one\nLine two is longer than line one\n\nLine four after a blank\n\tTabbed line\r\nWindows line ending';

/** @param {number} n */
export function sampleHard(n = 3000) {
  const r = rng(20261004);
  const regions = ['North', 'South', 'East', 'West', 'North-East', 'Islands', 'Overseas', 'Unassigned'];
  // branches: group sizes from 1 to ~400, one branch with no accounts, duplicate names in different regions
  const branches = [];
  let bid = 1;
  for (const region of regions) {
    const count = region === 'Islands' ? 1 : region === 'Unassigned' ? 0 : region === 'Overseas' ? 3 : 4 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      branches.push({ id: `BR-${String(bid++).padStart(3, '0')}`, region, city: pick(r, CITIES), name: i === 0 && region !== 'North' ? 'Main Branch' : `${pick(r, CITIES) || 'Branch'} ${i + 1}`, opened: isoDate(1995 + Math.floor(r() * 30), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)), target: Math.round(r() * 5e8), manager: pick(r, NAMES) });
    }
    if (count === 0) branches.push({ id: `BR-${String(bid++).padStart(3, '0')}`, region, city: null, name: 'Ghost branch', opened: null, target: 0, manager: null });
  }

  const accounts = [];
  let aid = 100000;
  const bigBranch = branches.find(b => b.region === 'South')?.id; // one branch with 400 accounts: a group that spans many pages
  for (const b of branches) {
    if (b.name === 'Ghost branch') continue;
    const size = b.region === 'Islands' ? 1 : b.id === bigBranch ? 400 : 5 + Math.floor(r() * 60);
    for (let i = 0; i < size; i++) {
      const principal = r() < 0.02 ? 0 : r() < 0.03 ? 0.01 : r() < 0.05 ? 99999999.99 : Math.round(r() * 5e6 * 100) / 100;
      const rate = r() < 0.05 ? null : Math.round((6 + r() * 30) * 100) / 100;
      const months = pick(r, [1, 3, 6, 12, 24, 36, 60, 120, 240, 300, 360, null]);
      const disbursed = r() < 0.04 ? null : isoDate(2015 + Math.floor(r() * 12), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28));
      const status = pick(r, STATUSES);
      const outstanding = principal * (r() < 0.1 ? -0.0001 : r()); // a few negative balances (refunds)
      accounts.push({
        accountId: `LN-${aid++}`,
        branchId: b.id,
        region: b.region,
        product: pick(r, PRODUCTS),
        customer: pick(r, NAMES),
        city: b.city,
        principal,
        rate,
        months,
        emi: rate && months && principal ? Math.round((principal * (rate / 1200) * (1 + rate / 1200) ** months) / ((1 + rate / 1200) ** months - 1) * 100) / 100 : null,
        disbursed,
        // mixed date representations in ONE column, on purpose
        lastPayment: pick(r, [disbursed, '2026-09-30', '2026-09-30T18:45:00+05:30', '30/09/2026', '09/30/2026', 1759257000000, 'not a date', null, '']),
        status,
        dpd: status === 'Overdue' || status === 'NPA' ? Math.floor(r() * 400) : status === 'Legal' ? 999 : 0,
        outstanding: Math.round(outstanding * 100) / 100,
        score: pick(r, [300, 650, 750, 820, 900, -1, null, '720', 'N/A']), // numbers as strings and sentinels
        tags: pick(r, [[], ['vip'], ['vip', 'legacy'], ['restructured', 'covid-moratorium', 'legal-notice-sent'], null]),
        notes: pick(r, ['', null, 'OK', LONG, NO_SPACES, MULTILINE, 'Customer prefers Hindi: ग्राहक हिंदी पसंद करते हैं', 'RTL note: هذا نص عربي طويل جداً لاختبار الالتفاف من اليمين إلى اليسار', 'Mixed 中文 and English and हिन्दी in one line 🎯']),
        kyc: { verified: r() < 0.8, method: pick(r, ['VKYC', 'CKYC', 'Aadhaar OTP', 'Physical', null]), documents: Math.floor(r() * 5), address: { line1: pick(r, ['12, 4th Cross', 'Flat 7B', '']), pin: pick(r, ['560001', '400001', '110001', null, 'ABCDEF']) } },
        collateral: r() < 0.3 ? [{ type: 'Gold', grams: Math.round(r() * 200), purity: pick(r, [22, 24, 18]) }, { type: 'Property', value: Math.round(r() * 1e7) }] : [],
        flags: { fraud: r() < 0.01, deceased: r() < 0.005, politically_exposed: r() < 0.02 },
      });
    }
  }

  // transactions: large, for pagination and running totals; one account has thousands, most have a few
  const transactions = [];
  const txTypes = ['EMI', 'Prepayment', 'Charge', 'Reversal', 'Interest', 'Penalty', 'Refund', 'Adjustment'];
  for (let i = 0; i < n; i++) {
    const a = r() < 0.3 ? accounts[0] : pick(r, accounts);
    const type = pick(r, txTypes);
    const sign = type === 'Reversal' || type === 'Refund' ? -1 : 1;
    transactions.push({
      id: i + 1,
      accountId: a.accountId,
      region: a.region,
      branchId: a.branchId,
      date: isoDate(2024 + Math.floor(r() * 3), 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)) + (r() < 0.5 ? 'T' + String(Math.floor(r() * 24)).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0') + ':00' + pick(r, ['Z', '+05:30', '-07:00']) : ''),
      type,
      amount: sign * (r() < 0.02 ? 0 : r() < 0.01 ? 123456789.12 : Math.round(r() * 50000 * 100) / 100),
      currency: pick(r, ['INR', 'INR', 'INR', 'INR', 'USD', 'EUR', 'AED', null]),
      channel: pick(r, ['UPI', 'NACH', 'Cash', 'Cheque', 'NEFT', 'Card', 'Branch', '']),
      reference: pick(r, [`UTR${Math.floor(r() * 1e12)}`, '', null, 'DUPLICATE', 'DUPLICATE']),
      ok: pick(r, [true, true, true, false, 'true', 'yes', 1, 0, null]),
    });
  }

  // a wide, sparse table: 40 columns, most cells empty
  const wide = [];
  for (let i = 0; i < 60; i++) {
    const row = { id: i + 1, name: pick(r, NAMES) };
    for (let c = 1; c <= 38; c++) if (r() < 0.25) row[`m${String(c).padStart(2, '0')}`] = Math.round(r() * 1e5) / 100;
    wide.push(row);
  }

  // inconsistent shapes in one array (objects + primitives + nested arrays)
  const messy = [
    { k: 'a', v: 1 }, { k: 'b', v: 'two' }, { k: 'c', v: null }, { k: 'd' }, { k: 'e', v: [1, 2, 3] }, { k: 'f', v: { nested: true } },
    'just a string', 42, null, [['nested', 'array'], [1, 2]], { k: 'g', v: 1e21 }, { k: 'h', v: -0 }, { k: 'i', v: NaN }, { k: 'j', v: 'Infinity' },
  ].map(x => (typeof x === 'object' && x !== null && !Array.isArray(x) && Number.isNaN(x.v) ? { ...x, v: null } : x));

  // exchange rates for Lookup()
  const fx = [{ currency: 'INR', toInr: 1 }, { currency: 'USD', toInr: 83.2 }, { currency: 'EUR', toInr: 90.1 }, { currency: 'AED', toInr: 22.65 }];

  // unicode stress list for a text-heavy table
  const unicode = [
    { script: 'Latin', text: 'The quick brown fox', long: LONG.slice(0, 500) },
    { script: 'Latin-ext', text: 'Zażółć gęślą jaźń · Příliš žluťoučký kůň · Ærøskøbing', long: 'Ñandú, piñata, jalapeño; façade, naïve, coöperate; Straße, Größe.' },
    { script: 'Devanagari', text: 'ऋण विवरण पत्र', long: 'यह एक लंबा हिंदी वाक्य है जो यह जांचने के लिए है कि पाठ सही ढंग से लपेटा जाता है या नहीं।' },
    { script: 'Kannada', text: 'ಸಾಲದ ಹೇಳಿಕೆ', long: 'ಇದು ಪಠ್ಯವು ಸರಿಯಾಗಿ ಸುತ್ತುತ್ತದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಲು ಒಂದು ದೀರ್ಘ ಕನ್ನಡ ವಾಕ್ಯ.' },
    { script: 'Tamil', text: 'கடன் அறிக்கை', long: 'இது உரை சரியாக மடிக்கப்படுகிறதா என்பதைச் சரிபார்க்க ஒரு நீண்ட தமிழ் வாக்கியம்.' },
    { script: 'Arabic (RTL)', text: 'كشف حساب القرض', long: 'هذا نص عربي طويل لاختبار التفاف النص من اليمين إلى اليسار في التقرير.' },
    { script: 'Hebrew (RTL)', text: 'דוח הלוואה', long: 'זהו משפט עברי ארוך כדי לבדוק גלישת טקסט מימין לשמאל.' },
    { script: 'CJK', text: '贷款对账单 · ローン明細 · 대출 명세서', long: '这是一个很长的中文句子，用于测试没有空格的文本如何换行。日本語の長い文章も同様にテストします。' },
    { script: 'Emoji', text: '🏦 💰 📈 ✅ ❌ ⚠️ 🇮🇳', long: 'Family 👨‍👩‍👧‍👦 · flags 🇮🇳🇯🇵 · skin tones 👍🏽 · ZWJ sequences 🧑‍💻' },
    { script: 'Symbols', text: '₹ $ € £ ¥ ₩ ₪ ฿ ∑ ∞ ≠ ≤ ≥ © ® ™', long: 'Math: ∫₀^∞ e^(−x²) dx = √π/2 · Arrows: ← ↑ → ↓ ⇒ · Box: ┌─┬─┐│├┼┤└┴┘' },
    { script: 'Combining', text: 'é (e + ́) vs é (precomposed) · Z̷̡̛a̴l̵g̶o̷', long: 'Combining marks: ạ̴̢̧̛̖̬̞̳̬̮̝͔̈́̓̀̍͒̓̋̅̀̚͠ b̷̨̛̖̞̞̝̮̺̦̈́̐̋̓͘c̶̛͈̬̬͔̬̘̞̞͒̑̍̾̑̕͘̚ · ligatures: ﬁ ﬂ ﬀ ﬃ' },
    { script: 'Edge', text: '', long: NO_SPACES },
  ];

  return {
    meta: { generated: '2026-10-04T00:00:00Z', rows: { branches: branches.length, accounts: accounts.length, transactions: transactions.length, wide: wide.length }, note: 'Fictional data for testing. Nulls, mixed types and bad dates are intentional.' },
    regions: regions.map(name => ({ name, branches: branches.filter(b => b.region === name).length })),
    branches,
    accounts,
    transactions,
    wide,
    messy,
    fx,
    unicode,
    // deep nesting to test JSONPath: $.portfolio.books[*].positions[*]
    portfolio: { books: ['Retail', 'SME', 'Corporate'].map((book, i) => ({ book, positions: PRODUCTS.slice(0, 3 + i).map(p => ({ product: p, exposure: Math.round(r() * 1e9), limit: Math.round(r() * 2e9), utilisation: Math.round(r() * 100) / 100 })) })) },
    empty: [],
    single: [{ only: 'one row' }],
  };
}

export function listHardAccounts() { return sampleHard(100).accounts.slice(0, 50).map(a => ({ id: a.accountId, customer: a.customer, status: a.status })); }

function isoDate(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
