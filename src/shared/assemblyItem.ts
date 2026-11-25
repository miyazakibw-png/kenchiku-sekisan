import type { AssemblyItem } from "./types";

export function assemblyItemSubjectId(item: AssemblyItem): number | null {
  return item.note === true && item.subjectId === 0 ? null : item.subjectId;
}

export function assemblyHead(items: AssemblyItem[]): AssemblyItem | undefined {
  return items.find((item) => item.note !== true) ?? items[0];
}
