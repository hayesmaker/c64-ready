import { beforeEach, describe, expect, it } from 'vitest';
import CheevosTrackerPanel from '../../src/player/cheevos-tracker-panel';

describe('CheevosTrackerPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('style[data-c64-cheevos-tracker]').forEach((el) => el.remove());
    localStorage.clear();
  });

  it('renders enabled cheevos, popped achievements, snapshots, and dynamic fields', () => {
    const panel = new CheevosTrackerPanel();
    panel.init();

    window.dispatchEvent(
      new CustomEvent('c64-cheevos-status', {
        detail: {
          status: 'enabled',
          detectorId: 'uridium',
          cheevosSet: {
            trackerFields: [{ key: 'health', label: 'Health', display: 'bar', max: 100 }],
            cheevos: [
              { _id: 'zinc', title: 'Zinc', description: 'Clear Zinc' },
              { _id: 'lead', title: 'Lead', description: 'Clear Lead' },
            ],
          },
          poppedCheevos: [
            { achievement: { _id: 'zinc', title: 'Zinc', description: 'Clear Zinc' } },
          ],
        },
      }),
    );
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-snapshot', {
        detail: { score: 1200, lives: 2, isGameOver: false, fields: { health: 75 } },
      }),
    );

    const root = document.querySelector('.c64-cheevos-tracker') as HTMLElement;
    expect(root.classList.contains('hidden')).toBe(false);
    expect(root.textContent).toContain('uridium');
    expect(root.textContent).toContain('1200');
    expect(root.textContent).toContain('2');
    expect(root.textContent).toContain('Playing');
    expect(root.textContent).toContain('Health');
    expect(root.textContent).toContain('75');
    expect(root.textContent).toContain('Zinc');
    expect(root.textContent).toContain('Lead');

    window.dispatchEvent(
      new CustomEvent('c64-cheevos-popped', {
        detail: {
          achievement: { _id: 'lead', title: 'Lead', description: 'Clear Lead' },
          poppedCheevos: [
            { achievement: { _id: 'zinc', title: 'Zinc', description: 'Clear Zinc' } },
            { achievement: { _id: 'lead', title: 'Lead', description: 'Clear Lead' } },
          ],
        },
      }),
    );

    expect(root.textContent).toContain('Popped: Lead');
    expect(root.textContent).toContain('2/2');
    panel.destroy();
  });

  it('hides when toggled off or display mode is not standard', () => {
    const panel = new CheevosTrackerPanel();
    panel.init();
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-status', {
        detail: { status: 'enabled', detectorId: 'test', cheevosSet: { cheevos: [] } },
      }),
    );
    const root = document.querySelector('.c64-cheevos-tracker') as HTMLElement;

    expect(root.classList.contains('hidden')).toBe(false);
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-tracker-toggle', { detail: { visible: false } }),
    );
    expect(root.classList.contains('hidden')).toBe(true);
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-tracker-toggle', { detail: { visible: true } }),
    );
    window.dispatchEvent(new CustomEvent('c64-display-mode-changed', { detail: { mode: 'full' } }));
    expect(root.classList.contains('hidden')).toBe(true);
    window.dispatchEvent(
      new CustomEvent('c64-display-mode-changed', { detail: { mode: 'standard' } }),
    );
    expect(root.classList.contains('hidden')).toBe(false);

    panel.destroy();
  });

  it('limits achievement lists to six items and can show all in columns', () => {
    const panel = new CheevosTrackerPanel();
    panel.init();
    const cheevos = Array.from({ length: 10 }, (_, index) => ({
      _id: `cheevo-${index + 1}`,
      title: `Cheevo ${index + 1}`,
      description: `Description ${index + 1}`,
    }));

    window.dispatchEvent(
      new CustomEvent('c64-cheevos-status', {
        detail: {
          status: 'enabled',
          detectorId: 'test',
          cheevosSet: { cheevos },
          poppedCheevos: [],
        },
      }),
    );

    const root = document.querySelector('.c64-cheevos-tracker') as HTMLElement;
    const remainingList = root.querySelector('.c64-cheevos-list') as HTMLElement;
    expect(remainingList.children).toHaveLength(6);
    expect(remainingList.classList.contains('cols-2')).toBe(true);
    expect(root.textContent).toContain('Show all 10');
    expect(root.textContent).not.toContain('Cheevo 10');

    (root.querySelector('[data-cheevos-list-toggle="remaining"]') as HTMLButtonElement).click();

    const expandedList = root.querySelector('.c64-cheevos-list') as HTMLElement;
    expect(expandedList.children).toHaveLength(10);
    expect(expandedList.classList.contains('cols-3')).toBe(true);
    expect(root.textContent).toContain('Cheevo 10');
    expect(root.textContent).toContain('Show less');

    (root.querySelector('[data-cheevos-list-toggle="remaining"]') as HTMLButtonElement).click();
    expect((root.querySelector('.c64-cheevos-list') as HTMLElement).children).toHaveLength(6);

    panel.destroy();
  });
});
