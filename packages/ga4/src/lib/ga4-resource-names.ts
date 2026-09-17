/**
 * Resource-name normalisers shared by the GA4 Admin API write tools.
 * Accepts either a bare numeric ID or a fully-qualified resource name and
 * always returns the fully-qualified form GA4 expects in the URL path.
 */

export function normalizeProperty(s: string): string {
  return s.startsWith("properties/") ? s : `properties/${s}`;
}

export function normalizeCustomDimensionName(property: string, customDimension: string): string {
  if (customDimension.startsWith("properties/")) return customDimension;
  return `${normalizeProperty(property)}/customDimensions/${customDimension}`;
}

export function normalizeKeyEventName(property: string, keyEvent: string): string {
  if (keyEvent.startsWith("properties/")) return keyEvent;
  return `${normalizeProperty(property)}/keyEvents/${keyEvent}`;
}

/** Admin API update masks require snake_case field paths ("event_data_retention"). */
export function toUpdateMask(fields: string[]): string {
  return fields.map((f) => f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)).join(",");
}
