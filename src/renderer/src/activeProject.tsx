import { createContext, useContext, useEffect } from "react";

/** 画面最上部の中央に表示する工事名称（開いている工事が無いときは空） */
export const ActiveProjectContext = createContext<(name: string) => void>(
  () => {},
);

/** 工事を開いている画面から工事名称を最上部へ知らせる。画面を閉じると表示も消える。 */
export function useActiveProjectName(name: string): void {
  const setName = useContext(ActiveProjectContext);
  useEffect(() => {
    setName(name);
    return () => setName("");
  }, [name, setName]);
}
