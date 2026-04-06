// Qalb (قلب) — Main plugin backend
// Runs inside Figma's sandbox. Has access to the document, NOT the internet.
/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 320, height: 480, title: "Qalb قلب" });

// ─── Message handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  try {
    switch (msg.type) {

      case "MIRROR_AND_TRANSLATE": {
        const { nodeIds, convertNumerals } = msg;
        const resolved = await Promise.all(
          (nodeIds as string[]).map((id: string) => figma.getNodeByIdAsync(id))
        );
        const nodes = resolved.filter((n): n is SceneNode => n !== null);

        if (nodes.length === 0) {
          figma.ui.postMessage({ type: "ERROR", message: "No valid layers selected." });
          return;
        }

        // Warn if instances will be detached
        if (nodes.some((n: SceneNode) => n.type === "INSTANCE")) {
          figma.ui.postMessage({
            type: "WARN",
            message: "Component instances will be detached before mirroring.",
          });
        }

        // Load all fonts up front — insertChild requires every font in the frame loaded
        const allFailed: string[] = [];
        for (const node of nodes) allFailed.push(...await preloadFonts(node));
        if (allFailed.length > 0) {
          figma.ui.postMessage({
            type: "WARN",
            message: `Some fonts not installed and will be skipped: ${[...new Set(allFailed)].join(", ")}`,
          });
        }

        let mirroredCount = 0;
        const textLayersToTranslate: { id: string; text: string }[] = [];
        const reorderSkipped = new Set<string>();

        for (const node of nodes) {
          const resolved = node.type === "INSTANCE"
            ? (node as InstanceNode).detachInstance()
            : node;
          resolved.name = resolved.name.replace(/_AR$/, "") + "_AR";
          // Pass parentWidth=0 so the top-level frame stays in place;
          // only its children get mirrored within its bounds.
          await mirrorNode(resolved, 0, reorderSkipped);
          mirroredCount++;
          collectTextLayers(resolved, textLayersToTranslate);
        }

        if (reorderSkipped.size > 0) {
          figma.ui.postMessage({
            type: "WARN",
            message: `Child order not reversed in some frames — install missing fonts: ${[...reorderSkipped].join(", ")}. All other mirror operations applied.`,
          });
        }

        figma.ui.postMessage({
          type: "TEXT_LAYERS",
          layers: textLayersToTranslate,
          convertNumerals,
          action: "MIRROR_AND_TRANSLATE",
          mirroredCount,
        });
        break;
      }

      case "CREATE_VARIANT": {
        const { nodeId, convertNumerals } = msg;
        const node = await figma.getNodeByIdAsync(nodeId);

        if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) {
          figma.ui.postMessage({
            type: "ERROR",
            message: "Please select a component or component set.",
          });
          return;
        }

        // Pick the first (or only) component to clone
        const sourceComponent = node.type === "COMPONENT_SET"
          ? (node as ComponentSetNode).children.find(c => c.type === "COMPONENT") as ComponentNode | undefined
          : (node as ComponentNode);

        if (!sourceComponent) {
          figma.ui.postMessage({ type: "ERROR", message: "No component found to duplicate." });
          return;
        }

        // Clone and name with Direction=RTL variant property
        const clone = sourceComponent.clone() as ComponentNode;
        const baseName = sourceComponent.name.replace(/\s*[—–-]\s*Direction=RTL\s*$/, "");
        clone.name = baseName + " — Direction=RTL";

        // Place next to original
        clone.x = sourceComponent.x + sourceComponent.width + 40;
        clone.y = sourceComponent.y;

        // Add into component set, or create one wrapping both
        if (node.type === "COMPONENT_SET") {
          (node as ComponentSetNode).appendChild(clone);
        } else {
          figma.combineAsVariants([sourceComponent, clone], sourceComponent.parent!);
        }

        await preloadFonts(clone);
        const variantSkipped = new Set<string>();
        // parentWidth=0 → clone stays in place; its children mirror within it
        await mirrorNode(clone, 0, variantSkipped);

        if (variantSkipped.size > 0) {
          figma.ui.postMessage({
            type: "WARN",
            message: `Child order not reversed in some frames — install missing fonts: ${[...variantSkipped].join(", ")}. All other mirror operations applied.`,
          });
        }

        const textLayersToTranslate: { id: string; text: string }[] = [];
        collectTextLayers(clone, textLayersToTranslate);

        figma.ui.postMessage({
          type: "TEXT_LAYERS",
          layers: textLayersToTranslate,
          convertNumerals,
          action: "CREATE_VARIANT",
          mirroredCount: 1,
        });
        break;
      }

      case "APPLY_TRANSLATIONS": {
        const { translations, convertNumerals } = msg as {
          translations: { id: string; text: string }[];
          convertNumerals: boolean;
        };

        let updatedCount = 0;
        for (const { id, text } of translations) {
          const node = await figma.getNodeByIdAsync(id);
          if (!node || node.type !== "TEXT") continue;
          try {
            await loadAllFontsForTextNode(node);
            node.characters = convertNumerals ? toEasternArabic(text) : text;
            node.textAlignHorizontal = "RIGHT";
            updatedCount++;
          } catch {
            // Font not installed — skip, leave original text
          }
        }

        figma.ui.postMessage({
          type: "DONE",
          message: `Done! ${updatedCount} text layer${updatedCount !== 1 ? "s" : ""} translated.`,
        });
        break;
      }

      case "GET_FONTS": {
        const { nodeIds } = msg;
        const resolvedFonts = await Promise.all(
          (nodeIds as string[]).map(id => figma.getNodeByIdAsync(id))
        );
        const nodes = resolvedFonts.filter((n): n is SceneNode => n !== null);

        const families = new Set<string>();
        for (const node of nodes) collectFontFamilies(node, families);

        figma.ui.postMessage({ type: "FONTS_LIST", fonts: [...families].sort() });
        break;
      }

      case "APPLY_FONTS": {
        const { nodeIds, mappings } = msg as {
          nodeIds: string[];
          mappings: { from: string; to: string }[];
        };
        const resolvedApply = await Promise.all(
          (nodeIds as string[]).map(id => figma.getNodeByIdAsync(id))
        );
        const nodes = resolvedApply.filter((n): n is SceneNode => n !== null);

        let updatedCount = 0;
        for (const node of nodes) {
          updatedCount += await applyFontMapping(node, mappings);
        }

        figma.ui.postMessage({
          type: "DONE",
          message: `Fonts applied to ${updatedCount} text layer${updatedCount !== 1 ? "s" : ""}.`,
        });
        break;
      }

      case "LOCK_FLIP": {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node) return;
        if (!node.name.includes("[no-flip]")) node.name += " [no-flip]";
        figma.ui.postMessage({ type: "DONE", message: `"${node.name}" locked from flipping.` });
        break;
      }

      case "UNLOCK_FLIP": {
        const node = await figma.getNodeByIdAsync(msg.nodeId);
        if (!node) return;
        node.name = node.name.replace(/\s*\[no-flip\]/g, "");
        figma.ui.postMessage({ type: "DONE", message: `"${node.name}" unlocked.` });
        break;
      }

      case "GET_SELECTION": {
        const sel = figma.currentPage.selection;
        figma.ui.postMessage({
          type: "SELECTION",
          nodes: sel.map(n => ({ id: n.id, name: n.name, type: n.type })),
        });
        break;
      }
    }
  } catch (err) {
    let message = "An unexpected error occurred.";
    if (err instanceof Error) {
      message = err.message;
    } else if (typeof err === "object" && err !== null && "message" in err) {
      message = String((err as { message: unknown }).message);
    } else if (typeof err === "string") {
      message = err;
    }
    figma.ui.postMessage({ type: "ERROR", message });
  }
};

figma.on("selectionchange", () => {
  const sel = figma.currentPage.selection;
  figma.ui.postMessage({
    type: "SELECTION",
    nodes: sel.map(n => ({ id: n.id, name: n.name, type: n.type })),
  });
});

// ─── Core mirroring algorithm ─────────────────────────────────────────────────

async function mirrorNode(
  node: SceneNode,
  parentWidth: number,
  skipped: Set<string> = new Set()
): Promise<void> {
  // Skip protected layers
  if (node.name.includes("[no-flip]") || node.name.includes("[logo]")) return;

  // Skip image rectangles, vectors, shapes (unsafe to flip)
  if (node.type === "RECTANGLE" && hasImageFill(node)) return;
  if (node.type === "VECTOR" || node.type === "ELLIPSE" || node.type === "STAR" || node.type === "POLYGON") return;

  // 1. Mirror absolute position within parent
  // Skip nodes whose position is managed by Auto Layout (unless explicitly absolute)
  if (parentWidth > 0 && "x" in node) {
    const insideAutoLayout =
      node.parent !== null &&
      "layoutMode" in node.parent &&
      (node.parent as FrameNode).layoutMode !== "NONE" &&
      !("layoutPositioning" in node && (node as FrameNode).layoutPositioning === "ABSOLUTE");

    if (!insideAutoLayout) {
      node.x = parentWidth - node.x - node.width;
    }
  }

  // 2. Flip Auto Layout frames (horizontal direction + padding)
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    const frame = node as FrameNode | ComponentNode | ComponentSetNode;
    let didReorder = false;

    if (frame.layoutMode === "HORIZONTAL") {
      try {
        const children = [...frame.children];
        children.reverse().forEach((child, i) => frame.insertChild(i, child));
        didReorder = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message
          : (typeof e === "object" && e !== null && "message" in e)
            ? String((e as { message: unknown }).message)
            : String(e);
        const matches = msg.match(/"([^"]+)"/g) ?? [];
        matches.forEach(m => skipped.add(m.replace(/"/g, "")));
      }
    }

    // Swap left/right padding.
    // For horizontal AL: only if reorder succeeded — mismatched order + swapped padding = visual mess.
    // For vertical AL or no AL: always swap (margins still apply L↔R).
    const shouldSwapPadding = frame.layoutMode !== "HORIZONTAL" || didReorder;
    if (shouldSwapPadding && "paddingLeft" in frame) {
      const tmp = frame.paddingLeft;
      frame.paddingLeft = frame.paddingRight;
      frame.paddingRight = tmp;
    }
  }

  // 3. Flip text alignment (requires font to be loaded)
  if (node.type === "TEXT") {
    const text = node as TextNode;
    try {
      await loadAllFontsForTextNode(text);
      if (text.textAlignHorizontal === "LEFT") text.textAlignHorizontal = "RIGHT";
      else if (text.textAlignHorizontal === "RIGHT") text.textAlignHorizontal = "LEFT";
    } catch {
      // Font unavailable — skip alignment flip for this node
    }
  }

  // 4. Flip border radius corners (top-left ↔ top-right, bottom-left ↔ bottom-right)
  if ("topLeftRadius" in node) {
    const n = node as RectangleNode | FrameNode | ComponentNode;
    const tl = n.topLeftRadius, tr = n.topRightRadius;
    const bl = n.bottomLeftRadius, br = n.bottomRightRadius;
    n.topLeftRadius = tr;
    n.topRightRadius = tl;
    n.bottomLeftRadius = br;
    n.bottomRightRadius = bl;
  }

  // 5. Swap individual stroke weights (left ↔ right)
  if ("strokeLeftWeight" in node) {
    const n = node as FrameNode;
    const lw = n.strokeLeftWeight;
    n.strokeLeftWeight = n.strokeRightWeight;
    n.strokeRightWeight = lw;
  }

  // 6. Recurse into children
  if ("children" in node) {
    const children = [...(node as ChildrenMixin & SceneNode).children] as SceneNode[];
    for (const child of children) {
      const resolved = child.type === "INSTANCE"
        ? (child as InstanceNode).detachInstance()
        : child;
      await mirrorNode(resolved, node.width, skipped);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function preloadFonts(node: SceneNode): Promise<string[]> {
  const unique = new Map<string, FontName>();
  collectUniqueFonts(node, unique);
  const failed: string[] = [];
  await Promise.all(
    Array.from(unique.values()).map(f =>
      figma.loadFontAsync(f).catch(() => { failed.push(`${f.family} ${f.style}`); })
    )
  );
  return failed;
}

function collectUniqueFonts(node: SceneNode, acc: Map<string, FontName>): void {
  if (node.type === "TEXT" && node.characters.length > 0) {
    const single = node.getRangeFontName(0, node.characters.length);
    if (single !== figma.mixed) {
      const f = single as FontName;
      acc.set(`${f.family}::${f.style}`, f);
    } else {
      for (let i = 0; i < node.characters.length; i++) {
        const f = node.getRangeFontName(i, i + 1) as FontName;
        const key = `${f.family}::${f.style}`;
        if (!acc.has(key)) acc.set(key, f);
      }
    }
  }
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children)
      collectUniqueFonts(child as SceneNode, acc);
  }
}

function collectFontFamilies(node: SceneNode, acc: Set<string>): void {
  if (node.type === "TEXT" && node.characters.length > 0) {
    const single = node.getRangeFontName(0, node.characters.length);
    if (single !== figma.mixed) {
      acc.add((single as FontName).family);
    } else {
      for (let i = 0; i < node.characters.length; i++)
        acc.add((node.getRangeFontName(i, i + 1) as FontName).family);
    }
  }
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children)
      collectFontFamilies(child as SceneNode, acc);
  }
}

async function applyFontMapping(
  node: SceneNode,
  mappings: { from: string; to: string }[]
): Promise<number> {
  let count = 0;

  if (node.type === "TEXT" && node.characters.length > 0) {
    const current = node.getRangeFontName(0, node.characters.length);
    if (current !== figma.mixed) {
      const currentFont = current as FontName;
      const mapping = mappings.find(m => m.from === currentFont.family);
      if (mapping) {
        // Try same style first, fall back to Regular
        const candidates: FontName[] = [
          { family: mapping.to, style: currentFont.style },
          { family: mapping.to, style: "Regular" },
          { family: mapping.to, style: "Bold" },
        ];
        for (const candidate of candidates) {
          try {
            await figma.loadFontAsync(candidate);
            node.fontName = candidate;
            count++;
            break;
          } catch {
            // try next candidate
          }
        }
      }
    }
  }

  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children)
      count += await applyFontMapping(child as SceneNode, mappings);
  }

  return count;
}

async function loadAllFontsForTextNode(node: TextNode): Promise<void> {
  const fontName = node.fontName;
  if (fontName === figma.mixed) {
    const unique = new Map<string, FontName>();
    for (let i = 0; i < node.characters.length; i++) {
      const f = node.getRangeFontName(i, i + 1) as FontName;
      unique.set(`${f.family}::${f.style}`, f);
    }
    await Promise.all(Array.from(unique.values()).map(f => figma.loadFontAsync(f)));
  } else {
    await figma.loadFontAsync(fontName);
  }
}

function collectTextLayers(node: SceneNode, result: { id: string; text: string }[]): void {
  if (node.name.includes("[no-flip]") || node.name.includes("[logo]")) return;
  if (node.type === "TEXT" && node.characters.trim().length > 0)
    result.push({ id: node.id, text: node.characters });
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children)
      collectTextLayers(child as SceneNode, result);
  }
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = (node as GeometryMixin).fills;
  return Array.isArray(fills) && fills.some((f: Paint) => f.type === "IMAGE");
}

function toEasternArabic(str: string): string {
  return str.replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0x0630));
}
