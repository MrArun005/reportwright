// N17: each Designer owns its store; commands act on the active one, so editing one never touches the other.
import { describe, it, expect } from 'vitest';
import { newDesignerStore, activateStore, useDesigner } from '../../src/designer/store.js';

describe('designer instances', () => {
  it('two stores keep separate state; useDesigner follows the active one', () => {
    const a = newDesignerStore(), b = newDesignerStore();
    a.setState({ saveError: 'a only' });
    expect(b.getState().saveError).not.toBe('a only');
    activateStore(a); expect(useDesigner.getState().saveError).toBe('a only');
    activateStore(b); useDesigner.setState({ saveError: 'b only' });
    expect(a.getState().saveError).toBe('a only');
    expect(b.getState().saveError).toBe('b only');
  });
});
