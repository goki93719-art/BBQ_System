export const SPICE_LEVELS = ["免辣", "微辣", "中辣", "特辣"];

export const BEER_CAPACITIES = [
  { value: "500ML", label: "500ML", multiplierBps: 10_000, volumeMl: 500 },
  { value: "1.5L", label: "1.5L", multiplierBps: 27_000, volumeMl: 1_500 },
  { value: "3L", label: "3L", multiplierBps: 50_000, volumeMl: 3_000 },
];

export function normalizeItemSelection(categoryCode, businessType, raw = {}) {
  const selection = {};
  if (categoryCode === "SKEWER") {
    const spiceLevel = String(raw?.spice_level ?? "微辣");
    if (!SPICE_LEVELS.includes(spiceLevel)) return null;
    selection.spice_level = spiceLevel;
  }
  if (businessType === "BEER") {
    const capacity = String(raw?.capacity ?? "500ML").toUpperCase();
    if (!BEER_CAPACITIES.some((option) => option.value === capacity)) return null;
    selection.capacity = capacity;
  }
  return selection;
}

export function priceForSelection(basePriceCent, businessType, selection = {}) {
  const base = Number(basePriceCent);
  if (!Number.isInteger(base) || base <= 0) return 0;
  if (businessType !== "BEER") return base;
  const option = BEER_CAPACITIES.find((entry) => entry.value === selection.capacity) ?? BEER_CAPACITIES[0];
  return Math.max(100, Math.round((base * option.multiplierBps / 10_000) / 100) * 100);
}

export function selectionKey(selection = {}) {
  return Object.entries(selection)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
}

export function cartLineKey(itemId, selection = {}) {
  return `${itemId}::${selectionKey(selection) || "default"}`;
}

export function selectionLabel(selection = {}) {
  return [selection.spice_level, selection.capacity].filter(Boolean).join(" · ");
}

export function itemOptionGroups(categoryCode, businessType, basePriceCent) {
  const groups = [];
  if (categoryCode === "SKEWER") {
    groups.push({
      key: "spice_level",
      label: "辣度",
      values: SPICE_LEVELS.map((value) => ({ value, label: value })),
    });
  }
  if (businessType === "BEER") {
    groups.push({
      key: "capacity",
      label: "容量",
      values: BEER_CAPACITIES.map((option) => {
        const priceCent = priceForSelection(basePriceCent, businessType, { capacity: option.value });
        return {
          value: option.value,
          label: option.label,
          price_cent: priceCent,
          unit_price_per_500ml_cent: Math.round(priceCent * 500 / option.volumeMl),
        };
      }),
    });
  }
  return groups;
}

const BALANCE_GROUPS = [
  { key: "meat", label: "荤菜", matches: (line) => line.category_code === "SKEWER" },
  { key: "vegetable", label: "素菜", matches: (line) => line.category_code === "VEGETABLE" },
  { key: "staple", label: "主食", matches: (line) => line.category_code === "STAPLE" },
  { key: "beer", label: "啤酒", matches: (line) => line.business_type === "BEER" },
  { key: "drink", label: "饮料", matches: (line) => line.business_type === "DRINK" },
];

export function missingBalanceGroups(lines = []) {
  return BALANCE_GROUPS.filter((group) => !lines.some((line) => !line.invalid && group.matches(line)))
    .map((group) => group.label);
}
