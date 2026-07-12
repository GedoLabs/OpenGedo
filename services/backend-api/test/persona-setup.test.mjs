import { afterAll, describe, expect, it } from 'vitest';
import { Store } from '../src/lib/store.mjs';

const store = Store();
const userId = `persona-setup-test-${Date.now()}`;

afterAll(() => { store.wipeUser(userId); });

describe('Digital persona explicit setup state', () => {
  it('starts incomplete and completes after the first owner config save', () => {
    const initial = store.getDigitalPersonaByUser(userId);
    expect(initial.setup_completed).toBe(false);

    const configured = store.upsertDigitalPersona(userId, {
      display_name: 'Test Persona',
      tagline: 'A public introduction',
    });
    expect(configured.setup_completed).toBe(true);

    const restored = store.getDigitalPersonaByUser(userId);
    expect(restored.setup_completed).toBe(true);
  });
});
