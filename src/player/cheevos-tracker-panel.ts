import type { CheevosDevAchievement, CheevosDevSet, CheevosDevTrackerField } from './cheevos-dev';

export const CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY = 'c64-cheevos-tracker-visible';

type PoppedCheevo = { achievement: CheevosDevAchievement };

type TrackerState = {
  detectorId: string;
  enabled: boolean;
  visiblePreference: boolean;
  displayMode: string;
  cheevosSet: CheevosDevSet;
  popped: CheevosDevAchievement[];
  score?: string | number | boolean;
  lives?: string | number | boolean;
  isGameOver?: boolean;
  fields: Record<string, string | number | boolean | undefined>;
  lastMessage: string;
  expandedLists: Record<string, boolean>;
};

const COLLAPSED_ACHIEVEMENT_LIMIT = 6;

const css = `
.c64-cheevos-tracker{position:fixed;inset-block-start:50%;inset-inline-start:calc(50% + 410px);transform:translateY(-50%);box-sizing:border-box;inline-size:min(520px,calc(50vw - 430px));max-block-size:calc(100dvh - 48px);overflow:auto;scrollbar-gutter:stable;background:#101623;border:2px solid #333e5f;border-radius:8px;color:#d8def6;font-family:monospace;font-size:13px;padding:14px;z-index:900;box-shadow:0 12px 36px rgba(0,0,0,.35)}.c64-cheevos-tracker.hidden{display:none}.c64-cheevos-tracker h2{margin:0 0 4px;color:#8da2ff;font-size:15px;letter-spacing:.08em;text-transform:uppercase}.c64-cheevos-tracker-subtitle{color:#8790aa;font-size:12px;margin:0 0 10px}.c64-cheevos-tracker-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0 0 10px}.c64-cheevos-stat{background:#151d2e;border:1px solid #26314c;border-radius:5px;padding:7px}.c64-cheevos-stat-label{display:block;color:#8995b5;font-size:11px;text-transform:uppercase}.c64-cheevos-stat-value{display:block;color:#fff;font-size:16px;margin-block-start:2px;overflow:hidden;text-overflow:ellipsis}.c64-cheevos-field-list{display:grid;gap:7px;margin:0 0 10px}.c64-cheevos-field{background:#151d2e;border:1px solid #26314c;border-radius:5px;padding:7px}.c64-cheevos-field-row{display:flex;justify-content:space-between;gap:8px}.c64-cheevos-bar{block-size:7px;background:#26314c;border-radius:999px;margin-block-start:6px;overflow:hidden}.c64-cheevos-bar-fill{block-size:100%;background:#8da2ff;border-radius:inherit}.c64-cheevos-list-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 6px}.c64-cheevos-list-title{margin:0;color:#8da2ff;font-size:12px;text-transform:uppercase}.c64-cheevos-list-toggle{background:transparent;border:1px solid #38486f;border-radius:4px;color:#b8c4ff;cursor:pointer;font:inherit;font-size:11px;padding:2px 6px}.c64-cheevos-list-toggle:hover{border-color:#8da2ff;color:#fff}.c64-cheevos-list{display:grid;gap:6px;margin:0;padding:0;list-style:none}.c64-cheevos-list.cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.c64-cheevos-list.cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.c64-cheevos-item{background:#151d2e;border:1px solid #26314c;border-radius:5px;padding:6px;min-inline-size:0}.c64-cheevos-item.popped{border-color:#557a36;background:#152416}.c64-cheevos-item-title{display:block;color:#f1f4ff;overflow:hidden;text-overflow:ellipsis}.c64-cheevos-item-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-clamp:2;overflow:clip;color:#8790aa;font-size:11px;margin-block-start:2px}.c64-cheevos-empty{color:#8790aa;font-size:12px;margin:0}.c64-cheevos-message{color:#f3c36b;font-size:12px;margin:10px 0 0}@media (max-width:1480px){.c64-cheevos-tracker{inline-size:min(360px,calc(50vw - 430px))}.c64-cheevos-list.cols-3{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:1180px){.c64-cheevos-tracker{display:none}}
`;

export class CheevosTrackerPanel {
  private root: HTMLElement | null = null;
  private state: TrackerState = {
    detectorId: '',
    enabled: false,
    visiblePreference: localStorage.getItem(CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY) !== '0',
    displayMode: 'standard',
    cheevosSet: { cheevos: [], trackerFields: [] },
    popped: [],
    fields: {},
    lastMessage: '',
    expandedLists: {},
  };

  init(): void {
    this.injectCSS();
    this.root = document.createElement('aside');
    this.root.className = 'c64-cheevos-tracker hidden';
    this.root.setAttribute('aria-label', 'Cheevos tracker');
    document.body.appendChild(this.root);
    this.render();

    window.addEventListener('c64-cheevos-status', this.handleStatus as EventListener);
    window.addEventListener('c64-cheevos-event', this.handleCheevosEvent as EventListener);
    window.addEventListener('c64-cheevos-score', this.handleScore as EventListener);
    window.addEventListener('c64-cheevos-popped', this.handlePopped as EventListener);
    window.addEventListener('c64-cheevos-snapshot', this.handleSnapshot as EventListener);
    window.addEventListener('c64-cheevos-error', this.handleError as EventListener);
    window.addEventListener('c64-cheevos-tracker-toggle', this.handleToggle as EventListener);
    window.addEventListener('c64-display-mode-changed', this.handleDisplayMode as EventListener);
    this.root.addEventListener('click', this.handleClick);
  }

  destroy(): void {
    window.removeEventListener('c64-cheevos-status', this.handleStatus as EventListener);
    window.removeEventListener('c64-cheevos-event', this.handleCheevosEvent as EventListener);
    window.removeEventListener('c64-cheevos-score', this.handleScore as EventListener);
    window.removeEventListener('c64-cheevos-popped', this.handlePopped as EventListener);
    window.removeEventListener('c64-cheevos-snapshot', this.handleSnapshot as EventListener);
    window.removeEventListener('c64-cheevos-error', this.handleError as EventListener);
    window.removeEventListener('c64-cheevos-tracker-toggle', this.handleToggle as EventListener);
    window.removeEventListener('c64-display-mode-changed', this.handleDisplayMode as EventListener);
    this.root?.removeEventListener('click', this.handleClick);
    this.root?.remove();
    this.root = null;
  }

  private readonly handleStatus = (event: CustomEvent): void => {
    const detail = event.detail as {
      detectorId?: string;
      status?: string;
      cheevosSet?: CheevosDevSet;
      poppedCheevos?: PoppedCheevo[];
    };
    if (detail.status === 'enabled') {
      this.state.enabled = true;
      this.state.detectorId = detail.detectorId ?? '';
      this.state.cheevosSet = detail.cheevosSet ?? { cheevos: [], trackerFields: [] };
      this.state.popped = normalisePopped(detail.poppedCheevos ?? []);
      this.state.isGameOver = undefined;
      this.state.lastMessage = '';
      this.state.expandedLists = {};
      this.render();
      return;
    }
    if (detail.status === 'popped-cleared') {
      this.state.popped = [];
      this.render();
    }
  };

  private readonly handleCheevosEvent = (event: CustomEvent): void => {
    const detail = event.detail as { type?: string; payload?: Record<string, unknown> };
    if (detail.type === 'newGame') {
      this.state.isGameOver = false;
      this.state.lastMessage = 'New game started';
    } else if (detail.type === 'gameOver') {
      this.state.isGameOver = true;
      this.state.score = normaliseValue(detail.payload?.score) ?? this.state.score;
      this.state.lastMessage = 'Game over';
    } else if (detail.type === 'livesChange') {
      this.state.lives = normaliseValue(detail.payload?.lives) ?? this.state.lives;
    } else if (detail.type === 'cheevo') {
      this.state.lastMessage = String(detail.payload?.title ?? 'Achievement unlocked');
    }
    this.render();
  };

  private readonly handleScore = (event: CustomEvent): void => {
    const detail = event.detail as { score?: { score?: number } };
    this.state.score = detail.score?.score ?? this.state.score;
    this.render();
  };

  private readonly handlePopped = (event: CustomEvent): void => {
    const detail = event.detail as {
      achievement?: CheevosDevAchievement;
      poppedCheevos?: PoppedCheevo[];
    };
    if (detail.poppedCheevos) this.state.popped = normalisePopped(detail.poppedCheevos);
    else if (
      detail.achievement &&
      !this.state.popped.some((item) => item._id === detail.achievement?._id)
    ) {
      this.state.popped = [...this.state.popped, detail.achievement];
    }
    if (detail.achievement) this.state.lastMessage = `Popped: ${detail.achievement.title}`;
    this.render();
  };

  private readonly handleSnapshot = (event: CustomEvent): void => {
    const detail = event.detail as {
      score?: string | number | boolean;
      lives?: string | number | boolean;
      isGameOver?: boolean;
      fields?: Record<string, string | number | boolean | undefined>;
    };
    if (detail.score !== undefined) this.state.score = detail.score;
    if (detail.lives !== undefined) this.state.lives = detail.lives;
    if (detail.isGameOver !== undefined) this.state.isGameOver = detail.isGameOver;
    if (detail.fields) this.state.fields = detail.fields;
    this.render();
  };

  private readonly handleError = (event: CustomEvent): void => {
    const detail = event.detail as { error?: string };
    this.state.lastMessage = `Error: ${detail.error ?? 'Unknown error'}`;
    this.render();
  };

  private readonly handleToggle = (event: CustomEvent): void => {
    const detail = event.detail as { visible?: boolean };
    this.state.visiblePreference = detail.visible !== false;
    localStorage.setItem(
      CHEEVOS_TRACKER_VISIBLE_STORAGE_KEY,
      this.state.visiblePreference ? '1' : '0',
    );
    this.render();
  };

  private readonly handleDisplayMode = (event: CustomEvent): void => {
    const detail = event.detail as { mode?: string };
    this.state.displayMode = detail.mode ?? 'standard';
    this.render();
  };

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('[data-cheevos-list-toggle]');
    if (!button) return;
    const listKey = button.dataset.cheevosListToggle;
    if (!listKey) return;
    this.state.expandedLists = {
      ...this.state.expandedLists,
      [listKey]: !this.state.expandedLists[listKey],
    };
    this.render();
  };

  private render(): void {
    if (!this.root) return;
    this.root.classList.toggle(
      'hidden',
      !this.state.enabled || !this.state.visiblePreference || this.state.displayMode !== 'standard',
    );

    const cheevos = this.state.cheevosSet.cheevos ?? [];
    const poppedIds = new Set(this.state.popped.map((achievement) => achievement._id));
    const remaining = cheevos.filter((achievement) => !poppedIds.has(achievement._id));

    this.root.innerHTML = `
      <h2>Cheevos</h2>
      <p class="c64-cheevos-tracker-subtitle">${escapeHtml(this.state.detectorId || 'No detector')}</p>
      <div class="c64-cheevos-tracker-grid">
        ${renderStat('Score', this.state.score ?? '-')}
        ${renderStat('Lives', this.state.lives ?? '-')}
        ${renderStat('Status', this.state.isGameOver ? 'Game Over' : this.state.isGameOver === false ? 'Playing' : 'Waiting')}
        ${renderStat('Popped', `${this.state.popped.length}/${cheevos.length}`)}
      </div>
      ${this.renderFields()}
      ${renderList('popped', 'Popped', this.state.popped, true, !!this.state.expandedLists.popped)}
      ${renderList('remaining', 'Remaining', remaining, false, !!this.state.expandedLists.remaining)}
      ${this.state.lastMessage ? `<p class="c64-cheevos-message">${escapeHtml(this.state.lastMessage)}</p>` : ''}
    `;
  }

  private renderFields(): string {
    const fields = this.state.cheevosSet.trackerFields ?? [];
    if (fields.length === 0) return '';
    return `<div class="c64-cheevos-field-list">${fields
      .map((field) => renderField(field, this.state.fields[field.key]))
      .join('')}</div>`;
  }

  private injectCSS(): void {
    if (document.querySelector('style[data-c64-cheevos-tracker]')) return;
    const style = document.createElement('style');
    style.setAttribute('data-c64-cheevos-tracker', '');
    style.textContent = css;
    document.head.appendChild(style);
  }
}

function renderStat(label: string, value: string | number | boolean): string {
  return `<div class="c64-cheevos-stat"><span class="c64-cheevos-stat-label">${escapeHtml(label)}</span><span class="c64-cheevos-stat-value">${escapeHtml(String(value))}</span></div>`;
}

function renderField(
  field: CheevosDevTrackerField,
  value: string | number | boolean | undefined,
): string {
  const label = field.label ?? field.key;
  const displayValue = value ?? '-';
  const bar =
    field.display === 'bar' &&
    typeof value === 'number' &&
    typeof field.max === 'number' &&
    field.max > 0
      ? `<div class="c64-cheevos-bar"><div class="c64-cheevos-bar-fill" style="inline-size:${Math.max(0, Math.min(100, (value / field.max) * 100))}%"></div></div>`
      : '';
  return `<div class="c64-cheevos-field"><div class="c64-cheevos-field-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(displayValue))}</strong></div>${bar}</div>`;
}

function renderList(
  key: string,
  title: string,
  achievements: CheevosDevAchievement[],
  popped: boolean,
  expanded: boolean,
): string {
  const hasMore = achievements.length > COLLAPSED_ACHIEVEMENT_LIMIT;
  const visibleAchievements = expanded
    ? achievements
    : achievements.slice(0, COLLAPSED_ACHIEVEMENT_LIMIT);
  const columnClass = getColumnClass(visibleAchievements.length);
  const items = visibleAchievements
    .map(
      (achievement) =>
        `<li class="c64-cheevos-item${popped ? ' popped' : ''}"><span class="c64-cheevos-item-title">${escapeHtml(achievement.title)}</span>${
          achievement.description
            ? `<span class="c64-cheevos-item-description" title="${achievement.description}">${escapeHtml(achievement.description)}</span>`
            : ''
        }</li>`,
    )
    .join('');
  const toggle = hasMore
    ? `<button class="c64-cheevos-list-toggle" type="button" data-cheevos-list-toggle="${escapeHtml(key)}">${expanded ? 'Show less' : `Show all ${achievements.length}`}</button>`
    : '';
  return `<div class="c64-cheevos-list-header"><h3 class="c64-cheevos-list-title">${escapeHtml(title)}</h3>${toggle}</div>${
    items
      ? `<ul class="c64-cheevos-list ${columnClass}">${items}</ul>`
      : '<p class="c64-cheevos-empty">None</p>'
  }`;
}

function getColumnClass(count: number): string {
  if (count >= 9) return 'cols-3';
  if (count >= 4) return 'cols-2';
  return 'cols-1';
}

function normalisePopped(popped: PoppedCheevo[]): CheevosDevAchievement[] {
  return popped.map((item) => item.achievement).filter(Boolean);
}

function normaliseValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default CheevosTrackerPanel;
