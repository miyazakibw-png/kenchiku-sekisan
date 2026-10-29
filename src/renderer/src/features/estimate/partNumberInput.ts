import type { MasterEntry } from "@shared/types";

export function pickMaster(
  entries: readonly MasterEntry[],
  input: string,
): { id: number | null; name: string } {
  const text = input.trim();
  if (text === "") return { id: null, name: "" };
  const byNumber = /^\d+$/.test(text)
    ? entries.find((entry) => entry.id === Number(text))
    : undefined;
  if (byNumber) return { id: byNumber.id, name: byNumber.name };
  const byName = entries.find((entry) => entry.name === text);
  if (byName) return { id: byName.id, name: byName.name };
  return { id: null, name: text };
}

export function resolvePartNumberInput(
  entries: readonly MasterEntry[],
  input: string,
  currentPartName: string,
): { partNumber: number | null; partName: string } {
  const picked = pickMaster(entries, input);
  if (picked.id !== null)
    return { partNumber: picked.id, partName: picked.name };

  const text = input.trim();
  const number = Number(text);
  return {
    partNumber: text !== "" && Number.isFinite(number) ? number : null,
    partName: currentPartName,
  };
}
