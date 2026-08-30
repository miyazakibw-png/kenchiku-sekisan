import { useEffect, useMemo, useState } from "react";
import type {
  MasterOptions,
  ProjectField,
  ProjectSummary,
} from "@shared/types";
import { normalizeDate } from "./projectLedger";
import {
  ALWAYS_VISIBLE,
  loadHiddenFields,
  MENU_GROUP_LABEL,
  saveHiddenFields,
  toggleHiddenField,
  WORKSPACE_MENU,
  type WorkspaceMenuItem,
} from "./workspaceMenu";
import { useActiveProjectName } from "../../activeProject";
import DetailMasterPage from "../details/DetailMasterPage";
import AssemblyMasterPage from "../assemblies/AssemblyMasterPage";
import SubjectMasterPage from "../subjects/SubjectMasterPage";
import BasicMasterPage from "../masters/BasicMasterPage";
import DetailChangeHistoryPage from "../details/DetailChangeHistoryPage";
import FittingsPage from "../fittings/FittingsPage";
import EstimatePartsPage from "../estimate/EstimatePartsPage";
import TransferSheetPage from "../estimate/TransferSheetPage";
import AggregatePage from "../aggregate/AggregatePage";
import RoomAggregatePage from "../aggregate/RoomAggregatePage";
import CheckSheetPage from "../aggregate/CheckSheetPage";
import FormworkTransferPage from "../aggregate/FormworkTransferPage";
import BreakdownPage from "../breakdown/BreakdownPage";
import ProjectSummarySheet from "./ProjectSummarySheet";
import "./ProjectWorkspacePage.css";

interface Props {
  project: ProjectSummary;
  fields: ProjectField[];
  options: MasterOptions;
  /** 工事名称などの変更は物件管理台帳と同じレコードを更新する（相互連携） */
  onSave: (project: ProjectSummary) => void;
  onBack: () => void;
  /** 物件専用ウィンドウでは「閉じる」になる */
  backLabel?: string;
}

interface HeaderField {
  key: string;
  label: string;
  value: string;
  /** ユーザー定義列は列IDで値を持つ */
  fieldId: number | null;
  readOnly: boolean;
  set: (project: ProjectSummary, value: string) => ProjectSummary;
}

const keepAsIs = (project: ProjectSummary): ProjectSummary => project;

export default function ProjectWorkspacePage({
  project,
  fields,
  options: initialOptions,
  onSave,
  onBack,
  backLabel = "← 物件管理台帳",
}: Props): JSX.Element {
  const [draft, setDraft] = useState<ProjectSummary>(project);
  const [hidden, setHidden] = useState<string[]>(loadHiddenFields);
  const [showPicker, setShowPicker] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [message, setMessage] = useState("");
  const [openedMenu, setOpenedMenu] = useState<string | null>(null);
  const [options, setOptions] = useState<MasterOptions>(initialOptions);

  useEffect(() => setOptions(initialOptions), [initialOptions]);

  // この工事のマスターを直した内容を、戻ってきたときに他の画面へ反映する
  useEffect(() => {
    void window.sekisan.getMasterOptions(draft.id).then(setOptions);
  }, [draft.id, openedMenu]);

  useEffect(() => setDraft(project), [project]);

  // 物件管理台帳など別の画面で同じ工事が直されたら、工事概要もそろえる
  useEffect(
    () =>
      window.sekisan.onProjectChanged((saved) =>
        setDraft((current) => (current.id === saved.id ? saved : current)),
      ),
    [],
  );

  useActiveProjectName(draft.name);

  const headerFields = useMemo<HeaderField[]>(
    () => [
      {
        key: "managementNo",
        label: "管理番号",
        value: draft.managementNo,
        fieldId: null,
        readOnly: true,
        set: keepAsIs,
      },
      {
        key: "name",
        label: "工事名称",
        value: draft.name,
        fieldId: null,
        readOnly: false,
        set: (project, value) => ({ ...project, name: value }),
      },
      {
        key: "projectDate",
        label: "日付",
        value: draft.projectDate,
        fieldId: null,
        readOnly: false,
        set: (project, value) => ({ ...project, projectDate: value }),
      },
      {
        key: "builderName",
        label: "施工会社名",
        value: draft.builderName,
        fieldId: null,
        readOnly: false,
        set: (project, value) => ({ ...project, builderName: value }),
      },
      {
        key: "designerName",
        label: "設計事務所名",
        value: draft.designerName,
        fieldId: null,
        readOnly: false,
        set: (project, value) => ({ ...project, designerName: value }),
      },
      {
        key: "note",
        label: "備考",
        value: draft.note,
        fieldId: null,
        readOnly: false,
        set: (project, value) => ({ ...project, note: value }),
      },
      ...fields.map((field) => ({
        key: `field-${field.id}`,
        label: field.title,
        value: draft.fieldValues[field.id] ?? "",
        fieldId: field.id,
        readOnly: false,
        set: (project: ProjectSummary, value: string): ProjectSummary => ({
          ...project,
          fieldValues: { ...project.fieldValues, [field.id]: value },
        }),
      })),
    ],
    [draft, fields],
  );

  const edit = (field: HeaderField, value: string): void =>
    setDraft((prev) => field.set(prev, value));

  const commit = (field: HeaderField): void => {
    if (field.key === "projectDate") {
      const normalized = normalizeDate(draft.projectDate);
      if (!normalized) {
        setMessage("日付は 2026-08-17 の形式で入力してください");
        return;
      }
      onSave({ ...draft, projectDate: normalized });
      return;
    }
    onSave(draft);
  };

  const openMenu = (item: WorkspaceMenuItem): void => {
    if (!item.ready) {
      setMessage(`${item.label} は次の工程で作ります（${item.note}）`);
      return;
    }
    setMessage("");
    setOpenedMenu(item.key);
  };

  const widthOf = (field: HeaderField): string | undefined => {
    const defined = fields.find((row) => row.id === field.fieldId);
    return defined ? `${defined.displayWidth}ch` : undefined;
  };

  if (openedMenu === "details") {
    return (
      <DetailMasterPage
        options={options}
        projectId={draft.id}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "assemblies") {
    return (
      <AssemblyMasterPage
        options={options}
        projectId={draft.id}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "subjects") {
    return (
      <SubjectMasterPage
        projectId={draft.id}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "basicMasters") {
    return (
      <BasicMasterPage
        projectId={draft.id}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "changeHistory") {
    return (
      <DetailChangeHistoryPage
        projectId={draft.id}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "fittings") {
    return <FittingsPage project={draft} onBack={() => setOpenedMenu(null)} />;
  }

  if (openedMenu === "roomFinishes") {
    return (
      <EstimatePartsPage
        project={draft}
        options={options}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "transferInput") {
    return (
      <TransferSheetPage
        project={draft}
        options={options}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "aggregate" || openedMenu === "projectMaster") {
    return <AggregatePage project={draft} onBack={() => setOpenedMenu(null)} />;
  }

  if (openedMenu === "roomAggregate") {
    return (
      <RoomAggregatePage project={draft} onBack={() => setOpenedMenu(null)} />
    );
  }

  if (openedMenu === "formworkTransfer") {
    return (
      <FormworkTransferPage
        project={draft}
        onBack={() => setOpenedMenu(null)}
      />
    );
  }

  if (openedMenu === "finishCheck") {
    return (
      <CheckSheetPage project={draft} onBack={() => setOpenedMenu(null)} />
    );
  }

  if (showSheet) {
    return (
      <ProjectSummarySheet
        lines={headerFields
          .filter((field) => field.key !== "note")
          .map((field) => ({ label: field.label, value: field.value }))}
        note={draft.note}
        onBack={() => setShowSheet(false)}
      />
    );
  }

  if (openedMenu === "statement") {
    return <BreakdownPage project={draft} onBack={() => setOpenedMenu(null)} />;
  }

  return (
    <div className="workspace-page">
      <div className="toolbar">
        <button type="button" onClick={onBack}>
          {backLabel}
        </button>
        <h2>積算操作（管理・移動・集計指示）</h2>
        <button type="button" onClick={() => setShowPicker((prev) => !prev)}>
          ⚙ 表示項目
        </button>
        <button
          type="button"
          title="工事概要をA4縦の書式で印刷します"
          onClick={() => setShowSheet(true)}
        >
          🖨 工事概要印刷
        </button>
        <span className="status">{message}</span>
      </div>

      {showPicker && (
        <div className="field-picker">
          <span className="hint">管理番号・工事名称は常に表示します</span>
          {headerFields.map((field) => (
            <label key={field.key}>
              <input
                type="checkbox"
                disabled={ALWAYS_VISIBLE.includes(field.key)}
                checked={!hidden.includes(field.key)}
                onChange={() => {
                  const next = toggleHiddenField(hidden, field.key);
                  setHidden(next);
                  saveHiddenFields(next);
                }}
              />
              {field.label}
            </label>
          ))}
        </div>
      )}

      <dl className="workspace-header">
        {headerFields
          .filter((field) => !hidden.includes(field.key))
          .map((field) => (
            <div key={field.key} className="header-field">
              <dt>{field.label}</dt>
              <dd>
                {field.readOnly ? (
                  <span
                    className="management-no"
                    title="管理用の自動採番のため変更できません"
                  >
                    {field.value}
                  </span>
                ) : (
                  <input
                    lang={field.key === "projectDate" ? undefined : "ja"}
                    className={field.key === "projectDate" ? "date" : undefined}
                    style={
                      widthOf(field) ? { width: widthOf(field) } : undefined
                    }
                    value={field.value}
                    onChange={(e) => edit(field, e.target.value)}
                    onBlur={() => commit(field)}
                  />
                )}
              </dd>
            </div>
          ))}
      </dl>

      <div className="workspace-menu">
        {(["master", "input", "aggregate", "output"] as const).map((group) => (
          <section key={group}>
            <h3>{MENU_GROUP_LABEL[group]}</h3>
            {WORKSPACE_MENU.filter((item) => item.group === group).map(
              (item) => (
                <button
                  key={item.key}
                  type="button"
                  className={item.ready ? "menu-item" : "menu-item pending"}
                  title={item.note}
                  onClick={() => openMenu(item)}
                >
                  {item.label}
                </button>
              ),
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
