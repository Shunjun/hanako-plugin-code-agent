/**
 * plugins/code-agent/lib/adapter-registry.js
 *
 * Registry for CLI coding tool adapters. Supports typed queries
 * and default adapter resolution. External adapters register via bus.
 */

export class AdapterRegistry {
  constructor() {
    this._adapters = new Map();
    this._aliasMap = new Map();
  }

  register(adapter) {
    if (!adapter?.id) return;
    this._adapters.set(adapter.id, adapter);
    const aliases = Array.isArray(adapter.aliases) ? adapter.aliases.filter(Boolean) : [];
    for (const alias of aliases) this._aliasMap.set(alias, adapter.id);
  }

  unregister(adapterId) {
    const adapter = this._adapters.get(adapterId);
    if (!adapter) return;
    this._adapters.delete(adapterId);
    // Remove reverse aliases
    for (const [alias, id] of this._aliasMap) {
      if (id === adapterId) this._aliasMap.delete(alias);
    }
  }

  get(adapterId) {
    if (this._adapters.has(adapterId)) return this._adapters.get(adapterId);
    const canonicalId = this._aliasMap.get(adapterId);
    return canonicalId ? this._adapters.get(canonicalId) : null;
  }

  list() {
    const seen = new Set();
    const result = [];
    for (const adapter of this._adapters.values()) {
      if (seen.has(adapter.id)) continue;
      seen.add(adapter.id);
      result.push(adapter);
    }
    return result;
  }

  listIds() {
    return [...new Set(this._adapters.values())].map((a) => a.id);
  }
}
