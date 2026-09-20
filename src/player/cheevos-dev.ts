import type { C64Player } from './c64-player';

const STORAGE_PREFIX = 'c64-cheevos-dev';

export type CheevosDevAchievement = {
  _id: string;
  title: string;
  description?: string;
};

export type CheevosDevSet = {
  _id?: string;
  cheevos?: CheevosDevAchievement[];
};

export type CheevosDevScore = {
  gameId: string;
  score: number;
  userId: string;
  username: string;
  variant?: string;
  at: string;
};

export type CheevosDevState = {
  enabled: boolean;
  detectorId: string;
  cheevosSet: CheevosDevSet;
};

type CheevosInstance = {
  execute?: () => void;
  cpuReadNS?: (addr: number) => number;
  cpuRead?: (addr: number) => number;
  ramRead?: (addr: number) => number;
  watcher?: {
    on?: (name: string, callback: (payload: unknown) => void) => void;
  };
};

type CheevosEventPayload = {
  detectorId: string;
  type: string;
  payload?: unknown;
};

export class CheevosDevController {
  private player: C64Player | null;
  private enabled = false;
  private detectorId = '';
  private cheevosSet: CheevosDevSet = { cheevos: [] };
  private instance: CheevosInstance | null = null;
  private rafId = 0;

  constructor(player: C64Player) {
    this.player = player;
  }

  getState(): CheevosDevState {
    return {
      enabled: this.enabled,
      detectorId: this.detectorId,
      cheevosSet: this.cheevosSet,
    };
  }

  async enable(detectorId: string, cheevosSet: CheevosDevSet = { cheevos: [] }): Promise<void> {
    const normalisedDetectorId = detectorId.trim().toLowerCase();
    if (!normalisedDetectorId) throw new Error('Cheevos detector ID is required');

    this.disable();
    this.detectorId = normalisedDetectorId;
    this.cheevosSet = normaliseCheevosSet(cheevosSet, normalisedDetectorId);

    const { createCheevos } = await import('c64-cheevos');
    const poppedCheevos = this.getPoppedCheevos(normalisedDetectorId);
    const cheevos = (await createCheevos(normalisedDetectorId, {
      gameId: normalisedDetectorId,
      user: { id: 'dev-user', username: 'Developer' },
      cheevosSet: this.cheevosSet,
      poppedCheevos,
      postScore: this.postScore,
      popCheevo: this.popCheevo,
    })) as CheevosInstance;

    cheevos.cpuReadNS = (addr) => this.player?.cpuReadNS(addr) ?? 0;
    cheevos.cpuRead = (addr) => this.player?.cpuRead(addr) ?? 0;
    cheevos.ramRead = (addr) => this.player?.ramRead(addr) ?? 0;

    this.attachWatcher(cheevos);
    this.instance = cheevos;
    this.enabled = true;
    this.dispatchStatus('enabled', { cheevosCount: this.cheevosSet.cheevos?.length ?? 0 });
    this.tick();
  }

  async enableFromJson(detectorId: string, rawJson: string): Promise<void> {
    await this.enable(detectorId, parseCheevosSetJson(rawJson));
  }

  disable(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.enabled = false;
    this.instance = null;
  }

  destroy(): void {
    this.disable();
    this.player = null;
  }

  clearPopped(detectorId: string = this.detectorId): void {
    const id = detectorId.trim().toLowerCase();
    if (!id) return;
    localStorage.removeItem(getPoppedStorageKey(id));
    this.dispatchStatus('popped-cleared');
  }

  clearScores(detectorId: string = this.detectorId): void {
    const id = detectorId.trim().toLowerCase();
    if (!id) return;
    localStorage.removeItem(getScoresStorageKey(id));
    this.dispatchStatus('scores-cleared');
  }

  private tick = (): void => {
    if (!this.enabled) return;
    try {
      this.instance?.execute?.();
    } catch (err) {
      this.disable();
      window.dispatchEvent(
        new CustomEvent('c64-cheevos-error', {
          detail: { detectorId: this.detectorId, error: normaliseError(err) },
        }),
      );
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private readonly postScore = async (
    gameId: string,
    score: number,
    userId: string,
    username: string,
    variant?: string,
  ): Promise<{ ok: true }> => {
    const entry: CheevosDevScore = {
      gameId,
      score,
      userId,
      username,
      variant,
      at: new Date().toISOString(),
    };
    const scores = readJson<CheevosDevScore[]>(getScoresStorageKey(this.detectorId), []);
    scores.push(entry);
    localStorage.setItem(getScoresStorageKey(this.detectorId), JSON.stringify(scores));
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-score', {
        detail: { detectorId: this.detectorId, score: entry },
      }),
    );
    return { ok: true };
  };

  private readonly popCheevo = async (
    _cheevosSetId: string,
    _userId: string,
    cheevoId: string,
  ): Promise<{ achievement: CheevosDevAchievement }> => {
    const achievement = this.findAchievement(cheevoId) ?? {
      _id: cheevoId,
      title: cheevoId,
      description: 'Unlocked in c64-ready dev mode',
    };
    const popped = this.getPoppedCheevos(this.detectorId);
    if (!popped.some((item) => item.achievement._id === cheevoId)) {
      popped.push({ achievement });
      localStorage.setItem(getPoppedStorageKey(this.detectorId), JSON.stringify(popped));
    }
    return { achievement };
  };

  private attachWatcher(cheevos: CheevosInstance): void {
    const watcher = cheevos.watcher;
    if (typeof watcher?.on !== 'function') return;
    for (const type of ['cheevo', 'gameOver', 'livesChange', 'newGame']) {
      watcher.on(type, (payload) => {
        const detail: CheevosEventPayload = { detectorId: this.detectorId, type, payload };
        window.dispatchEvent(new CustomEvent('c64-cheevos-event', { detail }));
      });
    }
  }

  private findAchievement(cheevoId: string): CheevosDevAchievement | undefined {
    return this.cheevosSet.cheevos?.find((achievement) => achievement._id === cheevoId);
  }

  private getPoppedCheevos(detectorId: string): Array<{ achievement: CheevosDevAchievement }> {
    return readJson<Array<{ achievement: CheevosDevAchievement }>>(
      getPoppedStorageKey(detectorId),
      [],
    );
  }

  private dispatchStatus(status: string, extra: Record<string, unknown> = {}): void {
    window.dispatchEvent(
      new CustomEvent('c64-cheevos-status', {
        detail: { detectorId: this.detectorId, status, ...extra },
      }),
    );
  }
}

export function parseCheevosSetJson(rawJson: string): CheevosDevSet {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Cheevos JSON must be an object');
  }
  return normaliseCheevosSet(parsed as CheevosDevSet);
}

function normaliseCheevosSet(set: CheevosDevSet, detectorId = 'dev'): CheevosDevSet {
  const cheevos = Array.isArray(set.cheevos) ? set.cheevos : [];
  return {
    _id: set._id ?? `${detectorId}-dev-set`,
    cheevos: cheevos.map((achievement, index) => ({
      _id: String(achievement._id ?? `dev-${index + 1}`),
      title: String(achievement.title ?? achievement._id ?? `Achievement ${index + 1}`),
      description: achievement.description ? String(achievement.description) : '',
    })),
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function getScoresStorageKey(detectorId: string): string {
  return `${STORAGE_PREFIX}:${detectorId}:scores`;
}

function getPoppedStorageKey(detectorId: string): string {
  return `${STORAGE_PREFIX}:${detectorId}:popped`;
}

function normaliseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default CheevosDevController;
