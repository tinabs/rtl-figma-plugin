"use strict";
// Qalb (قلب) — Main plugin backend
// Runs inside Figma's sandbox. Has access to the document, NOT the internet.
/// <reference types="@figma/plugin-typings" />
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
figma.showUI(__html__, { width: 320, height: 480, title: "Qalb قلب" });
// ─── Message handler ──────────────────────────────────────────────────────────
figma.ui.onmessage = (msg) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        switch (msg.type) {
            case "MIRROR_AND_TRANSLATE": {
                const { nodeIds, convertNumerals } = msg;
                const nodes = nodeIds
                    .map((id) => figma.getNodeById(id))
                    .filter((n) => n !== null);
                if (nodes.length === 0) {
                    figma.ui.postMessage({ type: "ERROR", message: "No valid layers selected." });
                    return;
                }
                // Warn if instances will be detached
                if (nodes.some((n) => n.type === "INSTANCE")) {
                    figma.ui.postMessage({
                        type: "WARN",
                        message: "Component instances will be detached before mirroring.",
                    });
                }
                // Load all fonts up front — insertChild requires every font in the frame loaded
                const allFailed = [];
                for (const node of nodes)
                    allFailed.push(...yield preloadFonts(node));
                if (allFailed.length > 0) {
                    figma.ui.postMessage({
                        type: "WARN",
                        message: `Some fonts not installed and will be skipped: ${[...new Set(allFailed)].join(", ")}`,
                    });
                }
                let mirroredCount = 0;
                const textLayersToTranslate = [];
                const reorderSkipped = new Set();
                for (const node of nodes) {
                    const resolved = node.type === "INSTANCE"
                        ? node.detachInstance()
                        : node;
                    resolved.name = resolved.name.replace(/_AR$/, "") + "_AR";
                    // Pass parentWidth=0 so the top-level frame stays in place;
                    // only its children get mirrored within its bounds.
                    yield mirrorNode(resolved, 0, reorderSkipped);
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
                const node = figma.getNodeById(nodeId);
                if (!node || (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET")) {
                    figma.ui.postMessage({
                        type: "ERROR",
                        message: "Please select a component or component set.",
                    });
                    return;
                }
                // Pick the first (or only) component to clone
                const sourceComponent = node.type === "COMPONENT_SET"
                    ? node.children.find(c => c.type === "COMPONENT")
                    : node;
                if (!sourceComponent) {
                    figma.ui.postMessage({ type: "ERROR", message: "No component found to duplicate." });
                    return;
                }
                // Clone and name with Direction=RTL variant property
                const clone = sourceComponent.clone();
                const baseName = sourceComponent.name.replace(/\s*[—–-]\s*Direction=RTL\s*$/, "");
                clone.name = baseName + " — Direction=RTL";
                // Place next to original
                clone.x = sourceComponent.x + sourceComponent.width + 40;
                clone.y = sourceComponent.y;
                // Add into component set, or create one wrapping both
                if (node.type === "COMPONENT_SET") {
                    node.appendChild(clone);
                }
                else {
                    figma.combineAsVariants([sourceComponent, clone], sourceComponent.parent);
                }
                yield preloadFonts(clone);
                const variantSkipped = new Set();
                // parentWidth=0 → clone stays in place; its children mirror within it
                yield mirrorNode(clone, 0, variantSkipped);
                if (variantSkipped.size > 0) {
                    figma.ui.postMessage({
                        type: "WARN",
                        message: `Child order not reversed in some frames — install missing fonts: ${[...variantSkipped].join(", ")}. All other mirror operations applied.`,
                    });
                }
                const textLayersToTranslate = [];
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
                const { translations, convertNumerals } = msg;
                let updatedCount = 0;
                for (const { id, text } of translations) {
                    const node = figma.getNodeById(id);
                    if (!node || node.type !== "TEXT")
                        continue;
                    try {
                        yield figma.loadFontAsync(node.fontName);
                        node.characters = convertNumerals ? toEasternArabic(text) : text;
                        node.textAlignHorizontal = "RIGHT";
                        updatedCount++;
                    }
                    catch (_a) {
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
                const nodes = nodeIds
                    .map(id => figma.getNodeById(id))
                    .filter((n) => n !== null);
                const families = new Set();
                for (const node of nodes)
                    collectFontFamilies(node, families);
                figma.ui.postMessage({ type: "FONTS_LIST", fonts: [...families].sort() });
                break;
            }
            case "APPLY_FONTS": {
                const { nodeIds, mappings } = msg;
                const nodes = nodeIds
                    .map(id => figma.getNodeById(id))
                    .filter((n) => n !== null);
                let updatedCount = 0;
                for (const node of nodes) {
                    updatedCount += yield applyFontMapping(node, mappings);
                }
                figma.ui.postMessage({
                    type: "DONE",
                    message: `Fonts applied to ${updatedCount} text layer${updatedCount !== 1 ? "s" : ""}.`,
                });
                break;
            }
            case "LOCK_FLIP": {
                const node = figma.getNodeById(msg.nodeId);
                if (!node)
                    return;
                if (!node.name.includes("[no-flip]"))
                    node.name += " [no-flip]";
                figma.ui.postMessage({ type: "DONE", message: `"${node.name}" locked from flipping.` });
                break;
            }
            case "UNLOCK_FLIP": {
                const node = figma.getNodeById(msg.nodeId);
                if (!node)
                    return;
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
    }
    catch (err) {
        let message = "An unexpected error occurred.";
        if (err instanceof Error) {
            message = err.message;
        }
        else if (typeof err === "object" && err !== null && "message" in err) {
            message = String(err.message);
        }
        else if (typeof err === "string") {
            message = err;
        }
        figma.ui.postMessage({ type: "ERROR", message });
    }
});
figma.on("selectionchange", () => {
    const sel = figma.currentPage.selection;
    figma.ui.postMessage({
        type: "SELECTION",
        nodes: sel.map(n => ({ id: n.id, name: n.name, type: n.type })),
    });
});
// ─── Core mirroring algorithm ─────────────────────────────────────────────────
function mirrorNode(node_1, parentWidth_1) {
    return __awaiter(this, arguments, void 0, function* (node, parentWidth, skipped = new Set()) {
        var _a;
        // Skip protected layers
        if (node.name.includes("[no-flip]") || node.name.includes("[logo]"))
            return;
        // Skip image rectangles, vectors, shapes (unsafe to flip)
        if (node.type === "RECTANGLE" && hasImageFill(node))
            return;
        if (node.type === "VECTOR" || node.type === "ELLIPSE" || node.type === "STAR" || node.type === "POLYGON")
            return;
        // 1. Mirror absolute position within parent
        // Skip nodes whose position is managed by Auto Layout (unless explicitly absolute)
        if (parentWidth > 0 && "x" in node) {
            const insideAutoLayout = node.parent !== null &&
                "layoutMode" in node.parent &&
                node.parent.layoutMode !== "NONE" &&
                !("layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE");
            if (!insideAutoLayout) {
                node.x = parentWidth - node.x - node.width;
            }
        }
        // 2. Flip Auto Layout frames (horizontal direction + padding)
        if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
            const frame = node;
            let didReorder = false;
            if (frame.layoutMode === "HORIZONTAL") {
                try {
                    const children = [...frame.children];
                    children.reverse().forEach((child, i) => frame.insertChild(i, child));
                    didReorder = true;
                }
                catch (e) {
                    const msg = e instanceof Error ? e.message
                        : (typeof e === "object" && e !== null && "message" in e)
                            ? String(e.message)
                            : String(e);
                    const matches = (_a = msg.match(/"([^"]+)"/g)) !== null && _a !== void 0 ? _a : [];
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
        // 3. Flip text alignment
        if (node.type === "TEXT") {
            const text = node;
            if (text.textAlignHorizontal === "LEFT")
                text.textAlignHorizontal = "RIGHT";
            else if (text.textAlignHorizontal === "RIGHT")
                text.textAlignHorizontal = "LEFT";
        }
        // 4. Flip border radius corners (top-left ↔ top-right, bottom-left ↔ bottom-right)
        if ("topLeftRadius" in node) {
            const n = node;
            const tl = n.topLeftRadius, tr = n.topRightRadius;
            const bl = n.bottomLeftRadius, br = n.bottomRightRadius;
            n.topLeftRadius = tr;
            n.topRightRadius = tl;
            n.bottomLeftRadius = br;
            n.bottomRightRadius = bl;
        }
        // 5. Swap individual stroke weights (left ↔ right)
        if ("strokeLeftWeight" in node) {
            const n = node;
            const lw = n.strokeLeftWeight;
            n.strokeLeftWeight = n.strokeRightWeight;
            n.strokeRightWeight = lw;
        }
        // 6. Recurse into children
        if ("children" in node) {
            const children = [...node.children];
            for (const child of children) {
                const resolved = child.type === "INSTANCE"
                    ? child.detachInstance()
                    : child;
                yield mirrorNode(resolved, node.width, skipped);
            }
        }
    });
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function preloadFonts(node) {
    return __awaiter(this, void 0, void 0, function* () {
        const unique = new Map();
        collectUniqueFonts(node, unique);
        const failed = [];
        yield Promise.all(Array.from(unique.values()).map(f => figma.loadFontAsync(f).catch(() => { failed.push(`${f.family} ${f.style}`); })));
        return failed;
    });
}
function collectUniqueFonts(node, acc) {
    if (node.type === "TEXT" && node.characters.length > 0) {
        const single = node.getRangeFontName(0, node.characters.length);
        if (single !== figma.mixed) {
            const f = single;
            acc.set(`${f.family}::${f.style}`, f);
        }
        else {
            for (let i = 0; i < node.characters.length; i++) {
                const f = node.getRangeFontName(i, i + 1);
                const key = `${f.family}::${f.style}`;
                if (!acc.has(key))
                    acc.set(key, f);
            }
        }
    }
    if ("children" in node) {
        for (const child of node.children)
            collectUniqueFonts(child, acc);
    }
}
function collectFontFamilies(node, acc) {
    if (node.type === "TEXT" && node.characters.length > 0) {
        const single = node.getRangeFontName(0, node.characters.length);
        if (single !== figma.mixed) {
            acc.add(single.family);
        }
        else {
            for (let i = 0; i < node.characters.length; i++)
                acc.add(node.getRangeFontName(i, i + 1).family);
        }
    }
    if ("children" in node) {
        for (const child of node.children)
            collectFontFamilies(child, acc);
    }
}
function applyFontMapping(node, mappings) {
    return __awaiter(this, void 0, void 0, function* () {
        let count = 0;
        if (node.type === "TEXT" && node.characters.length > 0) {
            const current = node.getRangeFontName(0, node.characters.length);
            if (current !== figma.mixed) {
                const currentFont = current;
                const mapping = mappings.find(m => m.from === currentFont.family);
                if (mapping) {
                    // Try same style first, fall back to Regular
                    const candidates = [
                        { family: mapping.to, style: currentFont.style },
                        { family: mapping.to, style: "Regular" },
                        { family: mapping.to, style: "Bold" },
                    ];
                    for (const candidate of candidates) {
                        try {
                            yield figma.loadFontAsync(candidate);
                            node.fontName = candidate;
                            count++;
                            break;
                        }
                        catch (_a) {
                            // try next candidate
                        }
                    }
                }
            }
        }
        if ("children" in node) {
            for (const child of node.children)
                count += yield applyFontMapping(child, mappings);
        }
        return count;
    });
}
function collectTextLayers(node, result) {
    if (node.name.includes("[no-flip]") || node.name.includes("[logo]"))
        return;
    if (node.type === "TEXT" && node.characters.trim().length > 0)
        result.push({ id: node.id, text: node.characters });
    if ("children" in node) {
        for (const child of node.children)
            collectTextLayers(child, result);
    }
}
function getNodeWidth(node) {
    return "width" in node ? node.width : 0;
}
function hasImageFill(node) {
    if (!("fills" in node))
        return false;
    const fills = node.fills;
    return Array.isArray(fills) && fills.some((f) => f.type === "IMAGE");
}
function toEasternArabic(str) {
    return str.replace(/[0-9]/g, d => String.fromCharCode(d.charCodeAt(0) + 0x0630));
}
