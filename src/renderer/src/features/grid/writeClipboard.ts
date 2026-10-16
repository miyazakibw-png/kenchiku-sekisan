export function writeClipboard(text: string): void {
  const active = document.activeElement;
  const input = active instanceof HTMLInputElement ? active : null;
  const start = input ? input.selectionStart : null;
  const end = input ? input.selectionEnd : null;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
  void navigator.clipboard?.writeText(text).catch(() => undefined);

  if (input) {
    input.focus();
    if (start !== null && end !== null) input.setSelectionRange(start, end);
  } else if (active instanceof HTMLElement) {
    active.focus();
  }
}
