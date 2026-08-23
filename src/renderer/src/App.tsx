import { useCallback, useEffect, useRef, useState } from "react";
import type { MasterOptions } from "@shared/types";
import { ActiveProjectContext } from "./activeProject";
import DetailMasterPage from "./features/details/DetailMasterPage";
import AssemblyMasterPage from "./features/assemblies/AssemblyMasterPage";
import ProjectLedgerPage from "./features/projects/ProjectLedgerPage";
import SubjectMasterPage from "./features/subjects/SubjectMasterPage";
import BasicMasterPage from "./features/masters/BasicMasterPage";
import PrintBar from "./features/print/PrintBar";
import { useGridKeyNav } from "./features/grid/useGridKeyNav";
import { useHalfWidthFields } from "./hooks/useHalfWidthFields";
import { useStickyHeaders } from "./features/grid/useStickyHeaders";
import SettingsPage from "./features/settings/SettingsPage";
import CalcWindowPage from "./features/estimate/CalcWindowPage";

type NavKey =
  "subjects" | "details" | "assemblies" | "masters" | "projects" | "settings";

const NAV: { key: NavKey; label: string; icon: string; ready: boolean }[] = [
  { key: "subjects", label: "工種科目マスター", icon: "🗂", ready: true },
  { key: "details", label: "明細マスター", icon: "📋", ready: true },
  { key: "assemblies", label: "仕上明細セット", icon: "🧱", ready: true },
  { key: "masters", label: "基本マスター", icon: "🧾", ready: true },
  { key: "projects", label: "物件管理台帳", icon: "🏢", ready: true },
  { key: "settings", label: "設定", icon: "⚙️", ready: true },
];

/** 物件専用ウィンドウは #project=<ID> で開かれる */
function openedProjectId(): number | null {
  const matched = /project=(\d+)/.exec(window.location.hash);
  return matched ? Number(matched[1]) : null;
}

/** 明細入力ウィンドウは #calc=<元の画面のID> で開かれる */
function calcWindowParentId(): number | null {
  const matched = /calc=(\d+)/.exec(window.location.hash);
  return matched ? Number(matched[1]) : null;
}

export default function App(): JSX.Element {
  const projectId = openedProjectId();
  const calcParentId = calcWindowParentId();
  const [options, setOptions] = useState<MasterOptions | null>(null);
  const [nav, setNav] = useState<NavKey>("details");
  const [projectName, setProjectName] = useState("");
  const setActiveProjectName = useCallback(
    (name: string) => setProjectName(name),
    [],
  );
  const onGridKeyDown = useGridKeyNav();
  const mainRef = useRef<HTMLElement>(null);
  useStickyHeaders(mainRef);
  useHalfWidthFields();

  // 画面を切り替えるたびにマスターを読み直す（科目マスターを直した内容をすぐ他画面へ反映する）
  // 工事の画面ではその工事専用のマスター（無い種類は基本マスター）を使う
  useEffect(() => {
    void window.sekisan.getMasterOptions(projectId).then(setOptions);
  }, [nav, projectId]);

  useEffect(() => {
    document.title = projectName
      ? `建築積算システム　${projectName}`
      : "建築積算システム";
  }, [projectName]);

  if (calcParentId !== null)
    return (
      <div className="app calc-window">
        <main className="app-main" onKeyDown={onGridKeyDown}>
          <CalcWindowPage parentId={calcParentId} />
        </main>
      </div>
    );

  return (
    <ActiveProjectContext.Provider value={setActiveProjectName}>
      <div className={projectId === null ? "app" : "app project-window"}>
        <header className="app-bar">
          <div className="app-bar-title">🏗 建築積算システム</div>
          <div className="app-bar-project">{projectName}</div>
          <PrintBar projectName={projectName} />
        </header>
        {projectId === null && (
          <nav className="app-nav">
            {NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === nav ? "nav-item active" : "nav-item"}
                onClick={() => setNav(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <main className="app-main" ref={mainRef} onKeyDown={onGridKeyDown}>
          {!options ? (
            <div className="placeholder">読み込み中…</div>
          ) : projectId !== null ? (
            <ProjectLedgerPage options={options} initialProjectId={projectId} />
          ) : nav === "subjects" ? (
            <SubjectMasterPage />
          ) : nav === "details" ? (
            <DetailMasterPage options={options} />
          ) : nav === "assemblies" ? (
            <AssemblyMasterPage options={options} />
          ) : nav === "masters" ? (
            <BasicMasterPage />
          ) : nav === "projects" ? (
            <ProjectLedgerPage options={options} />
          ) : nav === "settings" ? (
            <SettingsPage />
          ) : (
            <div className="placeholder">
              {NAV.find((item) => item.key === nav)?.label} は今後実装予定です。
            </div>
          )}
        </main>
      </div>
    </ActiveProjectContext.Provider>
  );
}
