/**
 * SnapshotBuilder — builds a compact accessibility snapshot of the current page.
 *
 * Returns a lightweight structure an agent can consume to decide the next action
 * without having to screenshot → read image → guess → click.
 *
 * Shape:
 *   {
 *     url, title,
 *     elements: [{ ref, role, name, bounds, component? }, ...],
 *     components: [{ ref, type, name, rows?, items?, fields? }, ...]
 *   }
 *
 * `ref` is a 1-based index stable within this snapshot. Agents can pass it to
 * commands via `--ref N` to act without re-resolving names.
 *
 * `mode`:
 *   - "off"  → returns null
 *   - "auto" → returns elements + components, elements truncated to ~50
 *   - "full" → no truncation, includes text nodes
 */

const INTERACTIVE_ROLES = [
  "button", "link", "textbox", "checkbox", "radio", "combobox", "listbox",
  "menuitem", "tab", "switch", "searchbox", "slider", "spinbutton", "option"
];

const COMPONENT_ROLES = {
  table: "table",
  form: "form",
  list: "list",
  navigation: "nav",
  menu: "menu",
  dialog: "dialog",
  tablist: "tablist",
  tree: "tree"
};

export class SnapshotBuilder {
  static async build(page, mode = "auto") {
    if (mode === "off") return null;

    const full = mode === "full";

    const data = await page.evaluate(({ interactiveRoles, componentRoles, full }) => {
      const isVisible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") return false;
        return true;
      };

      const implicitRole = (el) => {
        const tag = el.tagName.toLowerCase();
        switch (tag) {
          case "a": return el.hasAttribute("href") ? "link" : null;
          case "button": return "button";
          case "input": {
            const type = (el.getAttribute("type") || "text").toLowerCase();
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "submit" || type === "button" || type === "reset") return "button";
            if (type === "range") return "slider";
            if (type === "number") return "spinbutton";
            if (type === "search") return "searchbox";
            return "textbox";
          }
          case "textarea": return "textbox";
          case "select": return "combobox";
          case "nav": return "navigation";
          case "table": return "table";
          case "form": return "form";
          case "ul":
          case "ol": return "list";
          case "li": return "listitem";
          case "dialog": return "dialog";
          case "option": return "option";
          default: return null;
        }
      };

      const getRole = (el) => (el.getAttribute("role") || implicitRole(el));

      const getName = (el) => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const ref = document.getElementById(labelledBy);
          if (ref) return (ref.textContent || "").trim().slice(0, 120);
        }
        if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
          if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return (label.textContent || "").trim().slice(0, 120);
          }
          const parentLabel = el.closest("label");
          if (parentLabel) return (parentLabel.textContent || "").trim().slice(0, 120);
          const placeholder = el.getAttribute("placeholder");
          if (placeholder) return placeholder.trim();
        }
        const title = el.getAttribute("title");
        if (title) return title.trim();
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        return text.slice(0, 120);
      };

      const bounds = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };

      const all = Array.from(document.querySelectorAll("*"));
      const elements = [];
      const components = [];
      let ref = 0;

      for (const el of all) {
        const role = getRole(el);
        if (!role) continue;
        if (!isVisible(el)) continue;

        if (interactiveRoles.includes(role)) {
          ref++;
          const entry = { ref, role, name: getName(el), bounds: bounds(el) };
          if (el.getAttribute("disabled") != null) entry.disabled = true;
          elements.push(entry);
        } else if (componentRoles[role]) {
          ref++;
          const type = componentRoles[role];
          const comp = { ref, type, name: getName(el), bounds: bounds(el) };

          if (type === "table") {
            const rows = el.querySelectorAll("tr").length;
            const headers = Array.from(el.querySelectorAll("thead th, tr:first-child th"))
              .map(th => (th.textContent || "").trim())
              .filter(Boolean);
            comp.rows = rows;
            if (headers.length) comp.headers = headers;
          } else if (type === "list") {
            comp.items = el.querySelectorAll(":scope > li, :scope > [role='listitem']").length;
          } else if (type === "form") {
            const fields = Array.from(el.querySelectorAll("input, textarea, select"))
              .map(f => getName(f))
              .filter(Boolean);
            comp.fields = fields;
          }

          components.push(comp);
        }
      }

      return {
        url: location.href,
        title: document.title,
        elements: full ? elements : elements.slice(0, 50),
        components,
        truncated: !full && elements.length > 50 ? elements.length - 50 : 0
      };
    }, { interactiveRoles: INTERACTIVE_ROLES, componentRoles: COMPONENT_ROLES, full });

    return data;
  }

  /**
   * Render a snapshot as compact text (for logs, playbook output).
   */
  static render(snapshot) {
    if (!snapshot) return "";
    const lines = [`# ${snapshot.title}`, snapshot.url, ""];
    if (snapshot.components.length) {
      lines.push("## Components");
      for (const c of snapshot.components) {
        let line = `  [${c.ref}] ${c.type}`;
        if (c.name) line += ` "${c.name}"`;
        if (c.rows != null) line += ` (${c.rows} rows)`;
        if (c.items != null) line += ` (${c.items} items)`;
        if (c.fields?.length) line += ` fields: ${c.fields.join(", ")}`;
        lines.push(line);
      }
      lines.push("");
    }
    lines.push("## Elements");
    for (const e of snapshot.elements) {
      lines.push(`  [${e.ref}] ${e.role} "${e.name}"${e.disabled ? " (disabled)" : ""}`);
    }
    if (snapshot.truncated) lines.push(`  ... and ${snapshot.truncated} more`);
    return lines.join("\n");
  }
}
