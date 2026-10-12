export const orders = Array.from({ length: 30 }, (_, o) => ({ id: `ORD-${1000 + o}`, customer: `Customer ${o + 1}`,
  lines: Array.from({ length: 5 }, (_, l) => ({ sku: `SKU-${o}-${l}`, qty: ((o + l) * 7) % 9 + 1, price: (((o * 5 + l) * 37) % 500) / 10 + 5 })) }));
