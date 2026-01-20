// Storage key for localStorage
const STORAGE_KEY = "snazzybot_searches";
const MAX_SEARCHES = 50;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG icon element using a symbol reference.
 * This is a safe alternative to innerHTML that prevents XSS.
 * @param {string} iconId - The ID of the SVG symbol (e.g., "icon-edit")
 * @param {string} viewBox - The viewBox attribute value
 * @returns {SVGSVGElement} The created SVG element
 */
function createSvgIcon(iconId, viewBox) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", viewBox);
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttributeNS("http://www.w3.org/1999/xlink", "href", `#${iconId}`);
  svg.append(use);
  return svg;
}

/**
 * Get all saved searches from localStorage
 * @returns {Array} Array of saved search objects
 */
export function getAllSearches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const searches = JSON.parse(raw);
    return searches;
  } catch (error) {
    console.error("Failed to load searches:", error);
    // Clear corrupted data
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore if localStorage is unavailable
    }
    return [];
  }
}

/**
 * Save a new search to localStorage
 * @param {Object} search - Search object with name and params
 * @returns {Object} The saved search with generated id and timestamps
 */
export function saveSearch(search) {
  const searches = getAllSearches();

  // Generate UUID v4
  const id =
    search.id ||
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);

  const newSearch = {
    ...search,
    id,
    createdAt: search.createdAt || Date.now(),
  };

  searches.unshift(newSearch);

  // Limit to MAX_SEARCHES (remove oldest by createdAt)
  if (searches.length > MAX_SEARCHES) {
    searches.sort((a, b) => b.createdAt - a.createdAt);
    searches.length = MAX_SEARCHES;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
    return newSearch;
  } catch (error) {
    if (error.name === "QuotaExceededError") {
      throw new Error(
        "Storage quota exceeded. Please delete some saved searches.",
      );
    }
    throw error;
  }
}

/**
 * Delete a search by ID
 * @param {string} id - Search ID
 */
export function deleteSearch(id) {
  const searches = getAllSearches().filter((s) => s.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch (error) {
    console.error("Failed to delete search:", error);
    throw error;
  }
}

/**
 * Update search name
 * @param {string} id - Search ID
 * @param {string} name - New name
 */
export function updateSearchName(id, name) {
  const searches = getAllSearches();
  const search = searches.find((s) => s.id === id);
  if (search) {
    search.name = name;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
    } catch (error) {
      console.error("Failed to update search name:", error);
      throw error;
    }
  }
}

/**
 * Get search by ID
 * @param {string} id - Search ID
 * @returns {Object|null} Search object or null if not found
 */
export function getSearchById(id) {
  const searches = getAllSearches();
  return searches.find((s) => s.id === id) || undefined;
}

/**
 * SavedSearches UI class
 */
export class SavedSearches {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks || {}; // { onLoad, onSave }
    this.pendingDelete = undefined; // { id, timeout }
    this.modifierPressed = false;
    this.setupKeyboardListeners();
    this.render();
  }

  setupKeyboardListeners() {
    document.addEventListener("keydown", (e) => {
      // Check for Command (Mac) or Ctrl (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && !this.modifierPressed) {
        this.modifierPressed = true;
        this.updateNewTabIndicators();
      }
    });

    document.addEventListener("keyup", (e) => {
      // Check for Command (Mac) or Ctrl (Windows/Linux)
      if (!e.metaKey && !e.ctrlKey && this.modifierPressed) {
        this.modifierPressed = false;
        this.updateNewTabIndicators();
      }
    });
  }

  updateNewTabIndicators() {
    const allSearchElements = this.container.querySelectorAll(".saved-search");
    for (const el of allSearchElements) {
      const indicator = el.querySelector(".new-tab-indicator");
      if (indicator) {
        indicator.style.display = this.modifierPressed ? "inline-flex" : "none";
      }
    }
  }

  render() {
    const searches = getAllSearches();
    this.container.replaceChildren(); // Safe way to clear container

    if (searches.length === 0) return;

    const wrapper = document.createElement("div");
    wrapper.className = "saved-searches-wrapper";

    for (const search of searches) {
      const el = this.createSearchElement(search);
      wrapper.append(el);
    }

    this.container.append(wrapper);
  }

  createSearchElement(search) {
    const div = document.createElement("div");
    div.className = "saved-search";
    div.dataset.id = search.id;
    // Make focusable and indicate it's interactive for accessibility
    div.setAttribute("tabindex", "0");
    div.setAttribute("role", "button");

    // Show undo state if this search is pending deletion
    if (this.pendingDelete?.id === search.id) {
      // Use safe DOM methods instead of innerHTML to prevent XSS
      const deletedNameSpan = document.createElement("span");
      deletedNameSpan.className = "search-name-deleted";
      deletedNameSpan.textContent = search.name; // Safe: textContent escapes HTML

      const undoBtn = document.createElement("button");
      undoBtn.className = "undo-btn";
      undoBtn.dataset.id = search.id;
      undoBtn.textContent = "Undo";
      undoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.undoDelete(search.id);
      });

      div.append(deletedNameSpan, undoBtn);
    } else {
      const nameSpan = document.createElement("span");
      nameSpan.className = "search-name";
      nameSpan.textContent = search.name;
      nameSpan.dataset.id = search.id;

      // New tab indicator icon
      const newTabIndicator = document.createElement("span");
      newTabIndicator.className = "new-tab-indicator";
      newTabIndicator.append(
        createSvgIcon("icon-external-link", "0 0 512 512"),
      );
      // Detect platform for appropriate modifier key label
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
      newTabIndicator.title = `${isMac ? "Cmd" : "Ctrl"}+Click to open in new tab and execute`;
      newTabIndicator.style.display = "none"; // Hidden by default

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.dataset.id = search.id;
      editBtn.setAttribute("aria-label", "Edit search name");
      editBtn.title = "Edit search name";
      editBtn.append(createSvgIcon("icon-edit", "0 0 512 512"));

      const shareBtn = document.createElement("button");
      shareBtn.className = "share-btn";
      shareBtn.dataset.id = search.id;
      shareBtn.setAttribute("aria-label", "Copy share link");
      shareBtn.title = "Copy share link";
      shareBtn.append(createSvgIcon("icon-link", "0 0 640 512"));

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.dataset.id = search.id;
      deleteBtn.setAttribute("aria-label", "Delete search");
      deleteBtn.title = "Delete search";
      deleteBtn.append(createSvgIcon("icon-trash", "0 0 448 512"));

      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.startEditing(search.id);
      });

      shareBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await this.shareSearch(search.id, shareBtn);
      });

      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.deleteWithUndo(search.id);
      });

      // Keyboard accessibility: handle Enter and Space
      div.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); // Prevent scrolling on space
          if (e.metaKey || e.ctrlKey) {
            this.openInNewTabAndExecute(search.id);
          } else {
            this.loadSearch(search.id);
          }
        }
      });

      div.addEventListener("click", (e) => {
        // Check for Command (Mac) or Ctrl (Windows/Linux)
        if (e.metaKey || e.ctrlKey) {
          this.openInNewTabAndExecute(search.id);
        } else {
          this.loadSearch(search.id);
        }
      });

      div.append(nameSpan, newTabIndicator, editBtn, shareBtn, deleteBtn);
    }

    return div;
  }

  async createFromParams(params, options = {}) {
    const suggestName =
      options.suggestName || this.suggestNameViaAPI.bind(this);

    let name;
    try {
      name = await suggestName(params);
    } catch (error) {
      console.error("Name suggestion failed:", error);
      name = `Saved Search ${Date.now()}`;
    }

    const search = { name, params };
    saveSearch(search);
    this.render();

    if (this.callbacks.onSave) {
      this.callbacks.onSave(search);
    }
  }

  async suggestNameViaAPI(params) {
    const response = await fetch("/api/suggest-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();
    return data.name;
  }

  loadSearch(id) {
    const search = getAllSearches().find((s) => s.id === id);
    if (search && this.callbacks.onLoad) {
      this.callbacks.onLoad(search.params);
    }
  }

  openInNewTabAndExecute(id) {
    const search = getAllSearches().find((s) => s.id === id);
    if (!search) return;

    // Build URL with parameters and auto-execute flag
    const url = this.getShareableURL(id, {
      includeOrigin: true,
      autoExecute: true,
    });

    if (url) {
      // Use anchor element to ensure it opens in a new tab rather than window
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    }
  }

  startEditing(id) {
    const search = getAllSearches().find((s) => s.id === id);
    if (!search) return;

    const searchDiv = this.container.querySelector(
      `.saved-search[data-id="${id}"]`,
    );
    if (!searchDiv) return;

    const nameEl = searchDiv.querySelector(`.search-name[data-id="${id}"]`);
    if (!nameEl) return;

    const input = document.createElement("input");
    input.type = "text";
    input.value = search.name;
    input.className = "search-name-input";

    const save = () => {
      updateSearchName(id, input.value);
      this.render();
    };

    const cancel = () => {
      this.render();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        save();
      } else if (e.key === "Escape") {
        cancel();
      }
    });

    input.addEventListener("blur", () => {
      cancel();
    });

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  deleteWithUndo(id) {
    // Cancel any existing pending delete
    if (this.pendingDelete) {
      clearTimeout(this.pendingDelete.timeout);
    }

    this.pendingDelete = {
      id,
      timeout: setTimeout(() => {
        deleteSearch(id);
        this.pendingDelete = undefined;
        this.render();
      }, 3000),
    };
    this.render();
  }

  undoDelete(id) {
    if (this.pendingDelete?.id === id) {
      clearTimeout(this.pendingDelete.timeout);
      this.pendingDelete = undefined;
      this.render();
    }
  }

  getShareableURL(id, options = {}) {
    const search = getAllSearches().find((s) => s.id === id);
    if (!search) return "";

    const params = search.params;
    const sp = new URLSearchParams();

    // Map params to query string using the same format as the form submission
    if (params.components) sp.set("components", params.components);
    if (params.whiteboards) sp.set("whiteboards", params.whiteboards);
    if (params.metabugs) sp.set("metabugs", params.metabugs);
    if (params.assignees) sp.set("assignees", params.assignees);
    if (params.githubRepos) sp.set("github-repos", params.githubRepos);
    if (params.emailMapping) sp.set("email-mapping", params.emailMapping);
    sp.set("days", String(params.days || 7));
    sp.set("voice", params.voice || "normal");
    sp.set("aud", params.audience || "technical");
    if (params.debug) sp.set("debug", "true");
    if (!params.cache) sp.set("nocache", "1");
    if (params.patchContext === "omit") sp.set("pc", "0");

    // Add auto-execute flag if requested
    if (options.autoExecute) sp.set("auto", "1");

    const path = `?${sp.toString()}`;

    return options.includeOrigin
      ? `${globalThis.location.origin}${globalThis.location.pathname}${path}`
      : path;
  }

  async shareSearch(id, buttonElement) {
    // Helper to show temporary feedback and restore original content
    const showFeedback = (text, color) => {
      // Save original children (the SVG icon)
      const originalChildren = [...buttonElement.childNodes];
      buttonElement.replaceChildren(); // Clear safely
      buttonElement.textContent = text;
      buttonElement.style.color = color;
      buttonElement.style.opacity = "1";

      setTimeout(() => {
        buttonElement.replaceChildren(...originalChildren);
        buttonElement.style.color = "";
        buttonElement.style.opacity = "";
      }, 2000);
    };

    try {
      const url = this.getShareableURL(id, { includeOrigin: true });
      if (!url) return;

      await navigator.clipboard.writeText(url);
      showFeedback("✓", "var(--ok)");
    } catch (error) {
      console.error("Failed to copy share link:", error);
      showFeedback("✗", "var(--err)");
    }
  }
}
