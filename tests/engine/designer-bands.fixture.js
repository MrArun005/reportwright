// The report the designer band tests (#12, #13, #1b, #25, #6, #14) start from: an item in every band, a container.
import { newDesignerStore, activateStore, findItem } from '../../src/designer/store.js';

const tb = (id, x, y, h = 20) => ({ id, type: 'textbox', name: id.toUpperCase(), x, y, w: 100, h, value: 'x' });
const report = () => ({
  $schema: 'reportwright/report@1',
  name: 'R',
  page: { size: 'A4' },
  dataSources: [],
  dataSets: [],
  sections: {
    pageHeader: { height: 40, items: [tb('h1', 0, 4)] },
    body: {
      height: 300,
      items: [
        tb('a', 10, 10),
        tb('b', 10, 40),
        { id: 'box', type: 'container', name: 'Box', x: 0, y: 260, w: 200, h: 30, items: [tb('kid', 0, 4)] },
      ],
    },
    pageFooter: { height: 24, items: [tb('f1', 0, 2)] },
  },
});
let st;
/** The store under test. */
export const S = () => st.getState();
/** A new designer store with the report loaded (call in beforeEach). */
export function load() {
  st = newDesignerStore();
  activateStore(st);
  S().init('r', report());
}
/** Where an item is: its band, its container, its x and y. */
export const where = (id) => {
  const f = findItem(S().def, id);
  return f && { section: f.section, parent: f.parent?.id || null, x: f.item.x, y: f.item.y };
};
