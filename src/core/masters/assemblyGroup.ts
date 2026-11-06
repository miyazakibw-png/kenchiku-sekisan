import type { FinishAssembly } from "@shared/types";
import { assemblyHead } from "@shared/assemblyItem";
import { assemblySignature } from "@shared/assemblySignature";

/** 先頭の通常明細が同じセットをまとめた一覧の1件分 */
export interface AssemblyGroup {
  key: string;
  list: FinishAssembly[];
}

/** 工事に同じ中身のセットがある基準のセットは、呼出一覧から外す */
export function hideBasicDuplicates(
  assemblies: FinishAssembly[],
): FinishAssembly[] {
  const keyOf = (assembly: FinishAssembly): string => {
    const head = assemblyHead(assembly.items);
    const setPartName = assembly.setPartName.trim();
    const partNumber =
      setPartName !== "" ? assembly.setPartNumber : (head?.partNumber ?? null);
    const partName =
      setPartName !== "" ? setPartName : (head?.partName.trim() ?? "");
    const items = assembly.items.map((item) => ({ ...item, formula: "" }));
    return `${assemblySignature(items)}\u001d${partNumber ?? ""}\u001f${partName}`;
  };

  const projectKeys = new Set(
    assemblies
      .filter((assembly) => assembly.scope === "project")
      .map(keyOf),
  );
  return assemblies.filter(
    (assembly) =>
      assembly.scope !== "basic" || !projectKeys.has(keyOf(assembly)),
  );
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
