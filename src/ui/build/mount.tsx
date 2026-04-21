/// <reference types="vite/client" />
import "../styles/fonts.css";
import React from "react";
import { createRoot } from "react-dom/client";

// Type for component modules loaded via glob import
type ComponentModule = Record<string, React.ComponentType>;

// Auto-import all components using Vite's glob import
// Each component folder must have an index.ts that exports the component as a named export matching the folder name
const componentModules: Record<string, ComponentModule> = import.meta.glob("../components/*/index.ts", {
    eager: true,
});

// Build component registry from glob imports
// Extracts component name from path: "../components/ListDatabases/index.ts" -> "ListDatabases"
const components: Record<string, React.ComponentType> = {};

for (const [path, module] of Object.entries(componentModules)) {
    const match = path.match(/\.\.\/components\/([^/]+)\/index\.ts$/);
    if (match) {
        const componentName = match[1];
        if (!componentName) continue;
        // The component should be exported with the same name as the folder
        const Component = module[componentName];
        if (Component) {
            components[componentName] = Component;
        } else {
            console.warn(
                `[mount] Component "${componentName}" not found in ${path}. ` +
                    `Make sure to export it as: export { ${componentName} } from "./${componentName}.js"`
            );
        }
    }
}

/**
 * Notify the host (via postMessage) whenever our content size changes so the
 * iframe can be resized to fit. The `@mcp-ui/server` MCP Apps adapter bridge
 * that wraps this bundle translates `ui-size-change` messages to the
 * `ui/notifications/size-changed` JSON-RPC notification consumed by MCP Apps
 * hosts like Claude. Without this, the iframe defaults to a very small height.
 */
function setupSizeChangeNotifications(): () => void {
    let lastWidth = 0;
    let lastHeight = 0;
    let scheduled = false;

    const measureAndSend = (): void => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            const el = document.documentElement;
            // Temporarily let the root grow to natural content height so we
            // report the full required size rather than the current clipped size.
            const prevHeight = el.style.height;
            el.style.height = "max-content";
            const height = Math.ceil(el.getBoundingClientRect().height);
            el.style.height = prevHeight;
            const width = Math.ceil(window.innerWidth);
            if (width === lastWidth && height === lastHeight) return;
            lastWidth = width;
            lastHeight = height;
            window.parent.postMessage(
                { type: "ui-size-change", payload: { width, height } },
                "*"
            );
        });
    };

    measureAndSend();
    const observer = new ResizeObserver(measureAndSend);
    observer.observe(document.documentElement);
    observer.observe(document.body);
    return () => observer.disconnect();
}

function mount(): void {
    const container = document.getElementById("root");
    if (!container) {
        console.error("[mount] No #root element found");
        return;
    }

    const componentName = container.dataset.component;
    if (!componentName) {
        console.error("[mount] No data-component attribute found on #root");
        return;
    }

    const Component = components[componentName];
    if (!Component) {
        console.error(`[mount] Unknown component: ${componentName}`);
        console.error(`[mount] Available components: ${Object.keys(components).join(", ")}`);
        return;
    }

    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <Component />
        </React.StrictMode>
    );

    setupSizeChangeNotifications();
}

mount();
