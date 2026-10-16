import type { FinishAssembly } from "@shared/types";
import { assemblyHead } from "@shared/assemblyItem";
import { assemblySignature } from "@shared/assemblySignature";

/** 先頭の通常明細が同じセットをまとめた一覧の1件分 */
export interface AssemblyGroup {
  key: string;
  list: FinishAssembly[];
}

/**
 * セットを先頭の通常明細でまとめる。
 * 呼出画面では先頭の通常明細だけを見せ、複数あるときだけ中のセットを選ばせる。
 */
export function groupAssembliesByHead(
  assemblies: FinishAssembly[],
): AssemblyGroup[] {
  const groups: AssemblyGroup[] = [];
  const index = new Map<string, number>();
  assemblies.forEach((assembly) => {
    const head = assemblyHead(assembly.items);
    if (!head) return;
    const key = `${assembly.scope}\u001d${assemblySignature([head])}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, groups.length);
      groups.push({ key, list: [assembly] });
      return;
    }
    groups[at].list.push(assembly);
  });
  return groups;
}
