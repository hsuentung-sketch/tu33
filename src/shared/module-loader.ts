import { Router, type Express } from 'express';
import { logger } from './logger.js';
import { eventBus, type ERPEvent, type ERPEventMap } from './event-bus.js';

// ─── Module interface ────────────────────────────────────────────────

export interface ModulePermission {
  /** Machine-readable key, e.g. "sales:quotation:create" */
  key: string;
  /** Human-readable label shown in permission management UI */
  label: string;
  /** Grouping category, e.g. "Sales", "Purchase" */
  group: string;
}

export interface LineCommand {
  /** The command keyword users type after "/" */
  command: string;
  /** Short description shown in command list */
  description: string;
  /** Handler receives the raw text after the command and a tenant context */
  handler: (args: string, context: { tenantId: string; userId: string }) => Promise<string>;
}

export interface ModuleEventRegistration {
  listen: Array<{
    event: ERPEvent;
    handler: (payload: ERPEventMap[ERPEvent]) => void | Promise<void>;
  }>;
  emit: ERPEvent[];
}

export interface Module {
  /** Unique module identifier, e.g. "sales", "purchase", "accounting" */
  name: string;

  /** Other module names this module depends on */
  dependencies: string[];

  /** Express router with all module routes (mounted under /api/<name>) */
  routes: Router;

  /** LINE bot slash-commands contributed by this module */
  lineCommands: LineCommand[];

  /** Permissions this module defines */
  permissions: ModulePermission[];

  /** Domain events this module listens to and emits */
  events: ModuleEventRegistration;

  /** Optional lifecycle hook called after all modules are loaded */
  onReady?: () => void | Promise<void>;
}

// ─── Tenant module configuration ─────────────────────────────────────

interface TenantModuleConfig {
  /** Module names that are enabled for this tenant */
  enabledModules: Set<string>;
}

// ─── Module loader ───────────────────────────────────────────────────

export class ModuleLoader {
  private modules = new Map<string, Module>();
  private tenantConfigs = new Map<string, TenantModuleConfig>();
  private eventCleanups: Array<() => void> = [];

  /**
   * Register a module. Does NOT mount routes or wire events yet —
   * call `initialize()` after all modules have been registered.
   */
  register(mod: Module): void {
    if (this.modules.has(mod.name)) {
      throw new Error(`Module "${mod.name}" is already registered`);
    }
    this.modules.set(mod.name, mod);
    logger.info(`Module registered: ${mod.name}`);
  }

  /**
   * Validate dependency graph, mount routes on the Express app,
   * wire event listeners, and invoke each module's `onReady` hook.
   */
  async initialize(app: Express): Promise<void> {
    this.validateDependencies();
    const sorted = this.topologicalSort();

    for (const mod of sorted) {
      // Mount routes
      const prefix = `/api/${mod.name}`;
      app.use(prefix, mod.routes);
      logger.info(`Routes mounted: ${prefix}`);

      // Wire event listeners
      for (const { event, handler } of mod.events.listen) {
        const cleanup = eventBus.on(event, handler as (payload: ERPEventMap[typeof event]) => void | Promise<void>);
        this.eventCleanups.push(cleanup);
      }
    }

    // Lifecycle hooks (in dependency order)
    for (const mod of sorted) {
      if (mod.onReady) {
        await mod.onReady();
        logger.info(`Module ready: ${mod.name}`);
      }
    }

    logger.info(`All modules initialized (${sorted.length} total)`);
  }

  // ── Tenant enablement ────────────────────────────────────────────

  /**
   * Enable a set of modules for a tenant. Only enabled modules' routes
   * and LINE commands will respond for that tenant.
   */
  setTenantModules(tenantId: string, moduleNames: string[]): void {
    for (const name of moduleNames) {
      if (!this.modules.has(name)) {
        throw new Error(`Cannot enable unknown module "${name}" for tenant ${tenantId}`);
      }
    }
    this.tenantConfigs.set(tenantId, { enabledModules: new Set(moduleNames) });
    logger.info(`Tenant ${tenantId}: enabled modules [${moduleNames.join(', ')}]`);
  }

  /**
   * Check whether a module is enabled for a given tenant.
   * If no tenant config exists the module is treated as enabled (default-allow).
   */
  isModuleEnabled(tenantId: string, moduleName: string): boolean {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return true; // no config = all modules enabled
    return config.enabledModules.has(moduleName);
  }

  /**
   * Return the list of enabled module names for a tenant.
   */
  getEnabledModules(tenantId: string): string[] {
    const config = this.tenantConfigs.get(tenantId);
    if (!config) return [...this.modules.keys()];
    return [...config.enabledModules];
  }

  // ── Queries ──────────────────────────────────────────────────────

  getModule(name: string): Module | undefined {
    return this.modules.get(name);
  }

  getAllModules(): Module[] {
    return [...this.modules.values()];
  }

  /**
   * Collect LINE commands from all modules enabled for a tenant.
   */
  getLineCommands(tenantId: string): LineCommand[] {
    return this.getAllModules()
      .filter((m) => this.isModuleEnabled(tenantId, m.name))
      .flatMap((m) => m.lineCommands);
  }

  /**
   * Collect permissions from all modules enabled for a tenant.
   */
  getPermissions(tenantId: string): ModulePermission[] {
    return this.getAllModules()
      .filter((m) => this.isModuleEnabled(tenantId, m.name))
      .flatMap((m) => m.permissions);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  /**
   * Unsubscribe all event listeners wired during `initialize()`.
   * Useful in tests or graceful shutdown.
   */
  dispose(): void {
    for (const cleanup of this.eventCleanups) {
      cleanup();
    }
    this.eventCleanups = [];
    logger.info('Module loader disposed – all event listeners removed');
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private validateDependencies(): void {
    for (const [name, mod] of this.modules) {
      for (const dep of mod.dependencies) {
        if (!this.modules.has(dep)) {
          throw new Error(
            `Module "${name}" depends on "${dep}", which is not registered`,
          );
        }
      }
    }
  }

  /**
   * Kahn's algorithm — returns modules in safe initialization order.
   * Throws on circular dependencies.
   */
  private topologicalSort(): Module[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const name of this.modules.keys()) {
      inDegree.set(name, 0);
      adjacency.set(name, []);
    }

    for (const [name, mod] of this.modules) {
      for (const dep of mod.dependencies) {
        adjacency.get(dep)!.push(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: Module[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(this.modules.get(current)!);

      for (const neighbor of adjacency.get(current)!) {
        const newDegree = inDegree.get(neighbor)! - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (sorted.length !== this.modules.size) {
      const remaining = [...this.modules.keys()].filter(
        (n) => !sorted.some((m) => m.name === n),
      );
      throw new Error(
        `Circular dependency detected among modules: ${remaining.join(', ')}`,
      );
    }

    return sorted;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

export const moduleLoader = new ModuleLoader();
