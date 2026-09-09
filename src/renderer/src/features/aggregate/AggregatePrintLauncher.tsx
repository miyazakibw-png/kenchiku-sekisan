import { useEffect, useState } from "react";
import type { AggregateItem, ProjectSummary, Subject } from "@shared/types";
import AggregatePrintPage from "./AggregatePrintPage";

interface Props {
  project: ProjectSummary;
  onBack: () => void;
}

/** 工事管理画面から集計書（根拠付き・A4横）をそのまま印刷する入口 */
export default function AggregatePrintLauncher({
  project,
  onBack,
}: Props): JSX.Element {
  const [items, setItems] = useState<AggregateItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const view = await window.sekisan.getAggregate(project.id);
      setItems(view.items);
      setSubjects(await window.sekisan.listSubjects(project.id));
      setLoaded(true);
    })();
  }, [project.id]);

  if (!loaded) return <div className="estimate-page" />;

  return (
    <AggregatePrintPage
      project={project}
      items={items}
      subjects={subjects}
      onBack={onBack}
    />
  );
}
