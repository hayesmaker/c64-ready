if (typeof ImageData === 'undefined') {
  class MockImageData {
	data: Uint8ClampedArray;
	width: number;
	height: number;

	constructor(data: Uint8ClampedArray, width: number, height: number) {
	  this.data = data;
	  this.width = width;
	  this.height = height;
	}
  }

  (globalThis as { ImageData?: typeof MockImageData }).ImageData = MockImageData;
}


// Node >= 25 defines its own global `localStorage`/`sessionStorage`, which are
// undefined unless node runs with --localstorage-file. They shadow jsdom's Web
// Storage, so restore jsdom's implementation for the tests.
{
  const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    let storage: Storage | undefined;
    try {
      storage = globalThis[key];
    } catch {
      storage = undefined;
    }
    if (storage || !jsdomWindow) continue;
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => jsdomWindow[key],
    });
  }
}
