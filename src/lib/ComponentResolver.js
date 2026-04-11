/**
 * ComponentResolver — resolves a (component-type, params) pair to a live
 * Playwright locator using accessibility-first strategies.
 *
 * A "component" is a structural UI element (table, form, list, nav, menu,
 * dialog, tab, tree, card). Each component has its own parameter schema; the
 * resolver picks a strategy based on which params are present.
 *
 * Callers should not assume the returned value is a single element — it may
 * be a multi-match locator depending on params. Use `.first()` or actions
 * like `.click()` which accept their own timeouts.
 */

const isIndex = (v) => v != null && v !== "" && /^\d+$/.test(String(v));

const byName = (base, role, name) => {
  return name ? base.getByRole(role, { name }) : base.getByRole(role);
};

const resolveTable = async (base, p) => {
  let table = byName(base, "table", p.name);
  if (!p.row && !p.col && !p.where) return table;

  let row;
  if (isIndex(p.row)) {
    // 1-based over all rows including header. Row 1 = header, row 2 = first data row.
    row = table.getByRole("row").nth(parseInt(p.row) - 1);
  } else if (p.row) {
    row = table.getByRole("row").filter({ hasText: p.row }).first();
  } else if (p.where) {
    const [, value] = String(p.where).split("=", 2);
    row = table.getByRole("row").filter({ hasText: value }).first();
  } else {
    row = table.getByRole("row");
  }

  if (!p.col) return row;

  let colIndex;
  if (isIndex(p.col)) {
    colIndex = parseInt(p.col) - 1;
  } else {
    // Look up column index by header text.
    const headers = await table.getByRole("row").first().getByRole("columnheader").allTextContents();
    const normalized = headers.map(h => h.trim().toLowerCase());
    const idx = normalized.indexOf(String(p.col).trim().toLowerCase());
    if (idx < 0) {
      throw new Error(`Column "${p.col}" not found. Available headers: ${headers.join(", ")}`);
    }
    colIndex = idx;
  }

  return row.getByRole("cell").nth(colIndex);
};

const resolveForm = (base, p) => {
  let form = byName(base, "form", p.name);
  if (p.field) {
    return form.getByLabel(p.field).first();
  }
  return form;
};

const resolveList = (base, p) => {
  let list = byName(base, "list", p.name);
  if (!p.item) return list;
  const items = list.getByRole("listitem");
  if (isIndex(p.item)) return items.nth(parseInt(p.item) - 1);
  return items.filter({ hasText: p.item }).first();
};

const resolveNav = (base, p) => {
  let nav = byName(base, "navigation", p.name);
  if (!p.item) return nav;
  return nav.getByRole("link", { name: p.item }).first();
};

const resolveMenu = (base, p) => {
  let menu = byName(base, "menu", p.name);
  if (!p.item) return menu;
  return menu.getByRole("menuitem", { name: p.item }).first();
};

const resolveDialog = (base, p) => {
  return byName(base, "dialog", p.name);
};

const resolveTab = (base, p) => {
  let tablist = byName(base, "tablist", p.name);
  if (!p.tab) return tablist;
  if (isIndex(p.tab)) return tablist.getByRole("tab").nth(parseInt(p.tab) - 1);
  return tablist.getByRole("tab", { name: p.tab }).first();
};

const resolveTree = (base, p) => {
  let tree = byName(base, "tree", p.name);
  if (!p.path) return tree;
  // Path like "A>B>C" — walk treeitems by label; return final item.
  const parts = String(p.path).split(">").map(s => s.trim()).filter(Boolean);
  let current = tree;
  for (const part of parts) {
    current = current.getByRole("treeitem", { name: part }).first();
  }
  return current;
};

const resolveCard = (base, p) => {
  // No native ARIA "card" role. Match region/article with title.
  const title = p.title || p.name;
  if (title) {
    const region = base.getByRole("article", { name: title }).or(base.getByRole("region", { name: title }));
    return region.first();
  }
  return base.getByRole("article");
};

const RESOLVERS = {
  table: resolveTable,
  form: resolveForm,
  list: resolveList,
  nav: resolveNav,
  menu: resolveMenu,
  dialog: resolveDialog,
  tab: resolveTab,
  tree: resolveTree,
  card: resolveCard
};

export class ComponentResolver {
  static async resolve(base, type, params = {}) {
    const fn = RESOLVERS[type];
    if (!fn) {
      throw new Error(`Unknown component type: "${type}". Available: ${Object.keys(RESOLVERS).join(", ")}`);
    }
    return await fn(base, params);
  }

  static types() {
    return Object.keys(RESOLVERS);
  }
}
