import { beforeEach, describe, expect, it, vi } from 'vitest';
import UIController from './ui-controller';

describe('UIController', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.querySelectorAll('style[data-c64-help]').forEach((el) => el.remove());
  });

  it('creates a help button and hidden overlay on init', () => {
    const ui = new UIController();
    ui.init();

    const btn = document.querySelector('.c64-help-btn') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('?');

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('opens the dialog when the help button is clicked', () => {
    const ui = new UIController();
    ui.init();

    const btn = document.querySelector('.c64-help-btn') as HTMLButtonElement;
    btn.click();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('closes the dialog when the close button is clicked', () => {
    const ui = new UIController();
    ui.init();
    ui.open();

    const close = document.querySelector('.c64-help-close') as HTMLButtonElement;
    close.click();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('closes the dialog when clicking the overlay backdrop', () => {
    const ui = new UIController();
    ui.init();
    ui.open();

    const overlay = document.querySelector('.c64-help-overlay') as HTMLElement;
    overlay.click();

    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('displays the key controls', () => {
    const ui = new UIController();
    ui.init();

    const items = document.querySelectorAll('.c64-help-controls li');
    expect(items.length).toBe(5);

    const keys = Array.from(document.querySelectorAll('.c64-help-key')).map((el) => el.textContent);
    expect(keys).toEqual(['↑', '↓', '←', '→', 'Left Ctrl']);
  });

  it('contains a link to the GitHub repo', () => {
    const ui = new UIController();
    ui.init();

    const link = document.querySelector('.c64-help-dialog a') as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/hayesmaker/c64-ready');
    expect(link.target).toBe('_blank');
  });

  it('injects CSS style tag only once', () => {
    const ui1 = new UIController();
    ui1.init();
    const ui2 = new UIController();
    ui2.init();

    const styles = document.querySelectorAll('style[data-c64-help]');
    expect(styles.length).toBe(1);
  });
});
