// Mock for node:async_hooks
export class AsyncLocalStorage {
  constructor() {
    this.store = null;
  }

  run(store, callback, ...args) {
    this.store = store;
    try {
      return callback(...args);
    } finally {
      this.store = null;
    }
  }

  getStore() {
    return this.store;
  }
}

export default {
  AsyncLocalStorage,
};

