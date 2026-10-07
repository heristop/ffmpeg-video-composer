import { describe, expect, it } from 'vitest';
import { closeModal, setModalOpen } from './shell-modals.logic';

describe('shell modals: one overlay at a time', () => {
  it('opening an overlay replaces the one that is up', () => {
    expect(setModalOpen('presets', 'ai', true)).toBe('ai');
    expect(setModalOpen('help', 'ai', true)).toBe('ai');
    expect(setModalOpen('ai', 'help', true)).toBe('help');
    expect(setModalOpen(null, 'presets', true)).toBe('presets');
    // A browser agent's confirmation takes over from whatever is up, and help can take over from it.
    expect(setModalOpen('ai', 'agent', true)).toBe('agent');
    expect(setModalOpen('agent', 'help', true)).toBe('help');
  });

  it('closing clears only the overlay it names', () => {
    expect(closeModal('ai', 'ai')).toBeNull();
    expect(setModalOpen('ai', 'ai', false)).toBeNull();
  });

  it('a late close from a replaced overlay leaves its successor open', () => {
    expect(closeModal('ai', 'presets')).toBe('ai');
    expect(setModalOpen('ai', 'help', false)).toBe('ai');
    expect(closeModal(null, 'help')).toBeNull();
  });
});
