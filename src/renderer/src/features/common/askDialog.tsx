import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * 「はい／いいえ」の確認を、Windowsの窓ではなく画面の中に出す。
 * Windowsの確認の窓を使うと、閉じたあとも入力先がそちらに残り、
 * 画面の欄に文字が入らなくなることがあるため。
 */
let host: HTMLDivElement | null = null;
let root: Root | null = null;

function AskBox(props: {
  message: string;
  onAnswer: (answer: boolean) => void;
}): JSX.Element {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
  }, []);

  return (
    <div
      className="ask-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onAnswer(false);
      }}
    >
      <div className="ask-box" role="dialog" aria-modal="true">
        <div className="ask-message">{props.message}</div>
        <div className="ask-buttons">
          <button
            type="button"
            ref={okRef}
            className="ask-ok"
            onClick={() => props.onAnswer(true)}
          >
            はい
          </button>
          <button type="button" onClick={() => props.onAnswer(false)}>
            いいえ
          </button>
        </div>
      </div>
    </div>
  );
}

/** 確認を出して、「はい」なら true を返す */
export function ask(message: string): Promise<boolean> {
  if (host === null) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  }
  const opener =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  return new Promise<boolean>((resolve) => {
    const answer = (result: boolean): void => {
      root?.render(null);
      if (opener !== null && document.contains(opener)) opener.focus();
      resolve(result);
    };
    root?.render(<AskBox message={message} onAnswer={answer} />);
  });
}
